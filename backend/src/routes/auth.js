

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const db = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { queueSensitiveEmail } = require('../utils/notify');
const totp = require('../utils/totp');

const router = express.Router();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const PUBLIC_REGISTRATION_ROLES = new Set([
  'student',
  'staff',
  'security_officer',
  'head_security',
  'management',
  'dean'
]);

const REGISTRATION_ROLE_LABELS = {
  student: 'Student',
  staff: 'Staff member',
  security_officer: 'Security officer',
  head_security: 'Head of security',
  management: 'College management',
  dean: 'Dean of students'
};

async function verifyLoginFactor(user, code) {
  if (!user.totp_enabled || !user.totp_secret) return false;
  if (totp.verifyCode(totp.unseal(user.totp_secret), code)) return true;
  const recoveryHash = totp.hashRecoveryCode(code);
  const { rowCount } = await db.query(
    `UPDATE users
        SET totp_recovery_codes = (
          SELECT COALESCE(jsonb_agg(stored_code), '[]'::jsonb)
            FROM jsonb_array_elements_text(totp_recovery_codes) AS codes(stored_code)
           WHERE stored_code <> $2
        )
      WHERE id = $1 AND totp_recovery_codes @> jsonb_build_array($2::text)`,
    [user.id, recoveryHash]
  );
  return rowCount === 1;
}

// Limit login attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts. Please try again later.'
  }
});

// Limit registration attempts.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many registration attempts. Please try again later.'
  }
});
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again later.' }
});

// ==================================================
// PUBLIC ACCOUNT REGISTRATION
// POST /api/auth/register
// ==================================================
router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const {
      fullName,
      username,
      email,
      password,
      registrationNumber,
      phone,
      accountType
    } = req.body || {};

    const cleanFullName = String(fullName || '').trim();
    const cleanUsername = String(username || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanRegNo = String(registrationNumber || '').trim();
    const cleanPhone = String(phone || '').trim();
    const cleanAccountType = String(accountType || 'student').trim().toLowerCase();
    const roleLabel = REGISTRATION_ROLE_LABELS[cleanAccountType];

    const registrationSetting = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'registration_enabled'`
    );
    if (registrationSetting.rows[0]?.setting_value === 'false') {
      return res.status(403).json({ error: 'New account registration is temporarily closed. Contact the college.' });
    }

    if (
      !cleanFullName ||
      !cleanUsername ||
      !cleanEmail ||
      typeof password !== 'string' ||
      !password ||
      !PUBLIC_REGISTRATION_ROLES.has(cleanAccountType)
    ) {
      return res.status(400).json({
        error: 'Choose a valid account type and complete the required fields.'
      });
    }

    if (cleanAccountType === 'student' && !cleanRegNo) {
      return res.status(400).json({
        error: 'Students must provide their college registration number.'
      });
    }

    if (
      cleanFullName.length > 150 ||
      cleanUsername.length > 50 ||
      cleanEmail.length > 100 ||
      cleanRegNo.length > 50 ||
      cleanPhone.length > 20
    ) {
      return res.status(400).json({
        error: 'One or more fields exceed the allowed length.'
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({
        error: 'Enter a valid email address.'
      });
    }

    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(cleanUsername)) {
      return res.status(400).json({
        error:
          'Username must be 3–50 characters and use only letters, numbers, dots, underscores or hyphens.'
      });
    }

    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({
        error: 'Password must contain between 12 and 128 characters.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await db.query(
      `INSERT INTO users
         (full_name, username, email, reg_no, phone, password_hash, role,
          is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, full_name, username, email, reg_no, phone, role`,
      [
        cleanFullName,
        cleanUsername,
        cleanEmail,
        cleanRegNo || null,
        cleanPhone || null,
        passwordHash,
        cleanAccountType,
        cleanAccountType === 'student'
      ]
    );

    const isStudent = cleanAccountType === 'student';
    return res.status(201).json({
      message: isStudent
        ? 'Student account created successfully. You can now sign in.'
        : `${roleLabel} access request submitted. An administrator must approve your account before you can sign in.`,
      requiresApproval: !isStudent,
      user: rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error:
          'That username, email or registration number is already registered.'
      });
    }

    return next(err);
  }
});

// ==================================================
// LOGIN
// POST /api/auth/login
// ==================================================
router.post('/forgot-password', passwordResetLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier || req.body?.email || '').trim();
    const { rows } = await db.query(
      `SELECT id, email FROM users
        WHERE is_active = TRUE AND (email = $1 OR username = $1 OR reg_no = $1)
        LIMIT 1`,
      [identifier]
    );
    if (rows[0] && identifier) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND used_at IS NULL`,
          [rows[0].id]
        );
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
          [rows[0].id, tokenHash]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      const appUrl = String(process.env.PUBLIC_APP_URL || config.frontendOrigins[0] || '').replace(/\/$/, '');
      await queueSensitiveEmail(
        rows[0].id,
        'Reset your CSRS password',
        `Use this one-time link within one hour: ${appUrl}/reset-password.html#token=${token}`
      );
    }
    await audit(req, { action: 'REQUEST PASSWORD RESET', targetTable: 'users', status: 'Accepted' });
    return res.json({ message: 'If the account is active, a password reset link will be sent to its registered email address.' });
  } catch (err) {
    return next(err);
  }
});

