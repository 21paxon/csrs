
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { upload, discard } = require('../middleware/upload');
const { wrap, toInt, isDate, paging, HttpError } = require('../utils/helpers');
const { notify } = require('../utils/notify');
const { audit } = require('../utils/audit');

const router = express.Router();
const OFFICERS = [
  ROLES.ADMIN,
  ROLES.HEAD_OF_SECURITY,
  ROLES.SECURITY_OFFICER
];

// POST /api/lost-found/lost
router.post('/lost', authenticate, upload.single('photo'), wrap(async (req, res) => {
  try {
    const b = req.body || {};
    const title = b.item_name || b.title;

    if (!title) throw new HttpError(400, 'item_name is required');

    const eventDate = b.date_lost || null;
    if (eventDate && !isDate(eventDate)) {
      throw new HttpError(400, 'date_lost is not a valid date');
    }

    const { rows } = await db.query(
      `INSERT INTO items
        (kind, title, description, category, location_text,
         event_date, photo_name, reported_by, contact_phone, status)
       VALUES ('lost', $1, $2, $3, $4, $5, $6, $7, $8, 'open')
       RETURNING id, kind, title, description, location_text,
                 event_date, status, created_at`,
      [
        title,
        b.description || null,
        b.category || null,
        b.location_lost || b.location_text || null,
        eventDate,
        req.file ? req.file.filename : null,
        req.user.id,
        b.contact_phone || req.user.phone || null
      ]
    );

    await audit(req, {
      userId: req.user.id,
      action: 'REPORT LOST ITEM',
      targetTable: 'items',
      recordId: rows[0].id
    });

    res.status(201).json({ ...rows[0], item_name: rows[0].title });
  } catch (err) {
    discard(req.file ? [req.file] : []);
    throw err;
  }
}));

// GET /api/lost-found/lost
router.get('/lost', authenticate, wrap(async (req, res) => {
  const { limit, offset } = paging(req);
  const params = [];
  const conditions = ["i.kind = 'lost'"];

  if (!OFFICERS.includes(req.user.role)) {
    params.push(req.user.id);
    conditions.push(`i.reported_by = $${params.length}`);
  }

  if (req.query.status) {
    params.push(req.query.status);
    conditions.push(`i.status = $${params.length}`);
  }

  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT i.id, i.reported_by AS user_id, i.title,
            i.title AS item_name, i.description, i.category,
            i.location_text AS location_lost, i.event_date AS date_lost,
            i.status, i.matched_item_id AS matched_found_id,
            i.photo_name, i.created_at
       FROM items i
      WHERE ${conditions.join(' AND ')}
      ORDER BY i.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json(rows);
}));

// POST /api/lost-found/found
router.post('/found', authenticate, requireRole(...OFFICERS), upload.single('photo'), wrap(async (req, res) => {
  try {
    const b = req.body || {};
    const title = b.item_name || b.title;

    if (!title) throw new HttpError(400, 'item_name is required');

    const eventDate = b.date_found || null;
    if (eventDate && !isDate(eventDate)) {
      throw new HttpError(400, 'date_found is not a valid date');
    }

    const { rows } = await db.query(
      `INSERT INTO items
        (kind, title, description, category, location_text,
         event_date, photo_name, reported_by, contact_phone, status)
       VALUES ('found', $1, $2, $3, $4, $5, $6, $7, $8, 'open')
       RETURNING id, kind, title, description, location_text,
                 event_date, status, created_at`,
      [
        title,
        b.description || null,
        b.category || null,
        b.location_found || b.location_text || null,
        eventDate,
        req.file ? req.file.filename : null,
        req.user.id,
        b.contact_phone || null
      ]
    );

    await audit(req, {
      userId: req.user.id,
      action: 'REGISTER FOUND ITEM',
      targetTable: 'items',
      recordId: rows[0].id
    });

    res.status(201).json({ ...rows[0], item_name: rows[0].title });
  } catch (err) {
    discard(req.file ? [req.file] : []);
    throw err;
  }
}));

// GET /api/lost-found/found?q=
router.get('/found', authenticate, wrap(async (req, res) => {
  const { limit, offset } = paging(req);
  const params = [];
  const conditions = ["i.kind = 'found'", "i.status = 'open'"];

  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    conditions.push(
      `(i.title ILIKE $${params.length} OR
        COALESCE(i.description, '') ILIKE $${params.length} OR
        COALESCE(i.category, '') ILIKE $${params.length})`
    );
  }

  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT i.id, i.title, i.title AS item_name, i.description,
            i.category, i.location_text AS location_found,
            i.event_date AS date_found, i.status, i.photo_name
       FROM items i
      WHERE ${conditions.join(' AND ')}
      ORDER BY i.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json(rows);
}));

