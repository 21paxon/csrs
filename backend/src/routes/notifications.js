
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, toInt, toBool, paging, HttpError } = require('../utils/helpers');
const { notifyRoles } = require('../utils/notify');
const { audit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate);

router.get('/push-public-key', (req, res) => {
  const nativePushConfigured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const adapterPushConfigured = Boolean(process.env.PUSH_API_URL && process.env.PUSH_API_KEY);
  res.json({
    public_key: process.env.VAPID_PUBLIC_KEY || null,
    delivery_configured: nativePushConfigured || adapterPushConfigured,
    delivery_provider: nativePushConfigured ? 'native-vapid' : adapterPushConfigured ? 'adapter' : 'missing'
  });
});

router.get('/delivery-status', requireRole(ROLES.ADMIN, ROLES.HEAD_OF_SECURITY), wrap(async (req, res) => {
  const { limit, offset } = paging(req);
  const status = String(req.query.status || '').trim();
  const allowed = ['pending', 'processing', 'sent', 'failed'];
  if (status && !allowed.includes(status)) throw new HttpError(400, 'Invalid delivery status');
  const params = status ? [status] : [];
  const filter = status ? 'WHERE status = $1' : '';
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT id, channel, status, attempts, next_attempt_at, last_error,
            created_at, sent_at
       FROM notification_queue ${filter}
      ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(rows);
}));

router.post('/push-subscriptions', wrap(async (req, res) => {
  const subscription = req.body?.subscription || req.body;
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  let parsed;
  try { parsed = new URL(endpoint); } catch (_) {
    throw new HttpError(400, 'A valid push subscription endpoint is required');
  }
  if (parsed.protocol !== 'https:' || !p256dh || !auth || endpoint.length > 2048) {
    throw new HttpError(400, 'A secure push endpoint and subscription keys are required');
  }
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.user.id, endpoint, p256dh, auth]
  );
  res.status(201).json({ subscribed: true });
}));

router.delete('/push-subscriptions', wrap(async (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  if (!endpoint) throw new HttpError(400, 'endpoint is required');
  const result = await db.query(
    'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [req.user.id, endpoint]
  );
  res.json({ removed: result.rowCount > 0 });
}));

router.get('/', wrap(async (req, res) => {
  const { limit, offset } = paging(req);
  const unreadOnly = toBool(req.query.unread);

  const { rows } = await db.query(
    `SELECT id, title, body, type, link, is_read, created_at
       FROM notifications
      WHERE user_id = $1
        ${unreadOnly ? 'AND is_read = FALSE' : ''}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [req.user.id]
  );

  const count = await db.query(
    `SELECT COUNT(*)::int AS unread
       FROM notifications
      WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );

  res.json({
    unread: count.rows[0].unread,
    notifications: rows
  });
}));

router.patch('/:id/read', wrap(async (req, res) => {
  const id = toInt(req.params.id);

  const result = await db.query(
    `UPDATE notifications
        SET is_read = TRUE
      WHERE id = $1 AND user_id = $2`,
    [id, req.user.id]
  );

  if (!result.rowCount) {
    throw new HttpError(404, 'Notification not found');
  }

  res.json({ read: true });
}));

router.post('/read-all', wrap(async (req, res) => {
  const result = await db.query(
    `UPDATE notifications
        SET is_read = TRUE
      WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );

  res.json({ marked: result.rowCount });
}));

router.post(
  '/announcements',
  requireRole(ROLES.ADMIN, ROLES.HEAD_OF_SECURITY),
  wrap(async (req, res) => {
    const { title, message } = req.body || {};
    const roles = Array.isArray(req.body?.roles) && req.body.roles.length
      ? req.body.roles
      : Object.values(ROLES);

    if (!title || !message) {
      throw new HttpError(400, 'title and message are required');
    }

    await notifyRoles(roles, `Announcement: ${title}`, message, 'announcement');

    await audit(req, {
      userId: req.user.id,
      action: 'SEND ANNOUNCEMENT',
      targetTable: 'notifications'
    });

    res.status(201).json({ sent_to_roles: roles });
  })
);

module.exports = router;
