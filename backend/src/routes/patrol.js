// Purpose: API routes and access rules for patrol operations.

const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, toInt, toNum, paging, where, HttpError } = require('../utils/helpers');
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
                 'location_id', c.location_id,
                 'location', l.name,
                 'lat', l.lat,
                 'lng', l.lng,
                 'seq', rc.seq
               ) ORDER BY rc.seq
             ) FILTER (WHERE c.id IS NOT NULL),
             '[]'
           ) AS checkpoints
      FROM patrol_routes r
      LEFT JOIN route_checkpoints rc ON rc.route_id = r.id
      LEFT JOIN checkpoints c ON c.id = rc.checkpoint_id
      LEFT JOIN locations l ON l.id = c.location_id
     GROUP BY r.id
     ORDER BY r.id
  `);

  res.json(rows);
}));

// Generate a printable QR label for a configured checkpoint.
router.get('/checkpoints/:id/qr', requireRole(...MANAGE), wrap(async (req, res) => {
  const checkpointId = toInt(req.params.id);
  if (!checkpointId) throw new HttpError(400, 'Invalid checkpoint id');
  const result = await db.query(
    `SELECT id, name, code FROM checkpoints WHERE id = $1`,
    [checkpointId]
  );
  if (!result.rows.length) throw new HttpError(404, 'Checkpoint not found');
  const checkpoint = result.rows[0];
  const qrSvg = await QRCode.toString(checkpoint.code, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 280
  });
  res.json({ id: checkpoint.id, name: checkpoint.name, code: checkpoint.code, qr_svg: qrSvg });
}));

// Return the signed-in officer's active route and ordered checkpoint progress.
router.get('/current', requireRole(ROLES.SECURITY_OFFICER), wrap(async (req, res) => {
  const rosterResult = await db.query(
    `SELECT d.id, d.route_id, d.start_at, d.end_at, d.handover_notes,
            r.name AS route_name
       FROM duty_rosters d
       LEFT JOIN patrol_routes r ON r.id = d.route_id
      WHERE d.officer_id = $1
        AND d.start_at <= CURRENT_TIMESTAMP
        AND d.end_at >= CURRENT_TIMESTAMP
      ORDER BY d.start_at DESC
      LIMIT 1`,
    [req.user.id]
  );
  const roster = rosterResult.rows[0];
  if (!roster) return res.json({ roster: null, checkpoints: [], next_checkpoint: null });
  if (!roster.route_id) return res.json({ roster, checkpoints: [], next_checkpoint: null });

  const { rows: checkpoints } = await db.query(
    `SELECT c.id, c.name, c.code AS qr_code, c.location_id,
            l.name AS location, l.lat, l.lng, rc.seq,
            EXISTS (
              SELECT 1 FROM patrol_logs p
               WHERE p.roster_id = $1 AND p.checkpoint_id = c.id
            ) AS completed,
            (SELECT MAX(p.scanned_at) FROM patrol_logs p
              WHERE p.roster_id = $1 AND p.checkpoint_id = c.id) AS scanned_at
       FROM route_checkpoints rc
       JOIN checkpoints c ON c.id = rc.checkpoint_id
       JOIN locations l ON l.id = c.location_id
      WHERE rc.route_id = $2
      ORDER BY rc.seq`,
    [roster.id, roster.route_id]
  );
  res.json({
    roster,
    checkpoints,
    next_checkpoint: checkpoints.find((checkpoint) => !checkpoint.completed) || null
  });
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
    await client.query('SELECT id FROM patrol_routes WHERE id = $1 FOR UPDATE', [routeId]);

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

// Save a complete route checkpoint order after manager adjustments.
router.patch('/routes/:id/checkpoints/order', requireRole(...MANAGE), wrap(async (req, res) => {
  const routeId = toInt(req.params.id);
  const checkpointIds = req.body?.checkpoint_ids;
  if (!routeId || !Array.isArray(checkpointIds) || checkpointIds.some((id) => !toInt(id))) {
    throw new HttpError(400, 'route id and checkpoint_ids are required');
  }
  const orderedIds = checkpointIds.map(toInt);
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new HttpError(400, 'A checkpoint may appear only once in the route order.');
  }

  const client = await db.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const route = await client.query('SELECT id FROM patrol_routes WHERE id = $1 FOR UPDATE', [routeId]);
    if (!route.rows.length) throw new HttpError(404, 'Patrol route not found');
    const existing = await client.query(
      'SELECT checkpoint_id FROM route_checkpoints WHERE route_id = $1 ORDER BY seq',
      [routeId]
    );
    const existingIds = existing.rows.map((row) => Number(row.checkpoint_id));
    if (existingIds.length !== orderedIds.length || existingIds.some((id) => !orderedIds.includes(id))) {
      throw new HttpError(400, 'The order must include every checkpoint on this route exactly once.');
    }
    await client.query(
      `UPDATE route_checkpoints AS rc
          SET seq = ordered.seq::int
         FROM unnest($2::int[]) WITH ORDINALITY AS ordered(checkpoint_id, seq)
        WHERE rc.route_id = $1 AND rc.checkpoint_id = ordered.checkpoint_id`,
      [routeId, orderedIds]
    );
    await client.query('COMMIT');
    transactionStarted = false;
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await audit(req, {
    userId: req.user.id,
    action: 'REORDER PATROL CHECKPOINTS',
    targetTable: 'patrol_routes',
    recordId: routeId
  });
  res.json({ route_id: routeId, checkpoint_ids: orderedIds });
}));

// Record an officer's checkpoint scan.
router.post('/scan', requireRole(ROLES.SECURITY_OFFICER), wrap(async (req, res) => {
  const { qr_code, notes } = req.body || {};
  const lat = toNum(req.body?.lat);
  const lng = toNum(req.body?.lng);

  if (!qr_code || !String(qr_code).trim()) {
    throw new HttpError(400, 'qr_code is required');
  }
  if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) {
    throw new HttpError(400, 'Invalid scan coordinates');
  }

  const cp = await db.query(
    'SELECT id, name FROM checkpoints WHERE code = $1',
    [String(qr_code).trim()]
  );

  if (!cp.rows.length) {
    throw new HttpError(404, 'Unknown checkpoint code');
  }

  const client = await db.connect();
  let transactionStarted = false;
  let roster;
  let scan;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const rosterResult = await client.query(
      `SELECT d.id, d.route_id
         FROM duty_rosters d
        WHERE d.officer_id = $1
          AND d.start_at <= CURRENT_TIMESTAMP
          AND d.end_at >= CURRENT_TIMESTAMP
        ORDER BY d.start_at DESC
        LIMIT 1
        FOR UPDATE`,
      [req.user.id]
    );
    roster = rosterResult.rows[0];
    if (!roster) throw new HttpError(409, 'There is no active duty assignment for your account.');
    if (!roster.route_id) {
      throw new HttpError(409, 'Your active duty assignment has no patrol route. Contact the Head of Security.');
    }

    const { rows: routeCheckpoints } = await client.query(
      `SELECT c.id, c.code, c.name, rc.seq,
              EXISTS (
                SELECT 1 FROM patrol_logs p
                 WHERE p.roster_id = $1 AND p.checkpoint_id = c.id
              ) AS completed
         FROM route_checkpoints rc
         JOIN checkpoints c ON c.id = rc.checkpoint_id
        WHERE rc.route_id = $2
        ORDER BY rc.seq`,
      [roster.id, roster.route_id]
    );
    const nextCheckpoint = routeCheckpoints.find((checkpoint) => !checkpoint.completed);
    if (!nextCheckpoint) {
      throw new HttpError(409, 'All checkpoints on this route have already been recorded for this shift.');
    }
    if (Number(nextCheckpoint.id) !== Number(cp.rows[0].id)) {
      throw new HttpError(409, `Next checkpoint is ${nextCheckpoint.name}. Scan checkpoints in the assigned route order.`);
    }

    const result = await client.query(
      `INSERT INTO patrol_logs (checkpoint_id, officer_id, roster_id, lat, lng, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, scanned_at, lat, lng, notes`,
      [cp.rows[0].id, req.user.id, roster.id, lat, lng, notes || null]
    );
    scan = result.rows[0];
    await client.query('COMMIT');
    transactionStarted = false;
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await audit(req, {
    userId: req.user.id,
    action: 'PATROL CHECKPOINT SCAN',
    targetTable: 'patrol_logs',
    recordId: scan.id
  });

  res.status(201).json({
    ...scan,
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
    `SELECT p.id, p.officer_id, p.lat, p.lng, u.username AS officer,
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
    !toInt(b.route_id) ||
    !b.shift_date ||
    !b.shift_start_time ||
    !b.shift_end_time
  ) {
    throw new HttpError(
      400,
      'officer_id, route_id, shift_date, shift_start_time and shift_end_time are required'
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
  const route = await db.query(
    `SELECT r.id, COUNT(rc.checkpoint_id)::int AS checkpoint_count
       FROM patrol_routes r
       LEFT JOIN route_checkpoints rc ON rc.route_id = r.id
      WHERE r.id = $1
      GROUP BY r.id`,
    [routeId]
  );
  if (!route.rows.length) throw new HttpError(400, 'Patrol route not found');
  if (!route.rows[0].checkpoint_count) {
    throw new HttpError(400, 'Add at least one checkpoint before assigning this route.');
  }
  const overlap = await db.query(
    `SELECT 1 FROM duty_rosters
      WHERE officer_id = $1
        AND start_at < $3
        AND end_at > $2
      LIMIT 1`,
    [officerId, startAt.toISOString(), endAt.toISOString()]
  );
  if (overlap.rows.length) {
    throw new HttpError(409, 'This officer already has a duty assignment during that time.');
  }
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
