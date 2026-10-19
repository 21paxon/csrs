
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, where, HttpError } = require('../utils/helpers');
const { toCsv } = require('../utils/csv');
const { audit } = require('../utils/audit');

const router = express.Router();

router.use(
  authenticate,
  requireRole(
    ROLES.ADMIN,
    ROLES.HEAD_OF_SECURITY,
    ROLES.COLLEGE_MANAGEMENT,
    ROLES.DEAN
  )
);

function range(w, column, q) {
  if (q.from) w.add(`${column} >= ?`, q.from);
  if (q.to) w.add(`${column} <= ?`, q.to);
}

const REPORTS = {
  incidents: (q) => {
    const w = where();
    range(w, 'i.reported_datetime', q);

    if (q.severity) w.add('i.severity = ?', q.severity);
    if (q.status) w.add('i.status = ?', q.status);
    if (q.location_id) w.add('i.location_id = ?', Number(q.location_id));
    if (q.assigned_to) {
      w.add(`EXISTS (
        SELECT 1 FROM incident_assignments ia
         WHERE ia.incident_id = i.id AND ia.officer_id = ?
      )`, Number(q.assigned_to));
    }

    return [
      `SELECT i.reference_no,
              c.name AS category,
              l.name AS location,
              i.severity,
              i.status,
              i.incident_datetime,
              i.reported_datetime,
              i.closed_datetime,
              i.is_anonymous
         FROM incidents i
         LEFT JOIN incident_categories c ON c.id = i.category_id
         LEFT JOIN locations l ON l.id = i.location_id
         ${w.clause}
        ORDER BY i.reported_datetime DESC`,
      w.params
    ];
  },

  'lost-found': (q) => {
    const w = where();
    range(w, 'i.created_at', q);

    if (q.kind) w.add('i.kind = ?', q.kind);
    if (q.status) w.add('i.status = ?', q.status);

    return [
      `SELECT i.id,
              i.kind,
              i.title,
              i.description,
              i.category,
              i.location_text,
              i.event_date,
              i.status,
              i.collected_by_name,
              i.collected_at,
              i.created_at
         FROM items i
         ${w.clause}
        ORDER BY i.created_at DESC`,
      w.params
    ];
  },

  gate: (q) => {
    const w = where();
    range(w, 'v.entry_at', q);

    if (q.on_campus === 'true') w.raw('v.exit_at IS NULL');

    return [
      `SELECT v.id,
              v.full_name,
              v.id_number,
              v.phone,
              v.purpose,
              v.host_text,
              v.badge_no,
              v.vehicle_plate,
              v.entry_at,
              v.exit_at
         FROM visitors v
         ${w.clause}
        ORDER BY v.entry_at DESC`,
      w.params
    ];
  },

  patrol: (q) => {
    const w = where();
    range(w, 'p.scanned_at', q);

    if (q.officer_id) w.add('p.officer_id = ?', Number(q.officer_id));

    return [
      `SELECT u.username AS officer,
              c.name AS checkpoint,
              p.scanned_at,
              p.notes
         FROM patrol_logs p
         JOIN users u ON u.id = p.officer_id
         JOIN checkpoints c ON c.id = p.checkpoint_id
         ${w.clause}
        ORDER BY p.scanned_at DESC`,
      w.params
    ];
  },

  audit: (q) => {
    const w = where();
    range(w, 'a.created_at', q);

    if (q.action) w.add('a.action = ?', q.action);

    return [
      `SELECT a.id,
              a.actor,
              a.action,
              a.entity,
              a.entity_id,
              a.ip,
              a.status,
              a.created_at
         FROM audit_log a
         ${w.clause}
        ORDER BY a.created_at DESC`,
      w.params
    ];
  }
};

// GET /api/reports/:type?from=&to=&format=csv
router.get('/:type', wrap(async (req, res) => {
  const build = REPORTS[req.params.type];

  if (!build) {
    throw new HttpError(
      404,
      `Unknown report. Available: ${Object.keys(REPORTS).join(', ')}`
    );
  }

  const [sql, params] = build(req.query);
  const { rows } = await db.query(`${sql} LIMIT 10000`, params);

  await audit(req, {
    userId: req.user.id,
    action: `GENERATE REPORT ${req.params.type}`,
    targetTable: 'reports'
  });

  if (req.query.format === 'csv') {
    const csv = rows.length
      ? toCsv(rows)
      : 'No records found';

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="csrs-${req.params.type}-report.csv"`
    );

    return res.send(csv);
  }

  return res.json({
    report: req.params.type,
    count: rows.length,
    rows
  });
}));

module.exports = router;
