const db = require('../db');
const crypto = require('crypto');
const config = require('../config');

const CHANNELS = [
  { channel: 'email', endpoint: 'EMAIL_API_URL', token: 'EMAIL_API_KEY', field: 'email' },
  { channel: 'sms', endpoint: 'SMS_API_URL', token: 'SMS_API_KEY', field: 'phone' }
];

async function persistNotifications(recipients, title, message, type, link) {
  if (!recipients.length) return;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       SELECT uid, $2, $3, $4, $5
         FROM unnest($1::int[]) AS uid`,
      [recipients.map((u) => u.id), title, message, type, link]
    );

    for (const channel of CHANNELS) {
      if (!process.env[channel.endpoint] && process.env.NODE_ENV === 'production') continue;
      const eligible = recipients.filter((u) => u[channel.field]);
      if (!eligible.length) continue;
      const values = [];
      const params = [];
      for (const user of eligible) {
        const base = params.length;
        params.push(channel.channel, user[channel.field], JSON.stringify({
          title, message, type, link, user_id: user.id
        }));
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`);
      }
      await client.query(
        `INSERT INTO notification_queue (channel, recipient, payload)
         VALUES ${values.join(', ')}`,
        params
      );
    }
    const nativePushConfigured = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
    const adapterPushConfigured = process.env.PUSH_API_URL && process.env.PUSH_API_KEY;
    if (nativePushConfigured || adapterPushConfigured || process.env.NODE_ENV !== 'production') {
      const { rows: subscriptions } = await client.query(
        `SELECT user_id, endpoint, p256dh, auth
           FROM push_subscriptions WHERE user_id = ANY($1::int[])`,
        [recipients.map((u) => u.id)]
      );
      if (subscriptions.length) {
        const params = [];
        const values = subscriptions.map((sub) => {
          const base = params.length;
          params.push('push', sub.endpoint, JSON.stringify({
            title, message, type, link, keys: { p256dh: sub.p256dh, auth: sub.auth }
          }));
          return `($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`;
        });
        await client.query(
          `INSERT INTO notification_queue (channel, recipient, payload)
           VALUES ${values.join(', ')}`,
          params
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function notify(userIds, title, message, type = 'info', link = null) {
  const ids = [...new Set(userIds.filter(Boolean).map(Number))];
  if (!ids.length) return;
  const { rows } = await db.query(
    `SELECT id, email, phone FROM users
      WHERE id = ANY($1::int[]) AND is_active = TRUE`,
    [ids]
  );
  await persistNotifications(rows, title, message, type, link);
}

function normalizeRoles(roleNames) {
  const aliases = {
    administrator: 'admin', admin: 'admin',
    'head of security': 'head_security', head_security: 'head_security',
    'security officer': 'security_officer', security_officer: 'security_officer',
    'college management': 'management', management: 'management',
    dean: 'dean', 'dean of students': 'dean', staff: 'staff',
    student: 'student', students: 'student'
  };
  return [...new Set((roleNames || [])
    .map((name) => aliases[String(name || '').trim().toLowerCase()])
    .filter(Boolean))];
}

async function notifyRoles(roleNames, title, message, type = 'info', link = null) {
  const roles = normalizeRoles(roleNames);
  if (!roles.length) return;
  const { rows } = await db.query(
    `SELECT id, email, phone FROM users
      WHERE role = ANY($1::text[]) AND is_active = TRUE`,
    [roles]
  );
  await persistNotifications(rows, title, message, type, link);
}

async function notifyOnDutyOfficers(title, message, type = 'emergency', link = null) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.email, u.phone
       FROM users u
       JOIN duty_rosters d ON d.officer_id = u.id
      WHERE u.role = $1 AND u.is_active = TRUE
        AND d.start_at <= CURRENT_TIMESTAMP AND d.end_at >= CURRENT_TIMESTAMP`,
    ['security_officer']
  );
  await persistNotifications(rows, title, message, type, link);
  return rows.length;
}

function encryptSensitivePayload(payload) {
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()
  ]);
  return {
    encrypted: true,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  };
}

async function queueSensitiveEmail(userId, title, message) {
  const { rows } = await db.query(
    'SELECT email FROM users WHERE id = $1 AND is_active = TRUE',
    [userId]
  );
  if (!rows[0]?.email) return;
  await db.query(
    `INSERT INTO notification_queue (channel, recipient, payload)
     VALUES ('email', $1, $2::jsonb)`,
    [rows[0].email, JSON.stringify(encryptSensitivePayload({
      title, message, type: 'account', user_id: userId, sensitive: true
    }))]
  );
}

module.exports = { notify, notifyRoles, notifyOnDutyOfficers, queueSensitiveEmail, encryptSensitivePayload };
