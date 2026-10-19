
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, toInt, paging, where, HttpError } = require('../utils/helpers');
const { notify } = require('../utils/notify');
const { audit } = require('../utils/audit');

const router = express.Router();

const MANAGE = [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY];

const STAFFED = [
  ROLES.ADMIN,
  ROLES.HEAD_OF_SECURITY,
  ROLES.SECURITY_OFFICER
];

router.use(authenticate);

router.get('/', requireRole(...STAFFED), wrap(async (req, res) => {
  req.query = req.query || {};
  const w = where();

  if (req.user.role === ROLES.SECURITY_OFFICER) {
    w.add('p.officer_id = ?', req.user.id);
  }

  const { limit, offset } = paging(req);
  const { rows } = await db.query(
    `SELECT p.id, p.officer_id, COALESCE(u.full_name, u.username) AS officer,
            COALESCE(u.full_name, u.username) AS officer_name,
            c.name AS checkpoint, c.name AS name, p.scanned_at,
            p.scanned_at AS start_time, p.notes,
            'Completed' AS status
       FROM patrol_logs p
       JOIN checkpoints c ON c.id = p.checkpoint_id
       JOIN users u ON u.id = p.officer_id
       ${w.clause}
      ORDER BY p.scanned_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    w.params
  );

  res.json(rows);
}));

router.get('/missed', requireRole(...STAFFED), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.id, d.officer_id, COALESCE(u.full_name, u.username) AS officer,
            c.name AS checkpoint, d.start_at, d.end_at, r.name AS route
       FROM duty_rosters d
       JOIN users u ON u.id = d.officer_id
       JOIN patrol_routes r ON r.id = d.route_id
       JOIN route_checkpoints rc ON rc.route_id = d.route_id
       JOIN checkpoints c ON c.id = rc.checkpoint_id
      WHERE d.end_at < CURRENT_TIMESTAMP
        AND d.start_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM patrol_logs p
           WHERE p.officer_id = d.officer_id
             AND p.checkpoint_id = c.id
             AND p.scanned_at BETWEEN d.start_at AND d.end_at
        )
      ORDER BY d.end_at DESC`
  );

  res.json(rows);
}));

// List patrol routes and their checkpoints.
router.get('/routes', requireRole(...STAFFED), wrap(async (req, res) => {
  const { rows } = await db.query(`
    SELECT r.id, r.name,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', c.id,
                 'name', c.name,
                 'qr_code', c.code,
                 'location_id', c.location_id
               ) ORDER BY rc.seq
             ) FILTER (WHERE c.id IS NOT NULL),
             '[]'
           ) AS checkpoints
      FROM patrol_routes r
      LEFT JOIN route_checkpoints rc ON rc.route_id = r.id
      LEFT JOIN checkpoints c ON c.id = rc.checkpoint_id
     GROUP BY r.id
     ORDER BY r.id
  `);

  res.json(rows);
}));

// Create a patrol route.
router.post('/routes', requireRole(...MANAGE), wrap(async (req, res) => {
  const { name } = req.body || {};

  if (!name || !String(name).trim()) {
    throw new HttpError(400, 'name is required');
  }

  const { rows } = await db.query(
    `INSERT INTO patrol_routes (name)
     VALUES ($1)
     RETURNING id, name`,
    [String(name).trim()]
  );

  await audit(req, {
    userId: req.user.id,
    action: 'CREATE PATROL ROUTE',
    targetTable: 'patrol_routes',
    recordId: rows[0].id
  });

  res.status(201).json(rows[0]);
}));

