const router = require('express').Router();
const { q } = require('../db');
const { auth, requireRole, loadUser } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { addClient, notifyUsers } = require('../lib/notify');
const { sendSms } = require('../lib/sms');

// Public lookup data for the report form
router.get('/meta', async (req, res) => {
  const [c, l] = await Promise.all([
    q('SELECT id,name,description FROM incident_categories ORDER BY id'),
    q('SELECT id,name,lat,lng FROM locations ORDER BY name'),
  ]);
  res.json({ categories: c.rows, locations: l.rows });
});

// Real-time stream. EventSource cannot set headers, so the JWT comes in the query string.
router.get('/stream', async (req, res) => {
  let user;
  try { user = await loadUser(String(req.query.token || '')); } catch (_) { /* invalid */ }
  if (!user) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const remove = addClient(user, res);
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  req.on('close', () => { clearInterval(hb); remove(); });
});

// ---- Notifications ----
router.get('/notifications', auth, async (req, res) => {
  const { rows } = await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json({ unread: rows.filter((n) => !n.is_read).length, items: rows });
});
router.post('/notifications/read', auth, async (req, res) => {
  await q('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
});

// ---- Announcements (broadcast) ----
router.get('/announcements', auth, async (req, res) => {
  const { rows } = await q(
    `SELECT a.*, u.full_name AS author FROM announcements a LEFT JOIN users u ON u.id=a.created_by
      WHERE audience='all' OR audience=$1 OR $2 ORDER BY created_at DESC LIMIT 30`,
    [req.user.role, ['admin', 'head_security', 'management'].includes(req.user.role)]);
  res.json(rows);
});
router.post('/announcements', auth, requireRole('admin', 'head_security', 'management'), async (req, res) => {
  const { title, body, audience, sms } = req.body || {};
  const aud = ['all', 'student', 'staff', 'security_officer', 'management', 'dean'].includes(audience) ? audience : 'all';
  if (!title || !body) return res.status(400).json({ error: 'Add a title and a message.' });
  const { rows } = await q('INSERT INTO announcements(title,body,audience,created_by) VALUES($1,$2,$3,$4) RETURNING *', [title, body, aud, req.user.id]);
  const targets = (await q(`SELECT id,phone FROM users WHERE is_active AND ($1='all' OR role=$1)`, [aud])).rows;
  await notifyUsers(targets.map((t) => t.id), title, body, 'announcement', '#/announcements');
  if (sms) targets.forEach((t) => sendSms(t.phone, `${title}: ${body}`));
  await audit(req, 'ANNOUNCEMENT_SENT', 'announcement', rows[0].id, { audience: aud, recipients: targets.length });
  res.status(201).json(rows[0]);
});

// ---- Dashboard & hotspots (FR-12) ----
router.get('/dashboard', auth, requireRole('admin', 'head_security', 'security_officer', 'management'), async (req, res) => {
  const days = Math.min(365, Number(req.query.days) || 30);
  const since = `now() - ($1 || ' days')::interval`;
  const d = [String(days)];
  const [counts, cat, sev, loc, hour, dow, month, resp, alerts, onduty, onCampus, overdue] = await Promise.all([
    q(`SELECT COUNT(*) FILTER (WHERE status='Submitted') AS new_count,
              COUNT(*) FILTER (WHERE status IN ('Verified','In Progress','Resolved')) AS open_count,
              COUNT(*) FILTER (WHERE status='Closed') AS closed_count, COUNT(*) AS total
         FROM incidents WHERE reported_datetime > ${since}`, d),
    q(`SELECT COALESCE(c.name,'Uncategorised') AS label, COUNT(*)::int AS n FROM incidents i LEFT JOIN incident_categories c ON c.id=i.category_id WHERE i.reported_datetime > ${since} GROUP BY 1 ORDER BY 2 DESC`, d),
    q(`SELECT COALESCE(severity,'Unclassified') AS label, COUNT(*)::int AS n FROM incidents WHERE reported_datetime > ${since} GROUP BY 1`, d),
    q(`SELECT COALESCE(l.name,i.location_text,'Unknown') AS label, AVG(l.lat) AS lat, AVG(l.lng) AS lng, COUNT(*)::int AS n
         FROM incidents i LEFT JOIN locations l ON l.id=i.location_id WHERE i.incident_datetime > ${since} GROUP BY 1 ORDER BY 4 DESC LIMIT 15`, d),
    q(`SELECT EXTRACT(hour FROM incident_datetime AT TIME ZONE 'Africa/Kigali')::int AS h, COUNT(*)::int AS n FROM incidents WHERE incident_datetime > ${since} GROUP BY 1 ORDER BY 1`, d),
    q(`SELECT EXTRACT(dow FROM incident_datetime AT TIME ZONE 'Africa/Kigali')::int AS d, COUNT(*)::int AS n FROM incidents WHERE incident_datetime > ${since} GROUP BY 1 ORDER BY 1`, d),
    q(`SELECT to_char(date_trunc('month', incident_datetime),'YYYY-MM') AS m, COUNT(*)::int AS n FROM incidents GROUP BY 1 ORDER BY 1 DESC LIMIT 12`),
    q(`SELECT ROUND(AVG(EXTRACT(epoch FROM (v.t - i.reported_datetime))/60))::int AS avg_response_min,
              ROUND(AVG(EXTRACT(epoch FROM (i.closed_datetime - i.reported_datetime))/3600)::numeric,1) AS avg_resolution_hours
         FROM incidents i LEFT JOIN LATERAL (SELECT MIN(created_at) AS t FROM incident_updates WHERE incident_id=i.id AND new_status='Verified') v ON TRUE
        WHERE i.reported_datetime > ${since}`, d),
    q(`SELECT COUNT(*)::int AS n FROM emergency_alerts WHERE status <> 'Resolved'`),
    q(`SELECT u.id,u.full_name FROM duty_rosters d JOIN users u ON u.id=d.officer_id WHERE d.start_at<=now() AND d.end_at>now()`),
    q('SELECT COUNT(*)::int AS n FROM visitors WHERE exit_at IS NULL'),
    q(`SELECT COUNT(*)::int AS n FROM incidents WHERE due_at < now() AND status NOT IN ('Resolved','Closed')`),
  ]);
  res.json({
    days, counts: counts.rows[0], by_category: cat.rows, by_severity: sev.rows, hotspots: loc.rows,
    by_hour: hour.rows, by_weekday: dow.rows, by_month: month.rows.reverse(), timings: resp.rows[0],
    active_alerts: alerts.rows[0].n, officers_on_duty: onduty.rows, visitors_on_campus: onCampus.rows[0].n, overdue: overdue.rows[0].n,
  });
});

// ---- Reports (FR-13) with CSV export (opens in Excel) ----
const REPORTS = {
  incidents: { roles: ['admin', 'head_security', 'management'], sql: `SELECT i.reference_no, c.name AS category, l.name AS location, i.severity, i.status, i.incident_datetime, i.reported_datetime, i.closed_datetime, i.is_anonymous FROM incidents i LEFT JOIN incident_categories c ON c.id=i.category_id LEFT JOIN locations l ON l.id=i.location_id WHERE i.reported_datetime >= $1::date AND i.reported_datetime < $2::date + 1 ORDER BY i.reported_datetime` },
  by_category: { roles: ['admin', 'head_security', 'management'], sql: `SELECT COALESCE(c.name,'Uncategorised') AS category, COUNT(*) AS incidents FROM incidents i LEFT JOIN incident_categories c ON c.id=i.category_id WHERE i.reported_datetime >= $1::date AND i.reported_datetime < $2::date + 1 GROUP BY 1 ORDER BY 2 DESC` },
  by_location: { roles: ['admin', 'head_security', 'management'], sql: `SELECT COALESCE(l.name,i.location_text,'Unknown') AS location, COUNT(*) AS incidents FROM incidents i LEFT JOIN locations l ON l.id=i.location_id WHERE i.reported_datetime >= $1::date AND i.reported_datetime < $2::date + 1 GROUP BY 1 ORDER BY 2 DESC` },
  response_time: { roles: ['admin', 'head_security', 'management'], sql: `SELECT i.reference_no, i.severity, i.reported_datetime, i.due_at, v.t AS first_response, ROUND(EXTRACT(epoch FROM (v.t-i.reported_datetime))/60) AS response_minutes, (v.t > i.due_at) AS breached_sla FROM incidents i LEFT JOIN LATERAL (SELECT MIN(created_at) AS t FROM incident_updates WHERE incident_id=i.id AND new_status='Verified') v ON TRUE WHERE i.reported_datetime >= $1::date AND i.reported_datetime < $2::date + 1 ORDER BY i.reported_datetime` },
  alerts: { roles: ['admin', 'head_security', 'management'], sql: `SELECT a.id, u.full_name AS sender, a.status, a.triggered_at, a.acknowledged_at, a.arrived_at, a.resolved_at, ROUND(EXTRACT(epoch FROM (a.acknowledged_at-a.triggered_at))) AS seconds_to_acknowledge FROM emergency_alerts a JOIN users u ON u.id=a.user_id WHERE a.triggered_at >= $1::date AND a.triggered_at < $2::date + 1 ORDER BY a.triggered_at` },
  lost_found: { roles: ['admin', 'head_security'], sql: `SELECT kind,title,category,location_text,status,created_at,collected_by_name,collected_at FROM items WHERE created_at >= $1::date AND created_at < $2::date + 1 ORDER BY created_at` },
  visitors: { roles: ['admin', 'head_security', 'management'], sql: `SELECT full_name,id_number,phone,purpose,badge_no,vehicle_plate,entry_at,exit_at FROM visitors WHERE entry_at >= $1::date AND entry_at < $2::date + 1 ORDER BY entry_at` },
  patrol: { roles: ['admin', 'head_security', 'management'], sql: `SELECT u.full_name AS officer, c.name AS checkpoint, p.scanned_at, p.notes FROM patrol_logs p JOIN users u ON u.id=p.officer_id JOIN checkpoints c ON c.id=p.checkpoint_id WHERE p.scanned_at >= $1::date AND p.scanned_at < $2::date + 1 ORDER BY p.scanned_at` },
  officer_performance: { roles: ['admin', 'head_security', 'management'], sql: `SELECT u.full_name AS officer, COUNT(DISTINCT a.incident_id) AS assigned, COUNT(DISTINCT a.incident_id) FILTER (WHERE i.status IN ('Resolved','Closed')) AS resolved, (SELECT COUNT(*) FROM patrol_logs p WHERE p.officer_id=u.id AND p.scanned_at >= $1::date AND p.scanned_at < $2::date + 1) AS checkpoints_scanned FROM users u LEFT JOIN incident_assignments a ON a.officer_id=u.id LEFT JOIN incidents i ON i.id=a.incident_id AND i.reported_datetime >= $1::date AND i.reported_datetime < $2::date + 1 WHERE u.role='security_officer' GROUP BY u.id ORDER BY 2 DESC` },
  discipline: { roles: ['admin', 'head_security', 'dean'], sql: `SELECT i.reference_no, c.name AS category, i.severity, i.status, i.reported_datetime FROM incidents i LEFT JOIN incident_categories c ON c.id=i.category_id WHERE i.referred_to_discipline AND i.reported_datetime >= $1::date AND i.reported_datetime < $2::date + 1 ORDER BY i.reported_datetime` },
  audit: { roles: ['admin', 'head_security'], sql: `SELECT created_at, actor, action, entity, entity_id, ip, status FROM audit_log WHERE created_at >= $1::date AND created_at < $2::date + 1 ORDER BY created_at DESC LIMIT 5000` },
};

const csvCell = (v) => {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

router.get('/reports/:type', auth, async (req, res) => {
  const r = REPORTS[req.params.type];
  if (!r || !r.roles.includes(req.user.role)) return res.status(404).json({ error: 'Report not available.' });
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { rows } = await q(r.sql, [from, to]);
  await audit(req, 'REPORT_GENERATED', 'report', req.params.type, { from, to, format: req.query.format || 'json' });
  if (req.query.format === 'csv') {
    const cols = rows[0] ? Object.keys(rows[0]) : [];
    const csv = '﻿' + [cols.join(','), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\r\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${req.params.type}_${from}_${to}.csv"` });
    return res.send(csv);
  }
  res.json({ type: req.params.type, from, to, rows });
});
router.get('/reports', auth, (req, res) => res.json(Object.keys(REPORTS).filter((k) => REPORTS[k].roles.includes(req.user.role))));

module.exports = router;
