
const express = require('express');

const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { audit } = require('../utils/audit');

const router = express.Router();

// All routes in this file require an authenticated administrator.
router.use(authenticate, requireRole(ROLES.ADMIN));

router.get('/backups/status', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, status, backup_name, started_at, finished_at,
              evidence_entry_count, error_message
         FROM backup_runs ORDER BY started_at DESC LIMIT 20`
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.get('/settings', async (_req, res, next) => {
  try {
    const { rows } = await db.query('SELECT setting_key, setting_value FROM system_settings');
    const values = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
    return res.json({
      settings: {
        registration_enabled: values.registration_enabled !== 'false',
        support_email: values.support_email || '',
        emergency_phone: values.emergency_phone || ''
      },
      integrations: {
        email: Boolean(process.env.EMAIL_API_URL && process.env.EMAIL_API_KEY),
        sms: Boolean(process.env.SMS_API_URL && process.env.SMS_API_KEY),
        push: Boolean(
          (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) ||
          (process.env.PUSH_API_URL && process.env.PUSH_API_KEY)
        ),
        public_app_url: Boolean(process.env.PUBLIC_APP_URL)
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/settings', async (req, res, next) => {
  const updates = req.body || {};
  const values = {};
  if (Object.hasOwn(updates, 'registration_enabled')) {
    if (typeof updates.registration_enabled !== 'boolean') {
      return res.status(400).json({ error: 'registration_enabled must be true or false.' });
    }
    values.registration_enabled = String(updates.registration_enabled);
  }
  if (Object.hasOwn(updates, 'support_email')) {
    const email = String(updates.support_email || '').trim().toLowerCase();
    if (email && (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).json({ error: 'Enter a valid support email address.' });
    }
    values.support_email = email;
  }
  if (Object.hasOwn(updates, 'emergency_phone')) {
    const phone = String(updates.emergency_phone || '').trim();
    if (phone.length > 30 || (phone && !/^[+0-9().\-\s]+$/.test(phone))) {
      return res.status(400).json({ error: 'Enter a valid emergency contact phone number.' });
    }
    values.emergency_phone = phone;
  }
  if (!Object.keys(values).length || Object.keys(updates).some((key) => !Object.hasOwn(values, key))) {
    return res.status(400).json({ error: 'Provide one or more supported settings.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(values)) {
      await client.query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (setting_key) DO UPDATE
           SET setting_value = EXCLUDED.setting_value,
               updated_by = EXCLUDED.updated_by,
               updated_at = CURRENT_TIMESTAMP`,
        [key, value, req.user.id]
      );
    }
    await client.query('COMMIT');
    await audit(req, { userId: req.user.id, action: 'UPDATE SYSTEM SETTINGS', targetTable: 'system_settings' });
    return res.json({ success: true, settings: values });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return next(err);
  } finally {
    client.release();
  }
});

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

    if (status === 'pending') {
      condition = "WHERE approval_status = 'pending'";
    } else if (status === 'active') {
      condition = "WHERE approval_status = 'approved' AND is_active = TRUE";
    } else if (status === 'inactive') {
      condition = "WHERE approval_status = 'approved' AND is_active = FALSE";
    }

    const { rows } = await db.query(
      `SELECT id, full_name, username, email, reg_no, phone,
              role, is_active, must_change_password,
              CASE WHEN approval_status = 'pending' THEN 'pending'
                   WHEN is_active THEN 'active' ELSE 'inactive' END AS status
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
          WHERE approval_status = 'pending'
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
              approval_status = 'approved',
              auth_version = auth_version + 1,
              failed_attempts = 0,
              locked_until = NULL
        WHERE id = $1
          AND approval_status = 'pending'
        RETURNING id, full_name, username, email, role, is_active`,
      [id]
    );

    if (!rows[0]) {
      const existing = await db.query(
        'SELECT id, is_active, approval_status FROM users WHERE id = $1',
        [id]
      );

      if (!existing.rows[0]) {
        return res.status(404).json({ error: 'User not found.' });
      }

      return res.status(409).json({
        error: 'This account is not awaiting approval.'
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
          SET is_active = FALSE,
              auth_version = auth_version + 1
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
              approval_status = 'approved',
              auth_version = auth_version + 1,
              failed_attempts = 0,
              locked_until = NULL
        WHERE id = $1
          AND is_active = FALSE
          AND approval_status = 'approved'
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
          AND approval_status = 'pending'
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
