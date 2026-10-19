
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const ROLES = {
  ADMIN: 'admin',
  HEAD_OF_SECURITY: 'head_security',
  SECURITY_OFFICER: 'security_officer',
  COLLEGE_MANAGEMENT: 'management',
  DEAN: 'dean',
  STAFF: 'staff',
  STUDENT: 'student',
};

async function loadUser(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) return null;

  const payload = jwt.verify(token, config.jwtSecret);

  const { rows } = await db.query(
    `SELECT id, username, role, auth_version
       FROM users
      WHERE id = $1 AND is_active = TRUE`,
    [payload.sub]
  );

  if (!rows[0]) return null;
  if (Number(rows[0].auth_version || 0) !== Number(payload.ver || 0)) return null;

  return {
    id: rows[0].id,
    username: rows[0].username,
    role: rows[0].role,
  };
}

async function authenticate(req, res, next) {
  try {
    const user = await loadUser(req);

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError'
    ) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    next(err);
  }
}

async function optionalAuth(req, res, next) {
  try {
    if (req.headers.authorization) {
      req.user = (await loadUser(req)) || undefined;
    }
    next();
  } catch (err) {
    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError'
    ) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    next(err);
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: 'You do not have permission to do this',
      });
    }
    next();
  };
}

module.exports = { ROLES, authenticate, optionalAuth, requireRole };
