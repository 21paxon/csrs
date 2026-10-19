
const express = require('express');
const db = require('../db');
const {
  authenticate,
  requireRole,
  ROLES
} = require('../middleware/auth');
const {
  wrap,
  toNum,
  toInt,
  paging,
  HttpError
} = require('../utils/helpers');
const { notifyRoles, notifyOnDutyOfficers } = require('../utils/notify');
const { audit } = require('../utils/audit');

const router = express.Router();

const RESPONDERS = [
  ROLES.ADMIN,
  ROLES.HEAD_OF_SECURITY,
  ROLES.SECURITY_OFFICER
];

// POST /api/emergency
// Any authenticated user can trigger an emergency alert.
router.post(
  '/',
  authenticate,
  wrap(async (req, res) => {
    const lat = toNum(req.body?.latitude ?? req.body?.lat);
    const lng = toNum(req.body?.longitude ?? req.body?.lng);

    if (
      (lat !== null && (lat < -90 || lat > 90)) ||
      (lng !== null && (lng < -180 || lng > 180))
    ) {
      throw new HttpError(400, 'Invalid coordinates');
    }

    const { rows } = await db.query(
      `INSERT INTO emergency_alerts
         (user_id, lat, lng, message, status)
       VALUES ($1, $2, $3, $4, 'Triggered')
       RETURNING id, user_id, lat, lng, message, status, triggered_at`,
      [
        req.user.id,
        lat,
        lng,
        req.body?.message || 'Emergency assistance requested'
      ]
    );

    const alert = rows[0];

    const location =
      lat !== null && lng !== null
        ? ` Location: ${lat}, ${lng}.`
        : '';

    await notifyRoles(
      [
        ROLES.ADMIN,
        ROLES.HEAD_OF_SECURITY
      ],
      'EMERGENCY ALERT',
      `Panic alert #${alert.id} from ${req.user.username}.${location}`,
      'emergency',
      `/emergency/${alert.id}`
    );
    await notifyOnDutyOfficers(
      'EMERGENCY ALERT',
      `Panic alert #${alert.id} from ${req.user.username}.${location}`,
      'emergency',
      `/emergency/${alert.id}`
    );

    await audit(req, {
      userId: req.user.id,
      action: 'TRIGGER EMERGENCY ALERT',
      targetTable: 'emergency_alerts',
      recordId: alert.id
    });

    res.status(201).json(alert);
  })
);

// GET /api/emergency
// Only authorized responders can list alerts.
router.get(
  '/',
  authenticate,
  requireRole(...RESPONDERS),
  wrap(async (req, res) => {
    const { limit, offset } = paging(req);
    const params = [];
    let clause = '';

    if (req.query.status) {
      params.push(req.query.status);
      clause = 'WHERE a.status = $1';
    }

    params.push(limit, offset);

    const { rows } = await db.query(
      `SELECT
          a.id,
          a.user_id,
          u.username,
          u.phone,
          a.lat,
          a.lng,
          a.message,
          a.status,
          a.triggered_at,
          a.acknowledged_at,
          a.acknowledged_by,
          a.arrived_at,
          a.resolved_at
       FROM emergency_alerts a
       JOIN users u ON u.id = a.user_id
       ${clause}
       ORDER BY a.triggered_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params
    );

    res.json(rows);
  })
);

// Advance an alert through its response lifecycle.
async function advance(
  req,
  res,
  allowedStatuses,
  newStatus,
  timestampColumn,
  action
) {
  const id = toInt(req.params.id);

  if (!id || id < 1) {
    throw new HttpError(400, 'Invalid alert id');
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const update = await client.query(
      `UPDATE emergency_alerts
          SET status = $1,
              ${timestampColumn} = CURRENT_TIMESTAMP,
              acknowledged_by = CASE
                WHEN $1 = 'Acknowledged' THEN $2
                ELSE acknowledged_by
              END
        WHERE id = $3
          AND status = ANY($4::text[])
        RETURNING
          id,
          user_id,
          status,
          acknowledged_at,
          acknowledged_by,
          arrived_at,
          resolved_at`,
      [newStatus, req.user.id, id, allowedStatuses]
    );

    if (!update.rows[0]) {
      throw new HttpError(
        409,
        'Alert not found or cannot change to this status'
      );
    }

    const alert = update.rows[0];

    await client.query(
      `INSERT INTO notifications
         (user_id, title, body, type, link)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        alert.user_id,
        'Emergency alert update',
        `Your alert #${id} is now ${newStatus}.`,
        'emergency',
        `/emergency/${id}`
      ]
    );

    await client.query('COMMIT');

    await audit(req, {
      userId: req.user.id,
      action,
      targetTable: 'emergency_alerts',
      recordId: id
    });

    res.json(alert);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // Transaction may already be closed.
    }

    throw err;
  } finally {
    client.release();
  }
}

// PATCH /api/emergency/:id/acknowledge
// Acknowledge an alert that is still Triggered.
router.patch(
  '/:id/acknowledge',
  authenticate,
  requireRole(...RESPONDERS),
  wrap((req, res) =>
    advance(
      req,
      res,
      ['Triggered'],
      'Acknowledged',
      'acknowledged_at',
      'ACKNOWLEDGE ALERT'
    )
  )
);

// PATCH /api/emergency/:id/arrive
router.patch(
  '/:id/arrive',
  authenticate,
  requireRole(...RESPONDERS),
  wrap((req, res) =>
    advance(
      req,
      res,
      ['Acknowledged'],
      'Arrived',
      'arrived_at',
      'MARK ARRIVED'
    )
  )
);

// PATCH /api/emergency/:id/resolve
router.patch(
  '/:id/resolve',
  authenticate,
  requireRole(...RESPONDERS),
  wrap((req, res) =>
    advance(
      req,
      res,
      ['Triggered', 'Acknowledged', 'Arrived'],
      'Resolved',
      'resolved_at',
      'RESOLVE ALERT'
    )
  )
);

module.exports = router;
