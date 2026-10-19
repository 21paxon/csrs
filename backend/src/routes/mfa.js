const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { wrap, HttpError } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const totp = require('../utils/totp');

const router = express.Router();
router.use(authenticate);

async function currentUser(userId) {
  const { rows } = await db.query(
    `SELECT id, username, email, password_hash, totp_secret,
            totp_pending_secret, totp_enabled, totp_recovery_codes
       FROM users WHERE id = $1 AND is_active = TRUE`,
    [userId]
  );
  if (!rows[0]) throw new HttpError(404, 'Account not found');
  return rows[0];
}

function checkPassword(user, password) {
  return typeof password === 'string' && bcrypt.compare(password, user.password_hash);
}

async function removeRecoveryCode(userId, storedCodes, candidate) {
  const hash = totp.hashRecoveryCode(candidate);
  if (!Array.isArray(storedCodes) || !storedCodes.includes(hash)) return false;
  const { rowCount } = await db.query(
    `UPDATE users
        SET totp_recovery_codes = (
          SELECT COALESCE(jsonb_agg(code), '[]'::jsonb)
            FROM jsonb_array_elements_text(totp_recovery_codes) AS codes(code)
           WHERE code <> $2
        )
      WHERE id = $1 AND totp_recovery_codes @> jsonb_build_array($2::text)`,
    [userId, hash]
  );
  return rowCount === 1;
}

async function verifyFactor(user, code) {
  if (!user.totp_enabled || !user.totp_secret) return false;
  const secret = totp.unseal(user.totp_secret);
  if (totp.verifyCode(secret, code)) return true;
  return removeRecoveryCode(user.id, user.totp_recovery_codes, code);
}

router.get('/status', wrap(async (req, res) => {
  const user = await currentUser(req.user.id);
  res.json({ enabled: user.totp_enabled, setup_pending: Boolean(user.totp_pending_secret) });
}));

router.post('/setup', wrap(async (req, res) => {
  const user = await currentUser(req.user.id);
  if (user.totp_enabled) throw new HttpError(409, 'Multi-factor authentication is already enabled');
  if (!await checkPassword(user, req.body?.password)) throw new HttpError(401, 'Current password is incorrect');

  const secret = totp.createSecret();
  await db.query('UPDATE users SET totp_pending_secret = $1 WHERE id = $2', [totp.seal(secret), user.id]);
  const issuer = 'CSRS RP Musanze College';
  const label = encodeURIComponent(`${issuer}:${user.email || user.username}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  res.json({ secret, otpauth_uri: uri });
}));

router.post('/enable', wrap(async (req, res) => {
  const user = await currentUser(req.user.id);
  if (user.totp_enabled) throw new HttpError(409, 'Multi-factor authentication is already enabled');
  if (!user.totp_pending_secret) throw new HttpError(400, 'Start setup before enabling multi-factor authentication');
  if (!totp.verifyCode(totp.unseal(user.totp_pending_secret), req.body?.code)) {
    throw new HttpError(400, 'That authenticator code is not valid');
  }
  const recovery = totp.recoveryCodes();
  await db.query(
    `UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL,
                       totp_enabled = TRUE, totp_recovery_codes = $1::jsonb
      WHERE id = $2`,
    [JSON.stringify(recovery.hashes), user.id]
  );
  await audit(req, { userId: user.id, action: 'ENABLE TOTP MFA', targetTable: 'users', recordId: user.id });
  res.json({ enabled: true, recovery_codes: recovery.codes });
}));

router.post('/recovery-codes', wrap(async (req, res) => {
  const user = await currentUser(req.user.id);
  if (!user.totp_enabled) throw new HttpError(409, 'Enable multi-factor authentication first');
  if (!await checkPassword(user, req.body?.password)) throw new HttpError(401, 'Current password is incorrect');
  if (!await verifyFactor(user, req.body?.code)) throw new HttpError(400, 'Authenticator or recovery code is not valid');
  const recovery = totp.recoveryCodes();
  await db.query('UPDATE users SET totp_recovery_codes = $1::jsonb WHERE id = $2', [JSON.stringify(recovery.hashes), user.id]);
  await audit(req, { userId: user.id, action: 'REGENERATE MFA RECOVERY CODES', targetTable: 'users', recordId: user.id });
  res.json({ recovery_codes: recovery.codes });
}));

router.post('/disable', wrap(async (req, res) => {
  const user = await currentUser(req.user.id);
  if (!user.totp_enabled) throw new HttpError(409, 'Multi-factor authentication is not enabled');
  if (!await checkPassword(user, req.body?.password)) throw new HttpError(401, 'Current password is incorrect');
  if (!await verifyFactor(user, req.body?.code)) throw new HttpError(400, 'Authenticator or recovery code is not valid');
  await db.query(
    `UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL,
                       totp_enabled = FALSE, totp_recovery_codes = '[]'::jsonb
      WHERE id = $1`,
    [user.id]
  );
  await audit(req, { userId: user.id, action: 'DISABLE TOTP MFA', targetTable: 'users', recordId: user.id });
  res.json({ enabled: false });
}));

module.exports = router;