router.post('/reset-password', passwordResetLimiter, async (req, res, next) => {
  const token = String(req.body?.token || '').trim();
  const password = req.body?.password;
  if (!/^[a-f0-9]{64}$/i.test(token) || typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Enter a valid reset link and a password of 12 to 128 characters.' });
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  let client;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    client = await db.pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        FOR UPDATE`,
      [tokenHash]
    );
    if (!result.rows[0]) throw new Error('Invalid reset token');
    const reset = result.rows[0];
    await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE,
                         failed_attempts = 0, locked_until = NULL,
                         auth_version = auth_version + 1
        WHERE id = $2
        RETURNING auth_version`,
      [passwordHash, reset.user_id]
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND used_at IS NULL`,
      [reset.user_id]
    );
    await client.query('COMMIT');
    await audit(req, {
      userId: reset.user_id,
      action: 'RESET PASSWORD',
      targetTable: 'users',
      recordId: reset.user_id
    });
    return res.json({ message: 'Password updated. Sign in with your new password.' });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    if (err.message === 'Invalid reset token') {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new link.' });
    }
    return next(err);
  } finally {
    client?.release();
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username.trim() ||
      !password
    ) {
      return res.status(400).json({
        error: 'Username, email or registration number and password are required.'
      });
    }

    const loginName = username.trim();

    const { rows } = await db.query(
      `SELECT id, full_name, username, email, reg_no, password_hash, is_active, role,
              failed_attempts, locked_until, must_change_password, auth_version,
              totp_enabled, totp_secret, totp_recovery_codes
      FROM users
       WHERE username = $1 OR email = $1 OR reg_no = $1
       LIMIT 1`,
      [loginName]
    );

    const user = rows[0];
    const isLocked = user?.locked_until && new Date(user.locked_until) > new Date();

    const passwordMatches = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;
    const validLogin = Boolean(user && user.is_active && !isLocked && passwordMatches);

    if (!validLogin) {
      if (user && !user.is_active && !isLocked && passwordMatches) {
        await audit(req, {
          userId: user.id,
          action: 'LOGIN',
          targetTable: 'users',
          recordId: user.id,
          status: 'Pending approval'
        });
        return res.status(401).json({ error: 'Incorrect login details' });
      }

      if (user && user.is_active && !isLocked && !passwordMatches) {
        const nextAttempts = Number(user.failed_attempts || 0) + 1;
        const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;
        await db.query(
          `UPDATE users
              SET failed_attempts = CASE WHEN $1 THEN 0 ELSE $2 END,
                  locked_until = CASE
                    WHEN $1 THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute')
                    ELSE locked_until
                  END
            WHERE id = $4`,
          [shouldLock, nextAttempts, LOCKOUT_MINUTES, user.id]
        );
      }

      await audit(req, {
        userId: user ? user.id : null,
        action: 'LOGIN',
        targetTable: 'users',
        recordId: user ? user.id : null,
        status: 'Failed'
      });

      return res.status(401).json({
        error: 'Incorrect login details'
      });
    }

    if (user.totp_enabled) {
      if (!req.body?.mfa_code) {
        const challengeToken = jwt.sign(
          { sub: user.id, ver: Number(user.auth_version || 0), purpose: 'mfa_login' },
          config.jwtSecret,
          { expiresIn: '5m' }
        );
        return res.json({ mfa_required: true, challenge_token: challengeToken });
      }
      if (!await verifyLoginFactor(user, req.body.mfa_code)) {
        await audit(req, { userId: user.id, action: 'LOGIN MFA', targetTable: 'users', recordId: user.id, status: 'Failed' });
        return res.status(401).json({ error: 'Invalid authenticator or recovery code.' });
      }
    }

    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        ver: Number(user.auth_version || 0)
      },
      config.jwtSecret,
      {
        expiresIn: config.jwtExpiresIn
      }
    );

    await db.query(
      `UPDATE users
          SET failed_attempts = 0,
              locked_until = NULL
        WHERE id = $1`,
      [user.id]
    );

    await audit(req, {
      userId: user.id,
      action: 'LOGIN',
      targetTable: 'users',
      recordId: user.id
    });

    return res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        email: user.email,
        registrationNumber: user.reg_no,
        reg_no: user.reg_no,
        status: 'active',
        mustChangePassword: user.must_change_password,
        role: user.role
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/login/mfa', loginLimiter, async (req, res, next) => {
  try {
    let challenge;
    try {
      challenge = jwt.verify(String(req.body?.challenge_token || ''), config.jwtSecret);
    } catch (_) {
      return res.status(401).json({ error: 'The sign-in challenge expired. Sign in again.' });
    }
    if (challenge.purpose !== 'mfa_login' || !challenge.sub) {
      return res.status(401).json({ error: 'Invalid sign-in challenge.' });
    }
    const { rows } = await db.query(
      `SELECT id, full_name, username, email, reg_no, role, is_active,
              auth_version, must_change_password, totp_enabled, totp_secret,
              totp_recovery_codes
         FROM users WHERE id = $1`,
      [challenge.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active || !user.totp_enabled || Number(user.auth_version || 0) !== Number(challenge.ver || 0)) {
      return res.status(401).json({ error: 'Sign-in challenge is no longer valid. Sign in again.' });
    }
    if (!await verifyLoginFactor(user, req.body?.code)) {
      await audit(req, { userId: user.id, action: 'LOGIN MFA', targetTable: 'users', recordId: user.id, status: 'Failed' });
      return res.status(401).json({ error: 'Invalid authenticator or recovery code.' });
    }
    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role, ver: Number(user.auth_version || 0) },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
    await audit(req, { userId: user.id, action: 'LOGIN', targetTable: 'users', recordId: user.id, status: 'MFA verified' });
    return res.json({
      token,
      user: {
        id: user.id, full_name: user.full_name, username: user.username,
        email: user.email, registrationNumber: user.reg_no, reg_no: user.reg_no,
        status: 'active', mustChangePassword: user.must_change_password, role: user.role
      }
    });
  } catch (err) {
    return next(err);
  }
});

// ==================================================
// CURRENT USER PROFILE
// GET /api/auth/me
// ==================================================
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, full_name, username, email, reg_no, phone, role,
              is_active, must_change_password, lang
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'User not found.'
      });
    }

    const profile = rows[0];
    return res.json({
      ...profile,
      registrationNumber: profile.reg_no,
      status: profile.is_active ? 'active' : 'pending'
    });
  } catch (err) {
    return next(err);
  }
});

// ==================================================
// CHANGE PASSWORD
// POST /api/auth/change-password
// ==================================================
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      !currentPassword ||
      newPassword.length < 12 ||
      newPassword.length > 128
    ) {
      return res.status(400).json({
        error:
          'Enter your current password and a new password of 12–128 characters.'
      });
    }

    const { rows } = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (
      !rows[0] ||
      !(await bcrypt.compare(currentPassword, rows[0].password_hash))
    ) {
      await audit(req, {
        userId: req.user.id,
        action: 'CHANGE PASSWORD',
        targetTable: 'users',
        recordId: req.user.id,
        status: 'Failed'
      });

      return res.status(401).json({
        error: 'Current password is incorrect.'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    const update = await db.query(
      `UPDATE users
          SET password_hash = $1,
              must_change_password = FALSE,
              failed_attempts = 0,
              locked_until = NULL,
              auth_version = auth_version + 1
        WHERE id = $2
        RETURNING auth_version`,
      [passwordHash, req.user.id]
    );

    const token = jwt.sign(
      { sub: req.user.id, username: req.user.username, role: req.user.role,
        ver: Number(update.rows?.[0]?.auth_version || 0) },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    await audit(req, {
      userId: req.user.id,
      action: 'CHANGE PASSWORD',
      targetTable: 'users',
      recordId: req.user.id
    });

    return res.json({
      message: 'Password updated successfully.',
      token
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