// Add a checkpoint to a route.
router.post('/routes/:id/checkpoints', requireRole(...MANAGE), wrap(async (req, res) => {
  const routeId = toInt(req.params.id);
  const { name } = req.body || {};
  const locationId = toInt((req.body || {}).location_id);

  if (!routeId || !name || !String(name).trim() || !locationId) {
    throw new HttpError(400, 'route id, name and location_id are required');
  }

  const route = await db.query(
    'SELECT id FROM patrol_routes WHERE id = $1',
    [routeId]
  );

  if (!route.rows.length) {
    throw new HttpError(404, 'Patrol route not found');
  }

  const location = await db.query(
    'SELECT id FROM locations WHERE id = $1',
    [locationId]
  );

  if (!location.rows.length) {
    throw new HttpError(400, 'Location not found');
  }

  const qr = (req.body || {}).qr_code ||
    `CSRS-CP-${routeId}-${Date.now().toString(36).toUpperCase()}`;

  const client = await db.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const checkpointResult = await client.query(
      `INSERT INTO checkpoints (name, code, location_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, code AS qr_code, location_id`,
      [String(name).trim(), qr, locationId]
    );

    const checkpoint = checkpointResult.rows[0];

    const seqResult = await client.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
         FROM route_checkpoints
        WHERE route_id = $1`,
      [routeId]
    );

    await client.query(
      `INSERT INTO route_checkpoints (route_id, checkpoint_id, seq)
       VALUES ($1, $2, $3)`,
      [routeId, checkpoint.id, seqResult.rows[0].next_seq]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    await audit(req, {
      userId: req.user.id,
      action: 'CREATE CHECKPOINT',
      targetTable: 'checkpoints',
      recordId: checkpoint.id
    });

    res.status(201).json(checkpoint);
  } catch (err) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    throw err;
  } finally {
    client.release();
  }
}));

// Record an officer's checkpoint scan.
router.post('/scan', requireRole(
  ROLES.SECURITY_OFFICER,
  ROLES.HEAD_OF_SECURITY,
  ROLES.ADMIN
), wrap(async (req, res) => {
  const { qr_code, notes } = req.body || {};

  if (!qr_code || !String(qr_code).trim()) {
    throw new HttpError(400, 'qr_code is required');
  }

  const cp = await db.query(
    'SELECT id, name FROM checkpoints WHERE code = $1',
    [String(qr_code).trim()]
  );

  if (!cp.rows.length) {
    throw new HttpError(404, 'Unknown checkpoint code');
  }

  const { rows } = await db.query(
    `INSERT INTO patrol_logs (checkpoint_id, officer_id, notes)
     VALUES ($1, $2, $3)
     RETURNING id, scanned_at, notes`,
    [cp.rows[0].id, req.user.id, notes || null]
  );

  await audit(req, {
    userId: req.user.id,
    action: 'PATROL CHECKPOINT SCAN',
    targetTable: 'patrol_logs',
    recordId: rows[0].id
  });

  res.status(201).json({
    ...rows[0],
    checkpoint: cp.rows[0].name
  });
}));

// List patrol logs. Security officers can only see their own.
router.get('/logs', requireRole(...STAFFED), wrap(async (req, res) => {
  const w = where();

  if (req.user.role === ROLES.SECURITY_OFFICER) {
    w.add('p.officer_id = ?', req.user.id);
  } else if (req.query.officer_id) {
    const officerId = toInt(req.query.officer_id);

    if (!officerId) {
      throw new HttpError(400, 'Invalid officer_id');
    }

    w.add('p.officer_id = ?', officerId);
  }

  if (req.query.from) {
    w.add('p.scanned_at >= ?', req.query.from);
  }

  if (req.query.to) {
    w.add('p.scanned_at <= ?', req.query.to);
  }

  const { limit, offset } = paging(req);

  const { rows } = await db.query(
    `SELECT p.id, p.officer_id, u.username AS officer,
            c.name AS checkpoint, p.scanned_at, p.notes
       FROM patrol_logs p
       JOIN checkpoints c ON c.id = p.checkpoint_id
       JOIN users u ON u.id = p.officer_id
       ${w.clause}
      ORDER BY p.scanned_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    w.params
  );

  res.json(rows);
}));

