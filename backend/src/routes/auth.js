

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../utils/audit');

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
              failed_attempts, locked_until, must_change_password
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

    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role
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

    await db.query(
      `UPDATE users
          SET password_hash = $1,
              must_change_password = FALSE,
              failed_attempts = 0,
              locked_until = NULL
        WHERE id = $2`,
      [passwordHash, req.user.id]
    );

    await audit(req, {
      userId: req.user.id,
      action: 'CHANGE PASSWORD',
      targetTable: 'users',
      recordId: req.user.id
    });

    return res.json({
      message: 'Password updated successfully.'
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
