
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../utils/audit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }

    const { rows } = await db.query(
      `SELECT id, username, email, password_hash, is_active, role
       FROM users
       WHERE username = $1 OR email = $1
       LIMIT 1`,
      [username]
    );

    const user = rows[0];
    const ok = user &&
      user.is_active &&
      await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      await audit(req, {
        userId: user ? user.id : null,
        action: 'LOGIN',
        targetTable: 'users',
        recordId: user ? user.id : null,
        status: 'Failed'
      });

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
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
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, username, email, phone, role
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (
      !currentPassword ||
      !newPassword ||
      newPassword.length < 12
    ) {
      return res.status(400).json({
        error: 'Current password and a new password of at least 12 characters are required'
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
        error: 'Current password is incorrect'
      });
    }

    const hash = await bcrypt.hash(newPassword, 12);

    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, req.user.id]
    );

    await audit(req, {
      userId: req.user.id,
      action: 'CHANGE PASSWORD',
      targetTable: 'users',
      recordId: req.user.id
    });

    return res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' }
});

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const {
      fullName,
      username,
      email,
      password,
      registrationNumber,
      phone
    } = req.body || {};

    const cleanFullName = String(fullName || '').trim();
    const cleanUsername = String(username || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanRegNo = String(registrationNumber || '').trim();
    const cleanPhone = String(phone || '').trim();

    if (!cleanFullName || !cleanUsername || !cleanEmail || !password) {
      return res.status(400).json({
        error: 'Full name, username, email and password are required'
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
        error: 'One or more fields exceed the allowed length'
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({
        error: 'Enter a valid email address'
      });
    }

    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(cleanUsername)) {
      return res.status(400).json({
        error: 'Username must be 3–50 characters and use only letters, numbers, dots, underscores or hyphens'
      });
    }

    if (typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({
        error: 'Password must be at least 12 characters'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await db.query(
      `INSERT INTO users
         (full_name, username, email, reg_no, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, username, email, reg_no, phone, role`,
      [
        cleanFullName,
        cleanUsername,
        cleanEmail,
        cleanRegNo || null,
        cleanPhone || null,
        passwordHash,
        'student'
      ]
    );

    return res.status(201).json({
      message: 'Student account created successfully. You can now sign in.',
      user: rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'That username, email or registration number is already registered'
      });
    }

    next(err);
  }
});
module.exports = router;
