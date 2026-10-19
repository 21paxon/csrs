
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, toInt, paging, where, HttpError } = require('../utils/helpers');
const { notify, notifyRoles } = require('../utils/notify');
const { audit } = require('../utils/audit');

const router = express.Router();
const GATE = [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY, ROLES.SECURITY_OFFICER];

router.use(authenticate, requireRole(...GATE));

function makeBadge() {
  return `V-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// POST /api/gate/check-in
router.post('/check-in', wrap(async (req, res) => {
  const b = req.body || {};
  const hostId = toInt(b.host_user_id);

  if (!b.full_name || !b.id_number || !b.phone || !b.purpose || !hostId) {
    throw new HttpError(400, 'full_name, id_number, phone, purpose and host_user_id are required');
  }

  const host = await db.query(
    'SELECT id FROM users WHERE id = $1 AND is_active = TRUE',
    [hostId]
  );

  if (!host.rows[0]) {
    throw new HttpError(400, 'host_user_id is not an active user');
  }

  const blocked = await db.query(
    'SELECT id FROM blacklist WHERE id_number = $1 LIMIT 1',
    [b.id_number]
  );

  if (blocked.rows[0]) {
    await audit(req, {
      userId: req.user.id,
      action: 'BLACKLISTED VISITOR REFUSED',
      targetTable: 'blacklist',
      recordId: blocked.rows[0].id,
      status: 'Failed'
    });

    await notifyRoles(
      [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY],
      'Blacklisted visitor at gate',
      `${b.full_name} (ID ${b.id_number}) tried to enter and was refused.`,
      'security'
    );

    throw new HttpError(403, 'This person is blacklisted. Entry refused.');
  }

  const existing = await db.query(
    `SELECT id, entry_at, exit_at
       FROM visitors
      WHERE id_number = $1
      ORDER BY id DESC
      LIMIT 1`,
    [b.id_number]
  );

  if (existing.rows[0] && !existing.rows[0].exit_at) {
    throw new HttpError(409, 'This visitor is already checked in');
  }

  const badge = makeBadge();
  let result;

  if (existing.rows[0]) {
    result = await db.query(
      `UPDATE visitors
          SET full_name = $1,
              phone = $2,
              purpose = $3,
              host_user_id = $4,
              host_text = $5,
              vehicle_plate = $6,
              badge_no = $7,
              entry_at = CURRENT_TIMESTAMP,
              exit_at = NULL,
              registered_by = $8
        WHERE id = $9
        RETURNING id, full_name, id_number, host_user_id,
                  badge_no, vehicle_plate, entry_at, exit_at`,
      [
        b.full_name,
        b.phone,
        b.purpose,
        hostId,
        b.host_text || null,
        b.vehicle_plate || b.vehicle_number || null,
        badge,
        req.user.id,
        existing.rows[0].id
      ]
    );
  } else {
    result = await db.query(
      `INSERT INTO visitors
        (full_name, id_number, phone, purpose, host_user_id,
         host_text, badge_no, vehicle_plate, entry_at, registered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9)
       RETURNING id, full_name, id_number, host_user_id,
                 badge_no, vehicle_plate, entry_at, exit_at`,
      [
        b.full_name,
        b.id_number,
        b.phone,
        b.purpose,
        hostId,
        b.host_text || null,
        badge,
        b.vehicle_plate || b.vehicle_number || null,
        req.user.id
      ]
    );
  }

  const visitor = result.rows[0];

  await notify(
    [hostId],
    'Visitor arrived',
    `${b.full_name} has arrived to see you (${b.purpose}). Badge ${visitor.badge_no}.`,
    'visitor'
  );

  await audit(req, {
    userId: req.user.id,
    action: 'VISITOR CHECK-IN',
    targetTable: 'visitors',
    recordId: visitor.id
  });

  res.status(201).json({
    ...visitor,
    visitor_id: visitor.id,
    badge_number: visitor.badge_no,
    entry_time: visitor.entry_at
  });
}));

// POST /api/gate/:logId/check-out
router.post('/:logId/check-out', wrap(async (req, res) => {
  const id = toInt(req.params.logId);

  if (!id || id < 1) throw new HttpError(400, 'Invalid visitor id');

  const { rows } = await db.query(
    `UPDATE visitors
        SET exit_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND exit_at IS NULL
      RETURNING id, exit_at`,
    [id]
  );

  if (!rows[0]) {
    throw new HttpError(409, 'Visitor not found or already checked out');
  }

  await audit(req, {
    userId: req.user.id,
    action: 'VISITOR CHECK-OUT',
    targetTable: 'visitors',
    recordId: id
  });

  res.json({
    ...rows[0],
    visitor_id: rows[0].id,
    exit_time: rows[0].exit_at
  });
}));

const LOG_SELECT = `
  SELECT v.id, v.id AS visitor_id, v.full_name, v.full_name AS name,
         v.full_name AS visitor_name, v.id_number,
         v.phone, v.purpose, v.host_user_id, v.host_text,
         COALESCE(h.full_name, h.username, v.host_text) AS host_name,
         v.vehicle_plate, v.badge_no, v.badge_no AS badge_number,
         v.entry_at, v.entry_at AS entry_time,
         v.exit_at, v.exit_at AS exit_time, v.registered_by,
         COALESCE(g.full_name, g.username) AS recorded_by,
         CASE WHEN v.exit_at IS NULL THEN 'On Campus' ELSE 'Checked Out' END AS status,
         CASE WHEN v.exit_at IS NULL THEN 'entry' ELSE 'exit' END AS record_type
    FROM visitors v
    LEFT JOIN users h ON h.id = v.host_user_id
    LEFT JOIN users g ON g.id = v.registered_by`;

// GET /api/gate/logs?date=YYYY-MM-DD
router.get('/logs', wrap(async (req, res) => {
  const w = where();

  if (req.query.date) {
    w.add('v.entry_at::date = ?::date', req.query.date);
  }

  if (req.query.visitor_id) {
    const visitorId = toInt(req.query.visitor_id);
    if (!visitorId) throw new HttpError(400, 'Invalid visitor_id');
    w.add('v.id = ?', visitorId);
  }

  const { limit, offset } = paging(req);
  const { rows } = await db.query(
    `${LOG_SELECT} ${w.clause}
      ORDER BY v.entry_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    w.params
  );

  res.json(rows);
}));

