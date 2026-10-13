
const db = require('../db');

// Create in-app notifications using the current database schema.
async function notify(userIds, title, message, type = 'info', link = null) {
  const ids = [...new Set(userIds.filter(Boolean).map(Number))];
  if (!ids.length) return;

  try {
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       SELECT uid, $2, $3, $4, $5
       FROM unnest($1::int[]) AS uid`,
      [ids, title, message, type, link]
    );
  } catch (err) {
    console.error('Notification failed:', err.message);
  }
}

async function notifyRoles(roleNames, title, message, type = 'info', link = null) {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, title, body, type, link)
       SELECT u.id, $2, $3, $4, $5
       FROM users u
       WHERE u.role = ANY($1::text[])
         AND u.is_active = TRUE`,
      [roleNames, title, message, type, link]
    );
  } catch (err) {
    console.error('Role notification failed:', err.message);
  }
}

module.exports = { notify, notifyRoles };
