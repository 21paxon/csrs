const { q } = require('../db');

// ---- Server-Sent Events hub: real-time pushes to logged-in browsers ----
const clients = new Set(); // { id, role, res }

function addClient(user, res) {
  const c = { id: user.id, role: user.role, res };
  clients.add(c);
  return () => clients.delete(c);
}

function push(filter, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (filter(c)) { try { c.res.write(payload); } catch (_) { clients.delete(c); } }
  }
}
const pushToUsers = (ids, event, data) => push((c) => ids.includes(c.id), event, data);
const pushToRoles = (roles, event, data) => push((c) => roles.includes(c.role), event, data);

// Stores a notification row (so it survives offline) and pushes it live.
async function notifyUsers(userIds, title, body, type, link) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await q(
    `INSERT INTO notifications(user_id,title,body,type,link)
     SELECT unnest($1::int[]),$2,$3,$4,$5`, [ids, title, body || null, type || null, link || null]);
  pushToUsers(ids, 'notification', { title, body, type, link });
}

async function notifyRoles(roles, title, body, type, link) {
  const { rows } = await q('SELECT id FROM users WHERE role = ANY($1) AND is_active', [roles]);
  await notifyUsers(rows.map((r) => r.id), title, body, type, link);
}

module.exports = { addClient, push, pushToUsers, pushToRoles, notifyUsers, notifyRoles };
