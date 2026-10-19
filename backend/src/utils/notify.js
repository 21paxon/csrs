const db = require('../db');

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
      if (!process.env[channel.endpoint]) continue;
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
    if (process.env.PUSH_API_URL) {
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

module.exports = { notify, notifyRoles };