// GET /api/gate/on-campus
router.get('/on-campus', wrap(async (req, res) => {
  const { rows } = await db.query(
    `${LOG_SELECT}
      WHERE v.exit_at IS NULL
      ORDER BY v.entry_at`
  );

  res.json(rows);
}));

// PATCH /api/gate/visitors/:id/blacklist
router.patch(
  '/visitors/:id/blacklist',
  requireRole(ROLES.ADMIN, ROLES.HEAD_OF_SECURITY),
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    const flag = req.body?.blacklisted;

    if (!id || id < 1) throw new HttpError(400, 'Invalid visitor id');
    if (typeof flag !== 'boolean') {
      throw new HttpError(400, 'blacklisted must be true or false');
    }

    const visitorResult = await db.query(
      'SELECT id, full_name, id_number FROM visitors WHERE id = $1',
      [id]
    );

    const visitor = visitorResult.rows[0];
    if (!visitor) throw new HttpError(404, 'Visitor not found');

    if (flag) {
      const existing = await db.query(
        'SELECT id FROM blacklist WHERE id_number = $1 LIMIT 1',
        [visitor.id_number]
      );

      if (!existing.rows[0]) {
        await db.query(
          `INSERT INTO blacklist (full_name, id_number, reason, added_by)
           VALUES ($1, $2, $3, $4)`,
          [
            visitor.full_name,
            visitor.id_number,
            req.body?.reason || 'Restricted by campus security',
            req.user.id
          ]
        );
      }
    } else {
      await db.query(
        'DELETE FROM blacklist WHERE id_number = $1',
        [visitor.id_number]
      );
    }

    await audit(req, {
      userId: req.user.id,
      action: flag ? 'BLACKLIST VISITOR' : 'UNBLACKLIST VISITOR',
      targetTable: 'blacklist',
      recordId: id
    });

    res.json({
      id,
      full_name: visitor.full_name,
      id_number: visitor.id_number,
      blacklisted: flag
    });
  })
);

module.exports = router;
