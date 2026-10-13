const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');
const { sign, auth } = require('../lib/auth');
const { audit } = require('../lib/audit');

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });

const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, email: u.email, reg_no: u.reg_no, username: u.username,
  phone: u.phone, role: u.role, lang: u.lang,
});

// FR-01: login with email / registration number / username
router.post('/login', loginLimiter, async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Enter your email, registration number or username, and your password.' });
  const id = String(identifier).trim().toLowerCase();
  const { rows } = await q(
    'SELECT * FROM users WHERE lower(email)=$1 OR lower(reg_no)=$1 OR lower(username)=$1', [id]);
  const u = rows[0];
  const fail = async (msg, who) => { await audit(req, 'LOGIN_FAILED', 'user', who && who.id, { identifier: id }, 'Failed', who ? { id: who.id, username: who.username } : null); return res.status(401).json({ error: msg }); };

  if (!u || !u.is_active) return fail('Incorrect login details.', null);
  if (u.locked_until && new Date(u.locked_until) > new Date())
    return fail(`Account temporarily locked after repeated failed attempts. Try again after ${new Date(u.locked_until).toLocaleTimeString()}.`, u);

  const ok = await bcrypt.compare(String(password), u.password_hash);
  if (!ok) {
    const fails = u.failed_attempts + 1;
    if (fails >= MAX_FAILS) {
      await q(`UPDATE users SET failed_attempts=0, locked_until=now() + ($2 || ' minutes')::interval WHERE id=$1`, [u.id, String(LOCK_MINUTES)]);
    } else {
      await q('UPDATE users SET failed_attempts=$2 WHERE id=$1', [u.id, fails]);
    }
    return fail('Incorrect login details.', u);
  }
  await q('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1', [u.id]);
  await audit(req, 'LOGIN', 'user', u.id, null, 'Successful', u);
  res.json({ token: sign(u), user: publicUser(u) });
});

// Self-registration (students/staff only; staff roles are created by an admin)
router.post('/register', loginLimiter, async (req, res) => {
  if (process.env.ALLOW_SELF_REGISTER === 'false')
    return res.status(403).json({ error: 'Self-registration is disabled. Please contact the ICT office.' });
  const { full_name, email, reg_no, phone, password, role } = req.body || {};
  if (!full_name || !password || (!email && !reg_no))
    return res.status(400).json({ error: 'Name, password and an email or registration number are required.' });
  if (String(password).length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const r = role === 'staff' ? 'staff' : 'student';
  try {
    const hash = await bcrypt.hash(String(password), 12);
    const { rows } = await q(
      `INSERT INTO users(full_name,email,reg_no,phone,password_hash,role)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [full_name.trim(), email ? email.trim().toLowerCase() : null, reg_no ? reg_no.trim() : null, phone || null, hash, r]);
    await audit(req, 'USER_REGISTERED', 'user', rows[0].id, { role: r }, 'Successful', rows[0]);
    res.status(201).json({ token: sign(rows[0]), user: publicUser(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An account with that email or registration number already exists.' });
    throw e;
  }
});

router.get('/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { rows } = await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(current_password || ''), rows[0].password_hash)))
    return res.status(400).json({ error: 'Current password is incorrect.' });
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await bcrypt.hash(String(new_password), 12)]);
  await audit(req, 'PASSWORD_CHANGED', 'user', req.user.id);
  res.json({ ok: true });
});

router.patch('/me', auth, async (req, res) => {
  const { phone, lang } = req.body || {};
  await q('UPDATE users SET phone=COALESCE($2,phone), lang=COALESCE($3,lang) WHERE id=$1',
    [req.user.id, phone || null, ['en', 'rw', 'fr'].includes(lang) ? lang : null]);
  res.json({ ok: true });
});

module.exports = router;
