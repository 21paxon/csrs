
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, toInt, toBool, paging, HttpError } = require('../utils/helpers');
const { notifyRoles } = require('../utils/notify');
const { audit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate);

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
