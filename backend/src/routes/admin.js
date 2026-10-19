
const express = require('express');

const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { audit } = require('../utils/audit');

const router = express.Router();

// All routes in this file require an authenticated administrator.
router.use(authenticate, requireRole(ROLES.ADMIN));

const VALID_ROLES = [
  ROLES.ADMIN,
  ROLES.HEAD_OF_SECURITY,
  ROLES.SECURITY_OFFICER,
  ROLES.COLLEGE_MANAGEMENT,
  ROLES.DEAN,
  ROLES.STAFF,
  ROLES.STUDENT
];

function parseUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function handleError(err, res, next) {
  if (err.code === '23503') {
    return res.status(409).json({
      error: 'This operation conflicts with related records.'
    });
  }

  return next(err);
}

// GET /api/admin/users?status=pending
// GET /api/admin/users?status=active
// GET /api/admin/users?status=all
router.get('/users', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'all').toLowerCase();

    if (!['all', 'pending', 'active', 'inactive'].includes(status)) {
      return res.status(400).json({
        error: 'Status must be all, pending, active, or inactive.'
      });
    }

    let condition = '';

    if (status === 'pending' || status === 'inactive') {
      condition = 'WHERE is_active = FALSE';
    } else if (status === 'active') {
      condition = 'WHERE is_active = TRUE';
    }

    const { rows } = await db.query(
      `SELECT id, full_name, username, email, reg_no, phone,
              role, is_active, must_change_password,
              CASE WHEN is_active THEN 'active' ELSE 'pending' END AS status
         FROM users
         ${condition}
        ORDER BY id DESC`
    );

    return res.json({
      success: true,
      count: rows.length,
      users: rows
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/users/stats
router.get('/users/stats', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (
          WHERE is_active = TRUE
        )::int AS active_users,
        COUNT(*) FILTER (
          WHERE is_active = FALSE
        )::int AS pending_users
      FROM users
    `);

    return res.json({
      success: true,
      stats: rows[0]
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/users/:id/approve
router.post('/users/:id/approve', async (req, res, next) => {
  try {
    const id = parseUserId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const { rows } = await db.query(
      `UPDATE users
          SET is_active = TRUE,
              failed_attempts = 0,
              locked_until = NULL
        WHERE id = $1
          AND is_active = FALSE
        RETURNING id, full_name, username, email, role, is_active`,
      [id]
    );

    if (!rows[0]) {
      const existing = await db.query(
        'SELECT id, is_active FROM users WHERE id = $1',
        [id]
      );

      if (!existing.rows[0]) {
        return res.status(404).json({ error: 'User not found.' });
      }

      return res.status(409).json({
        error: 'This account is already active.'
      });
    }

    await audit(req, {
      userId: req.user.id,
      action: 'APPROVE USER',
      targetTable: 'users',
      recordId: id,
      status: 'Approved'
    });

    return res.json({
      success: true,
      message: 'Account approved successfully.',
      user: rows[0]
    });
  } catch (err) {
    return handleError(err, res, next);
  }
});

// POST /api/admin/users/:id/deactivate
router.post('/users/:id/deactivate', async (req, res, next) => {
  try {
    const id = parseUserId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    if (String(id) === String(req.user.id)) {
      return res.status(400).json({
        error: 'You cannot deactivate your own account.'
      });
    }

    const { rows } = await db.query(
      `UPDATE users
          SET is_active = FALSE
        WHERE id = $1
          AND is_active = TRUE
        RETURNING id, full_name, username, role, is_active`,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Active user not found.'
      });
    }

    await audit(req, {
      userId: req.user.id,
      action: 'DEACTIVATE USER',
      targetTable: 'users',
      recordId: id,
      status: 'Deactivated'
    });

    return res.json({
      success: true,
      message: 'Account deactivated successfully.',
      user: rows[0]
    });
  } catch (err) {
    return handleError(err, res, next);
  }
});

// POST /api/admin/users/:id/activate
router.post('/users/:id/activate', async (req, res, next) => {
  try {
    const id = parseUserId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const { rows } = await db.query(
      `UPDATE users
          SET is_active = TRUE,
              failed_attempts = 0,
              locked_until = NULL
        WHERE id = $1
          AND is_active = FALSE
        RETURNING id, full_name, username, role, is_active`,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Inactive user not found.'
      });
    }

    await audit(req, {
      userId: req.user.id,
      action: 'ACTIVATE USER',
      targetTable: 'users',
      recordId: id,
      status: 'Activated'
    });

    return res.json({
      success: true,
      message: 'Account activated successfully.',
      user: rows[0]
    });
  } catch (err) {
    return handleError(err, res, next);
  }
});

// DELETE /api/admin/users/:id/reject
// Permanently removes an inactive registration request.
// This is not a soft-delete operation.
async function rejectUser(req, res, next) {
  try {
    const id = parseUserId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const { rows } = await db.query(
      `DELETE FROM users
        WHERE id = $1
          AND is_active = FALSE
        RETURNING id, full_name, username, role`,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Pending registration not found.'
      });
    }

    await audit(req, {
      userId: req.user.id,
      action: 'REJECT USER REGISTRATION',
      targetTable: 'users',
      recordId: id,
      status: 'Rejected and deleted'
    });

    return res.json({
      success: true,
      message: 'Pending registration rejected and deleted.',
      user: rows[0]
    });
  } catch (err) {
    return handleError(err, res, next);
  }
}

router.delete('/users/:id/reject', rejectUser);
router.post('/users/:id/reject', rejectUser);

module.exports = router;
