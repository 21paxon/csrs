const jwt = require('jsonwebtoken');
const { q } = require('../db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
  console.error('JWT_SECRET must be set (16+ chars) in .env');
  process.exit(1);
}

const SECURITY_ROLES = ['admin', 'head_security', 'security_officer'];
const STAFF_ROLES = ['head_security', 'security_officer'];

const sign = (u) => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '8h' });

async function loadUser(token) {
  const p = jwt.verify(token, SECRET);
  const { rows } = await q(
    'SELECT id, full_name, email, reg_no, username, phone, role, is_active, lang FROM users WHERE id=$1', [p.id]);
  const u = rows[0];
  return u && u.is_active ? u : null;
}

// Requires a valid token. Re-checks the user in the DB so deactivated accounts lose access immediately.
async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please log in to continue.' });
    const u = await loadUser(token);
    if (!u) return res.status(401).json({ error: 'Your session is no longer valid. Please log in again.' });
    req.user = u;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

// Optional auth: sets req.user when a valid token is present, otherwise continues anonymously.
async function optionalAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) req.user = await loadUser(h.slice(7));
  } catch (_) { /* ignore */ }
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'You do not have permission to do that.' });

module.exports = { sign, auth, optionalAuth, requireRole, loadUser, SECURITY_ROLES, STAFF_ROLES };