// POST /api/lost-found/match { lost_id, found_id }
router.post('/match', authenticate, requireRole(...OFFICERS), wrap(async (req, res) => {
  const lostId = toInt(req.body?.lost_id);
  const foundId = toInt(req.body?.found_id);

  if (!lostId || !foundId || lostId === foundId) {
    throw new HttpError(400, 'Valid lost_id and found_id are required');
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const lost = await client.query(
      `SELECT id, reported_by, title
         FROM items
        WHERE id = $1 AND kind = 'lost' AND status = 'open'
        FOR UPDATE`,
      [lostId]
    );

    const found = await client.query(
      `SELECT id, title
         FROM items
        WHERE id = $1 AND kind = 'found' AND status = 'open'
        FOR UPDATE`,
      [foundId]
    );

    if (!lost.rows[0] || !found.rows[0]) {
      throw new HttpError(409, 'Lost or found item not found, or already matched');
    }

    await client.query(
      `UPDATE items SET status = 'matched', matched_item_id = $2
        WHERE id = $1`,
      [lostId, foundId]
    );

    await client.query(
      `UPDATE items SET status = 'matched', matched_item_id = $2
        WHERE id = $1`,
      [foundId, lostId]
    );

    await client.query('COMMIT');

    await notify(
      [lost.rows[0].reported_by],
      'Your lost item may have been found',
      `A found item may match "${lost.rows[0].title}". Visit the security office to verify and collect it.`,
      'lost-found'
    );

    await audit(req, {
      userId: req.user.id,
      action: 'MATCH LOST AND FOUND',
      targetTable: 'items',
      recordId: lostId
    });

    res.json({ lost_id: lostId, found_id: foundId, status: 'matched' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}));

// POST /api/lost-found/found/:id/collect { user_id }
router.post('/found/:id/collect', authenticate, requireRole(...OFFICERS), wrap(async (req, res) => {
  const foundId = toInt(req.params.id);
  const ownerId = toInt(req.body?.user_id);

  if (!foundId || !ownerId) {
    throw new HttpError(400, 'Valid found item id and user_id are required');
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT f.id AS found_id, f.matched_item_id AS lost_id,
              l.reported_by AS owner_id, u.full_name, u.reg_no,
              f.status
         FROM items f
         JOIN items l ON l.id = f.matched_item_id AND l.kind = 'lost'
         JOIN users u ON u.id = l.reported_by
        WHERE f.id = $1 AND f.kind = 'found'
        FOR UPDATE OF f, l`,
      [foundId]
    );

    const item = result.rows[0];

    if (!item || item.status !== 'matched') {
      throw new HttpError(409, 'Found item is not matched or was already collected');
    }

    if (Number(item.owner_id) !== ownerId) {
      throw new HttpError(403, 'The supplied user is not the reported owner of the matched lost item');
    }

    await client.query(
      `UPDATE items
          SET status = 'collected',
              collected_by_name = $2,
              collected_id_no = $3,
              collected_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [foundId, item.full_name, item.reg_no || String(ownerId)]
    );

    await client.query(
      `UPDATE items SET status = 'collected' WHERE id = $1`,
      [item.lost_id]
    );

    await client.query('COMMIT');

    await audit(req, {
      userId: req.user.id,
      action: 'COLLECT FOUND ITEM',
      targetTable: 'items',
      recordId: foundId
    });

    res.json({ id: foundId, status: 'collected' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}));

// GET /api/lost-found/unclaimed?days=90
router.get('/unclaimed', authenticate, requireRole(...OFFICERS), wrap(async (req, res) => {
  const days = toInt(req.query.days) || 90;

  if (days < 1) throw new HttpError(400, 'days must be greater than zero');

  const { rows } = await db.query(
    `SELECT id, title, location_text, event_date
       FROM items
      WHERE kind = 'found'
        AND status = 'open'
        AND event_date IS NOT NULL
        AND event_date <= CURRENT_DATE - $1::int
      ORDER BY event_date`,
    [days]
  );

  res.json(rows);
}));

module.exports = router;
