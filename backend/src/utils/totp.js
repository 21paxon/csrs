// Purpose: Shared totp helpers used by backend features.
const crypto = require('crypto');
const config = require('../config');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of String(value).toUpperCase().replace(/=+$/, '')) {
    const digit = BASE32.indexOf(char);
    if (digit < 0) throw new Error('Invalid authenticator secret');
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function createSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function codeAt(secret, timestamp = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30000)));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1000000).padStart(6, '0');
}

function verifyCode(secret, candidate, timestamp = Date.now()) {
  const code = String(candidate || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  for (const drift of [-1, 0, 1]) {
    const expected = codeAt(secret, timestamp + drift * 30000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
  }
  return false;
}

function seal(secret) {
  const key = crypto.createHash('sha256').update(config.mfaEncryptionKey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function unseal(value) {
  const [ivText, tagText, ciphertextText] = String(value || '').split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted MFA secret');
  const key = crypto.createHash('sha256').update(config.mfaEncryptionKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function recoveryCodes(count = 10) {
  const codes = Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
  return {
    codes: codes.map((code) => `${code.slice(0, 5)}-${code.slice(5)}`),
    hashes: codes.map(hashRecoveryCode)
  };
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256')
    .update(String(code || '').replace(/[^a-z0-9]/gi, '').toUpperCase())
    .digest('hex');
}

module.exports = { createSecret, verifyCode, seal, unseal, recoveryCodes, hashRecoveryCode };