// Patrol performance by officer.
router.get('/performance', requireRole(...MANAGE), wrap(async (req, res) => {
  const w = where();

  if (req.query.from) {
    w.add('p.scanned_at >= ?', req.query.from);
  }

  if (req.query.to) {
    w.add('p.scanned_at <= ?', req.query.to);
  }

  const { rows } = await db.query(
    `SELECT p.officer_id, u.username AS officer,
            COUNT(*)::int AS checkins,
            COUNT(DISTINCT p.checkpoint_id)::int AS checkpoints_covered,
            MAX(p.scanned_at) AS last_checkin
       FROM patrol_logs p
       JOIN users u ON u.id = p.officer_id
       ${w.clause}
      GROUP BY p.officer_id, u.username
      ORDER BY checkins DESC`,
    w.params
  );

  res.json(rows);
}));

// Create a duty roster.
router.post('/rosters', requireRole(...MANAGE), wrap(async (req, res) => {
  const b = req.body || {};
  const officerId = toInt(b.officer_id);

  if (
    !officerId ||
    !b.shift_date ||
    !b.shift_start_time ||
    !b.shift_end_time
  ) {
    throw new HttpError(
      400,
      'officer_id, shift_date, shift_start_time and shift_end_time are required'
    );
  }

  const startAt = new Date(
    `${b.shift_date}T${b.shift_start_time}:00`
  );

  const endAt = new Date(
    `${b.shift_date}T${b.shift_end_time}:00`
  );

  if (
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(endAt.getTime()) ||
    endAt <= startAt
  ) {
    throw new HttpError(400, 'Invalid shift date or time range');
  }

  const officer = await db.query(
    `SELECT id
       FROM users
      WHERE id = $1
        AND role = $2
        AND is_active = TRUE`,
    [officerId, ROLES.SECURITY_OFFICER]
  );

  if (!officer.rows.length) {
    throw new HttpError(400, 'Active security officer not found');
  }

  const routeId = toInt(b.route_id);
  const { rows } = await db.query(
    `INSERT INTO duty_rosters
       (officer_id, route_id, start_at, end_at, handover_notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, officer_id, route_id, start_at, end_at,
               handover_notes, created_by`,
    [
      officerId,
      routeId,
      startAt.toISOString(),
      endAt.toISOString(),
      b.handover_notes || null,
      req.user.id
    ]
  );

  await notify(
    [officerId],
    'Duty roster',
    `Your duty shift starts at ${rows[0].start_at} and ends at ${rows[0].end_at}.`
  );

  await audit(req, {
    userId: req.user.id,
    action: 'CREATE ROSTER',
    targetTable: 'duty_rosters',
    recordId: rows[0].id
  });

  res.status(201).json(rows[0]);
}));

// List duty rosters.
router.get('/rosters', requireRole(...STAFFED), wrap(async (req, res) => {
  const w = where();

  if (req.user.role === ROLES.SECURITY_OFFICER) {
    w.add('d.officer_id = ?', req.user.id);
  } else if (req.query.officer_id) {
    const officerId = toInt(req.query.officer_id);

    if (!officerId) {
      throw new HttpError(400, 'Invalid officer_id');
    }

    w.add('d.officer_id = ?', officerId);
  }

  if (req.query.date) {
    w.add('d.start_at::date = ?::date', req.query.date);
  }

  const { rows } = await db.query(
    `SELECT d.id, d.officer_id, u.username AS officer,
            d.route_id, d.start_at, d.end_at, d.handover_notes
       FROM duty_rosters d
       JOIN users u ON u.id = d.officer_id
       ${w.clause}
      ORDER BY d.start_at DESC`,
    w.params
  );

  res.json(rows);
}));

// Delete a duty roster.
router.delete('/rosters/:id', requireRole(...MANAGE), wrap(async (req, res) => {
  const id = toInt(req.params.id);

  if (!id) {
    throw new HttpError(400, 'Invalid roster ID');
  }

  const result = await db.query(
    'DELETE FROM duty_rosters WHERE id = $1',
    [id]
  );

  if (!result.rowCount) {
    throw new HttpError(404, 'Roster entry not found');
  }

  await audit(req, {
    userId: req.user.id,
    action: 'DELETE ROSTER',
    targetTable: 'duty_rosters',
    recordId: id
  });

  res.json({ deleted: id });
}));

module.exports = router;
