const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { q } = require('../db');
const { auth, requireRole } = require('../lib/auth');
const { audit } = require('../lib/audit');

const ROLES = ['admin', 'head_security', 'security_officer', 'management', 'dean', 'staff', 'student'];

// Officer list for assignment dropdowns (head of security) + host list for the gate
router.get('/directory', auth, requireRole('admin', 'head_security', 'security_officer'), async (req, res) => {
  const { rows } = await q("SELECT id,full_name,role FROM users WHERE is_active AND role IN ('security_officer','staff','management','dean','head_security') ORDER BY full_name");
  res.json(rows);
});

router.use(auth, requireRole('admin'));

router.get('/users', async (req, res) => {
  const { search, role } = req.query;
  const where = []; const p = [];
  if (role) { p.push(role); where.push(`role=$${p.length}`); }
  if (search) { p.push('%' + search + '%'); where.push(`(full_name ILIKE $${p.length} OR email ILIKE $${p.length} OR reg_no ILIKE $${p.length})`); }
  const { rows } = await q(`SELECT id,full_name,email,reg_no,username,phone,role,is_active,created_at FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, p);
  res.json(rows);
});

router.post('/users', async (req, res) => {
  const { full_name, email, reg_no, username, phone, role, password } = req.body || {};
  if (!full_name || !ROLES.includes(role) || !(email || reg_no || username)) return res.status(400).json({ error: 'Name, a valid role and an email / registration number / username are required.' });
  const pw = password || crypto.randomBytes(6).toString('base64url');
  try {
    const { rows } = await q(
      `INSERT INTO users(full_name,email,reg_no,username,phone,password_hash,role) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,full_name,role`,
      [full_name, email ? email.toLowerCase() : null, reg_no || null, username || null, phone || null, await bcrypt.hash(pw, 12), role]);
    await audit(req, 'USER_CREATED', 'user', rows[0].id, { role });
    res.status(201).json({ ...rows[0], temporary_password: password ? undefined : pw });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That email, registration number or username is already used.' }); throw e; }
});

// Bulk import from college records: [{full_name,reg_no,email,phone,role}] -> students by default
router.post('/users/import', async (req, res) => {
  const list = Array.isArray(req.body.users) ? req.body.users.slice(0, 2000) : [];
  if (!list.length) return res.status(400).json({ error: 'Provide a users array.' });
  const defaultPw = req.body.default_password || crypto.randomBytes(6).toString('base64url');
  const hash = await bcrypt.hash(defaultPw, 10);
  let created = 0; let skipped = 0;
  for (const u of list) {
    if (!u.full_name || !(u.reg_no || u.email)) { skipped++; continue; }
    const role = ['student', 'staff'].includes(u.role) ? u.role : 'student';
    const r = await q(`INSERT INTO users(full_name,email,reg_no,phone,password_hash,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [u.full_name, u.email ? String(u.email).toLowerCase() : null, u.reg_no || null, u.phone || null, hash, role]);
    r.rowCount ? created++ : skipped++;
  }
  await audit(req, 'USERS_IMPORTED', 'user', null, { created, skipped });
  res.json({ created, skipped, default_password: req.body.default_password ? undefined : defaultPw });
});

router.patch('/users/:id(\\d+)', async (req, res) => {
  const { role, is_active, full_name, phone } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (Number(req.params.id) === req.user.id && (is_active === false || (role && role !== 'admin')))
    return res.status(400).json({ error: 'You cannot deactivate or demote your own admin account.' });
  await q('UPDATE users SET role=COALESCE($2,role), is_active=COALESCE($3,is_active), full_name=COALESCE($4,full_name), phone=COALESCE($5,phone) WHERE id=$1',
    [req.params.id, role || null, typeof is_active === 'boolean' ? is_active : null, full_name || null, phone || null]);
  await audit(req, 'USER_UPDATED', 'user', req.params.id, { role, is_active });
  res.json({ ok: true });
});

router.post('/users/:id(\\d+)/reset-password', async (req, res) => {
  const pw = crypto.randomBytes(6).toString('base64url');
  await q('UPDATE users SET password_hash=$2, failed_attempts=0, locked_until=NULL WHERE id=$1', [req.params.id, await bcrypt.hash(pw, 12)]);
  await audit(req, 'PASSWORD_RESET', 'user', req.params.id);
  res.json({ temporary_password: pw });
});

router.post('/categories', async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Name required.' });
  const { rows } = await q('INSERT INTO incident_categories(name,description) VALUES($1,$2) ON CONFLICT (name) DO NOTHING RETURNING *', [req.body.name, req.body.description || null]);
  await audit(req, 'CATEGORY_CREATED', 'category', rows[0] && rows[0].id);
  res.status(201).json(rows[0] || {});
});
router.post('/locations', async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Name required.' });
  const { rows } = await q('INSERT INTO locations(name,lat,lng) VALUES($1,$2,$3) ON CONFLICT (name) DO NOTHING RETURNING *', [req.body.name, req.body.lat || null, req.body.lng || null]);
  await audit(req, 'LOCATION_CREATED', 'location', rows[0] && rows[0].id);
  res.status(201).json(rows[0] || {});
});

router.get('/audit', async (req, res) => {
  const { rows } = await q('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1', [Math.min(500, Number(req.query.limit) || 100)]);
  res.json(rows);
});

module.exports = router;
