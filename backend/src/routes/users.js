
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { audit } = require('../utils/audit');

const router = express.Router();

function normalizeRole(value) {
  const aliases = {
    'administrator': ROLES.ADMIN,
    'admin': ROLES.ADMIN,
    'head of security': ROLES.HEAD_OF_SECURITY,
    'head_security': ROLES.HEAD_OF_SECURITY,
    'security officer': ROLES.SECURITY_OFFICER,
    'security_officer': ROLES.SECURITY_OFFICER,
    'college management': ROLES.COLLEGE_MANAGEMENT,
    'management': ROLES.COLLEGE_MANAGEMENT,
    'dean': ROLES.DEAN,
    'staff': ROLES.STAFF,
    'student': ROLES.STUDENT
  };

  return aliases[String(value || '').trim().toLowerCase()] || null;
}

const OFFICERS = [
  ROLES.ADMIN,
  ROLES.HEAD_OF_SECURITY
];

// Officers available for incident assignment.
router.get(
  '/officers',
  authenticate,
  requireRole(...OFFICERS),
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT id, username, full_name, phone
           FROM users
          WHERE role = $1 AND is_active = TRUE
          ORDER BY full_name, username`,
        [ROLES.SECURITY_OFFICER]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
);

// Staff members who can host visitors.
router.get(
  '/hosts',
  authenticate,
  requireRole(
    ROLES.ADMIN,
    ROLES.HEAD_OF_SECURITY,
    ROLES.SECURITY_OFFICER
  ),
  async (req, res, next) => {
    try {
      const q = req.query.q ? `%${req.query.q}%` : null;
      const { rows } = await db.query(
        `SELECT id, username, full_name, email, phone, role
           FROM users
          WHERE is_active = TRUE
            AND role IN ($1, $2, $3, $4)
            AND (
              $5::text IS NULL
              OR username ILIKE $5
              OR full_name ILIKE $5
              OR email ILIKE $5
            )
          ORDER BY full_name, username
          LIMIT 50`,
        [
          ROLES.STAFF,
          ROLES.DEAN,
          ROLES.COLLEGE_MANAGEMENT,
          ROLES.ADMIN,
          q
        ]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
);

// All remaining user-management routes are Admin only.
router.use(authenticate, requireRole(ROLES.ADMIN));

// List users.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, full_name, username, email, reg_no, phone,
              role, is_active, created_at
         FROM users
        ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Create a user.
router.post('/', async (req, res, next) => {
  try {
    const {
      username,
      email,
      password,
      role,
      phone,
      fullName,
      registrationNumber
    } = req.body || {};

    const cleanRole = normalizeRole(role);

    if (!username || !email || !password || !cleanRole) {
      return res.status(400).json({
        error: 'Valid username, email, password and role are required',
        valid_roles: Object.values(ROLES)
      });
    }

    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({
        error: 'Password must contain between 12 and 128 characters'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await db.query(
      `INSERT INTO users
         (full_name, username, email, reg_no, phone, password_hash, role,
          must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING id, full_name, username, email, reg_no, phone,
                 role, is_active, created_at`,
      [
        fullName || username,
        username,
        email,
        registrationNumber || null,
        phone || null,
        passwordHash,
        cleanRole
      ]
    );

    await audit(req, {
      userId: req.user.id,
      action: 'CREATE USER',
      targetTable: 'users',
      recordId: rows[0].id
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Username, email or registration number already exists'
      });
    }
    next(err);
  }
});

// Activate/deactivate an account or change its role.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { isActive, role } = req.body || {};

    if (id === Number(req.user.id) && isActive === false) {
      return res.status(400).json({
        error: 'You cannot deactivate your own account'
      });
    }

    const cleanRole = role === undefined ? undefined : normalizeRole(role);

    if (role !== undefined && !cleanRole) {
      return res.status(400).json({ error: 'Unknown role' });
    }

    const { rows } = await db.query(
      `UPDATE users
          SET is_active = COALESCE($1, is_active),
              role = COALESCE($2, role)
        WHERE id = $3
        RETURNING id, full_name, username, email, phone,
                  role, is_active, created_at`,
      [
        typeof isActive === 'boolean' ? isActive : null,
        cleanRole || null,
        id
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    await audit(req, {
      userId: req.user.id,
      action: 'UPDATE USER',
      targetTable: 'users',
      recordId: id
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Issue a one-time temporary password to an account administrator can verify.
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (id === Number(req.user.id)) {
      return res.status(400).json({
        error: 'Use the change-password endpoint for your own account'
      });
    }

    const temporaryPassword = crypto.randomBytes(15).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const { rows } = await db.query(
      `UPDATE users
          SET password_hash = $1,
              must_change_password = TRUE,
              failed_attempts = 0,
              locked_until = NULL
        WHERE id = $2
        RETURNING id, username, email, role`,
      [passwordHash, id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    await audit(req, {
      userId: req.user.id,
      action: 'RESET USER PASSWORD',
      targetTable: 'users',
      recordId: id
    });

    return res.json({
      message: 'Temporary password created. Deliver it securely and require the user to change it after signing in.',
      user: rows[0],
      temporary_password: temporaryPassword
    });
  } catch (err) {
    return next(err);
  }
});

// Bulk import users. Temporary passwords are returned only in this response.
router.post('/import', async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const records = req.body?.records;

    if (!Array.isArray(records) || records.length < 1 || records.length > 1000) {
      return res.status(400).json({
        error: 'records must contain 1 to 1000 items'
      });
    }

    const created = [];
    const skipped = [];

    for (const record of records) {
      if (!record.registration_number || !record.full_name || !record.email) {
        skipped.push({
          record: record.registration_number || null,
          reason: 'Registration number, full name and email are required'
        });
        continue;
      }

      const role = normalizeRole(record.role || ROLES.STUDENT);

      if (![ROLES.STUDENT, ROLES.STAFF].includes(role)) {
        skipped.push({
          record: record.registration_number,
          reason: 'Imported users must have the student or staff role'
        });
        continue;
      }

      const temporaryPassword = crypto.randomBytes(12).toString('base64url');
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);

      try {
        const result = await client.query(
          `INSERT INTO users
             (full_name, username, email, reg_no, phone, password_hash, role,
              must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
           RETURNING id, username`,
          [
            record.full_name,
            record.registration_number,
            record.email,
            record.registration_number,
            record.phone || null,
            passwordHash,
            role
          ]
        );

        created.push({
          id: result.rows[0].id,
          username: result.rows[0].username,
          temporary_password: temporaryPassword
        });
      } catch (err) {
        if (err.code === '23505') {
          skipped.push({
            record: record.registration_number,
            reason: 'Username, email or registration number already exists'
          });
        } else {
          throw err;
        }
      }
    }

    await audit(req, {
      userId: req.user.id,
      action: 'IMPORT USERS',
      targetTable: 'users',
      recordId: null
    });

    res.status(201).json({
      created: created.length,
      skipped,
      accounts: created
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
