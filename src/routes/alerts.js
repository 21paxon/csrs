const router = require('express').Router();
const { q } = require('../db');
const { auth, requireRole } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { pushToRoles, pushToUsers, notifyRoles, notifyUsers } = require('../lib/notify');
const { sendSms } = require('../lib/sms');

const rateLimit = require('express-rate-limit');
const panicLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5, keyGenerator: (req) => 'u' + req.user.id,
  message: { error: 'Too many alerts in a minute. If this is a real emergency, call the security office directly.' },
  validate: false,
});

const ON_DUTY = ['security_officer', 'head_security'];

const view = (id) => q(
  `SELECT a.*, u.full_name, u.phone, u.reg_no FROM emergency_alerts a JOIN users u ON u.id=a.user_id WHERE a.id=$1`, [id]).then((r) => r.rows[0]);

// FR-06: one-action panic alert. The sender is always identified.
router.post('/', auth, panicLimiter, async (req, res) => {
  const { lat, lng, message } = req.body || {};
  const { rows } = await q(
    'INSERT INTO emergency_alerts(user_id,lat,lng,message) VALUES($1,$2,$3,$4) RETURNING id',
    [req.user.id, lat != null ? Number(lat) : null, lng != null ? Number(lng) : null, message ? String(message).slice(0, 500) : null]);
  const alert = await view(rows[0].id);
  await audit(req, 'EMERGENCY_ALERT', 'alert', alert.id, { hasLocation: lat != null });

  // Persisted notification first (never lost), then live push, then SMS.
  await notifyRoles(ON_DUTY, '🚨 EMERGENCY ALERT', `${alert.full_name} (${alert.phone || 'no phone'}) needs help`, 'emergency', '#/alerts');
  pushToRoles([...ON_DUTY, 'admin'], 'emergency', alert);
  const { rows: officers } = await q('SELECT phone FROM users WHERE role = ANY($1) AND is_active AND phone IS NOT NULL', [ON_DUTY]);
  officers.forEach((o) => sendSms(o.phone, `CSRS EMERGENCY: ${alert.full_name} ${alert.phone || ''} at ${alert.lat ? alert.lat + ',' + alert.lng : 'unknown location'}`));

  res.status(201).json({ id: alert.id, message: 'Help has been notified. Stay where you are if it is safe to do so.' });
});

router.get('/emergency-contacts', auth, (req, res) => {
  res.json([
    { name: 'Campus Security Office', phone: process.env.SECURITY_PHONE || '+250 000 000 000' },
    { name: 'Police', phone: '112' },
    { name: 'Ambulance (SAMU)', phone: '912' },
    { name: 'Fire & Rescue', phone: '111' },
  ]);
});

router.get('/', auth, requireRole('admin', 'head_security', 'security_officer', 'management'), async (req, res) => {
  const active = req.query.active === 'true';
  const { rows } = await q(
    `SELECT a.*, u.full_name, u.phone, u.reg_no, ab.full_name AS acknowledged_by_name
       FROM emergency_alerts a JOIN users u ON u.id=a.user_id LEFT JOIN users ab ON ab.id=a.acknowledged_by
      ${active ? "WHERE a.status <> 'Resolved'" : ''} ORDER BY a.triggered_at DESC LIMIT 200`);
  res.json(rows);
});

// Mine (sender sees their own alert statuses)
router.get('/mine', auth, async (req, res) => {
  const { rows } = await q('SELECT id,status,triggered_at,acknowledged_at,arrived_at,resolved_at FROM emergency_alerts WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [req.user.id]);
  res.json(rows);
});

const STEPS = {
  acknowledge: { from: ['Triggered'], to: 'Acknowledged', col: 'acknowledged_at' },
  arrived: { from: ['Acknowledged'], to: 'Arrived', col: 'arrived_at' },
  resolve: { from: ['Triggered', 'Acknowledged', 'Arrived'], to: 'Resolved', col: 'resolved_at' },
};

router.post('/:id(\\d+)/:step(acknowledge|arrived|resolve)', auth, requireRole('head_security', 'security_officer'), async (req, res) => {
  const s = STEPS[req.params.step];
  const a = await view(req.params.id);
  if (!a) return res.status(404).json({ error: 'Alert not found.' });
  if (!s.from.includes(a.status)) return res.status(400).json({ error: `Alert is already ${a.status}.` });
  await q(`UPDATE emergency_alerts SET status=$2, ${s.col}=now(),
                  acknowledged_by=CASE WHEN $2='Acknowledged' THEN $3 ELSE acknowledged_by END WHERE id=$1`, [a.id, s.to, req.user.id]);
  await audit(req, 'ALERT_' + s.to.toUpperCase(), 'alert', a.id);
  const updated = await view(a.id);
  pushToRoles([...ON_DUTY, 'admin', 'management'], 'alert-update', updated);
  pushToUsers([a.user_id], 'alert-update', { id: a.id, status: s.to });
  await notifyUsers([a.user_id], `Your alert: ${s.to}`, s.to === 'Acknowledged' ? 'An officer is responding.' : null, 'emergency');
  res.json({ ok: true });
});

// Re-alert until acknowledged: every 30s re-push any alert still 'Triggered'.
setInterval(async () => {
  try {
    const { rows } = await q(
      `SELECT a.*, u.full_name, u.phone, u.reg_no FROM emergency_alerts a JOIN users u ON u.id=a.user_id
        WHERE a.status='Triggered' AND a.triggered_at > now() - interval '1 hour'`);
    rows.forEach((a) => pushToRoles([...ON_DUTY, 'admin'], 'emergency', { ...a, repeat: true }));
  } catch (e) { console.error('alert repeater', e.message); }
}, 30000).unref();

module.exports = router;
