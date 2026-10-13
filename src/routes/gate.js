const router = require('express').Router();
const { q } = require('../db');
const { auth, requireRole } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notifyUsers, notifyRoles } = require('../lib/notify');

const OFFICERS = ['admin', 'head_security', 'security_officer'];

router.post('/visitors', auth, requireRole(...OFFICERS), async (req, res) => {
  const b = req.body || {};
  if (!b.full_name) return res.status(400).json({ error: "Enter the visitor's name." });
  let blocked = null;
  if (b.id_number) {
    blocked = (await q('SELECT * FROM blacklist WHERE id_number=$1', [b.id_number])).rows[0];
  }
  if (blocked && !b.override) {
    await audit(req, 'BLACKLISTED_VISITOR_BLOCKED', 'visitor', null, { id_number: b.id_number }, 'Blocked');
    await notifyRoles(['head_security'], 'Restricted person at gate', `${blocked.full_name || b.full_name} (${b.id_number}): ${blocked.reason || ''}`, 'critical');
    return res.status(409).json({ error: `RESTRICTED PERSON: ${blocked.reason || 'blacklisted'}. Do not admit; contact the Head of Security.`, blacklisted: true });
  }
  const { rows } = await q(
    `INSERT INTO visitors(full_name,id_number,phone,purpose,host_user_id,host_text,badge_no,vehicle_plate,registered_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.full_name, b.id_number || null, b.phone || null, b.purpose || null, b.host_user_id ? Number(b.host_user_id) : null,
     b.host_text || null, b.badge_no || null, b.vehicle_plate || null, req.user.id]);
  await audit(req, 'VISITOR_REGISTERED', 'visitor', rows[0].id);
  if (b.host_user_id) await notifyUsers([Number(b.host_user_id)], 'Visitor at the gate', `${b.full_name} has arrived to see you.`, 'visitor');
  res.status(201).json(rows[0]);
});

router.post('/visitors/:id(\\d+)/exit', auth, requireRole(...OFFICERS), async (req, res) => {
  const r = await q('UPDATE visitors SET exit_at=now() WHERE id=$1 AND exit_at IS NULL', [req.params.id]);
  if (!r.rowCount) return res.status(400).json({ error: 'That visitor is not currently on campus.' });
  await audit(req, 'VISITOR_EXIT', 'visitor', req.params.id);
  res.json({ ok: true });
});

// Gate log. ?on_campus=true for current visitors, ?date=YYYY-MM-DD for a day
router.get('/visitors', auth, requireRole(...OFFICERS, 'management', 'dean'), async (req, res) => {
  const where = []; const p = [];
  if (req.query.on_campus === 'true') where.push('exit_at IS NULL');
  if (req.query.date) { p.push(req.query.date); where.push(`entry_at::date = $${p.length}`); }
  const { rows } = await q(
    `SELECT v.*, u.full_name AS host_name FROM visitors v LEFT JOIN users u ON u.id=v.host_user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY entry_at DESC LIMIT 500`, p);
  res.json(rows);
});

router.get('/blacklist', auth, requireRole(...OFFICERS), async (req, res) => res.json((await q('SELECT * FROM blacklist ORDER BY added_at DESC')).rows));
router.post('/blacklist', auth, requireRole('head_security', 'admin'), async (req, res) => {
  const { full_name, id_number, reason } = req.body || {};
  if (!id_number) return res.status(400).json({ error: 'ID number is required.' });
  const { rows } = await q(
    `INSERT INTO blacklist(full_name,id_number,reason,added_by) VALUES($1,$2,$3,$4)
     ON CONFLICT (id_number) DO UPDATE SET reason=EXCLUDED.reason, full_name=EXCLUDED.full_name RETURNING *`,
    [full_name || null, id_number, reason || null, req.user.id]);
  await audit(req, 'BLACKLIST_ADDED', 'blacklist', rows[0].id);
  res.status(201).json(rows[0]);
});
router.delete('/blacklist/:id(\\d+)', auth, requireRole('head_security', 'admin'), async (req, res) => {
  await q('DELETE FROM blacklist WHERE id=$1', [req.params.id]);
  await audit(req, 'BLACKLIST_REMOVED', 'blacklist', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
