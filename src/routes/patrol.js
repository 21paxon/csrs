const router = require('express').Router();
const { q, tx } = require('../db');
const { auth, requireRole } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notifyRoles } = require('../lib/notify');

const HEAD = ['head_security', 'admin'];
const SEC = ['head_security', 'admin', 'security_officer'];

router.get('/checkpoints', auth, requireRole(...SEC), async (req, res) =>
  res.json((await q('SELECT c.*, l.name AS location FROM checkpoints c LEFT JOIN locations l ON l.id=c.location_id ORDER BY c.id')).rows));

router.post('/checkpoints', auth, requireRole(...HEAD), async (req, res) => {
  const { name, code, location_id } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: 'Name and QR code value are required.' });
  try {
    const { rows } = await q('INSERT INTO checkpoints(name,code,location_id) VALUES($1,$2,$3) RETURNING *', [name, code, location_id || null]);
    await audit(req, 'CHECKPOINT_CREATED', 'checkpoint', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That checkpoint code already exists.' }); throw e; }
});

router.get('/routes', auth, requireRole(...SEC), async (req, res) =>
  res.json((await q(`SELECT r.*, COALESCE(json_agg(json_build_object('id',c.id,'name',c.name,'code',c.code,'seq',rc.seq) ORDER BY rc.seq) FILTER (WHERE c.id IS NOT NULL),'[]') AS checkpoints
                       FROM patrol_routes r LEFT JOIN route_checkpoints rc ON rc.route_id=r.id LEFT JOIN checkpoints c ON c.id=rc.checkpoint_id GROUP BY r.id ORDER BY r.id`)).rows));

router.post('/routes', auth, requireRole(...HEAD), async (req, res) => {
  const { name, checkpoint_ids } = req.body || {};
  if (!name || !Array.isArray(checkpoint_ids) || !checkpoint_ids.length) return res.status(400).json({ error: 'Give the route a name and at least one checkpoint.' });
  const route = await tx(async (c) => {
    const { rows } = await c.query('INSERT INTO patrol_routes(name) VALUES($1) RETURNING *', [name]);
    for (const [i, id] of checkpoint_ids.entries())
      await c.query('INSERT INTO route_checkpoints(route_id,checkpoint_id,seq) VALUES($1,$2,$3)', [rows[0].id, Number(id), i + 1]);
    return rows[0];
  });
  await audit(req, 'ROUTE_CREATED', 'route', route.id);
  res.status(201).json(route);
});

// Duty roster / shifts
router.post('/roster', auth, requireRole(...HEAD), async (req, res) => {
  const { officer_id, route_id, start_at, end_at } = req.body || {};
  if (!officer_id || !start_at || !end_at || new Date(end_at) <= new Date(start_at)) return res.status(400).json({ error: 'Choose an officer and a valid start and end time.' });
  const { rows } = await q('INSERT INTO duty_rosters(officer_id,route_id,start_at,end_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [officer_id, route_id || null, start_at, end_at, req.user.id]);
  await audit(req, 'ROSTER_CREATED', 'roster', rows[0].id);
  res.status(201).json(rows[0]);
});

router.get('/roster', auth, requireRole(...SEC), async (req, res) => {
  const mine = req.user.role === 'security_officer';
  const { rows } = await q(
    `SELECT d.*, u.full_name AS officer, r.name AS route FROM duty_rosters d JOIN users u ON u.id=d.officer_id LEFT JOIN patrol_routes r ON r.id=d.route_id
      WHERE d.end_at > now() - interval '1 day' ${mine ? 'AND d.officer_id=$1' : ''} ORDER BY d.start_at`, mine ? [req.user.id] : []);
  res.json(rows);
});

router.post('/roster/:id(\\d+)/handover', auth, requireRole(...SEC), async (req, res) => {
  await q('UPDATE duty_rosters SET handover_notes=$2 WHERE id=$1', [req.params.id, String(req.body.notes || '').slice(0, 2000)]);
  await audit(req, 'HANDOVER_NOTES', 'roster', req.params.id);
  res.json({ ok: true });
});

// UC-09: QR scan check-in (the QR encodes the checkpoint code)
router.post('/checkin', auth, requireRole('security_officer', 'head_security'), async (req, res) => {
  const { code, notes } = req.body || {};
  const cp = (await q('SELECT * FROM checkpoints WHERE code=$1', [String(code || '').trim()])).rows[0];
  if (!cp) return res.status(404).json({ error: 'Unknown checkpoint code. Scan the QR code on the checkpoint again.' });
  const roster = (await q('SELECT id FROM duty_rosters WHERE officer_id=$1 AND start_at<=now() AND end_at>now() ORDER BY start_at DESC LIMIT 1', [req.user.id])).rows[0];
  const { rows } = await q('INSERT INTO patrol_logs(officer_id,checkpoint_id,roster_id,notes) VALUES($1,$2,$3,$4) RETURNING *',
    [req.user.id, cp.id, roster ? roster.id : null, notes || null]);
  await audit(req, 'PATROL_CHECKIN', 'checkpoint', cp.id);
  res.status(201).json({ ...rows[0], checkpoint: cp.name });
});

router.get('/logs', auth, requireRole(...SEC), async (req, res) => {
  const mine = req.user.role === 'security_officer';
  const { rows } = await q(
    `SELECT p.*, u.full_name AS officer, c.name AS checkpoint FROM patrol_logs p JOIN users u ON u.id=p.officer_id JOIN checkpoints c ON c.id=p.checkpoint_id
      ${mine ? 'WHERE p.officer_id=$1' : ''} ORDER BY p.scanned_at DESC LIMIT 300`, mine ? [req.user.id] : []);
  res.json(rows);
});

// Missed-checkpoint detection: for each active shift with a route, list checkpoints not
// scanned during the shift (once the shift is >50% elapsed). Also runs every 5 minutes to alert.
async function missed() {
  const { rows } = await q(
    `SELECT d.id AS roster_id, u.full_name AS officer, c.name AS checkpoint
       FROM duty_rosters d
       JOIN users u ON u.id=d.officer_id
       JOIN route_checkpoints rc ON rc.route_id=d.route_id
       JOIN checkpoints c ON c.id=rc.checkpoint_id
      WHERE d.start_at<=now() AND d.end_at>now()
        AND now() > d.start_at + (d.end_at - d.start_at) / 2
        AND NOT EXISTS (SELECT 1 FROM patrol_logs p WHERE p.roster_id=d.id AND p.checkpoint_id=c.id)`);
  return rows;
}
router.get('/missed', auth, requireRole(...SEC), async (req, res) => res.json(await missed()));

const alerted = new Set();
setInterval(async () => {
  try {
    for (const m of await missed()) {
      const key = m.roster_id + ':' + m.checkpoint;
      if (alerted.has(key)) continue;
      alerted.add(key);
      await notifyRoles(['head_security'], 'Missed checkpoint', `${m.officer} has not checked in at ${m.checkpoint}`, 'patrol');
    }
  } catch (e) { console.error('missed-checkpoint job', e.message); }
}, 5 * 60 * 1000).unref();

module.exports = router;
