// Purpose: API routes and access rules for reference operations.

const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, toInt, HttpError } = require('../utils/helpers');
const { audit } = require('../utils/audit');

const router = express.Router();

const manage = [
  authenticate,
  requireRole(ROLES.ADMIN, ROLES.HEAD_OF_SECURITY)
];

async function listCategories(req, res) {
  const { rows } = await db.query(
    `SELECT id, name, description
       FROM incident_categories
      ORDER BY name`
  );
  res.json(rows);
}

router.get('/categories', wrap(listCategories));
router.get('/incident-categories', wrap(listCategories));

// POST /api/categories
router.post('/categories', ...manage, wrap(async (req, res) => {
  const { name, description } = req.body || {};

  if (!name || !String(name).trim()) {
    throw new HttpError(400, 'Category name is required');
  }

  const { rows } = await db.query(
    `INSERT INTO incident_categories (name, description)
     VALUES ($1, $2)
     RETURNING id, name, description`,
    [String(name).trim(), description || null]
  );

  await audit(req, {
    userId: req.user.id,
    action: 'CREATE CATEGORY',
    targetTable: 'incident_categories',
    recordId: rows[0].id
  });

  res.status(201).json(rows[0]);
}));

// GET /api/locations
router.get('/locations', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, lat, lng
       FROM locations
      ORDER BY name`
  );
  res.json(rows);
}));

router.get('/emergency-contacts', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, phone_number, description
       FROM emergency_contacts ORDER BY display_order, name`
  );
  res.json(rows);
}));

router.post('/emergency-contacts', authenticate, requireRole(ROLES.ADMIN), wrap(async (req, res) => {
  const { name, phone_number, description } = req.body || {};
  if (!String(name || '').trim() || !String(phone_number || '').trim()) {
    throw new HttpError(400, 'Contact name and phone number are required');
  }
  const { rows } = await db.query(
    `INSERT INTO emergency_contacts (name, phone_number, description, display_order, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, phone_number, description, display_order`,
    [String(name).trim(), String(phone_number).trim(), description ? String(description).trim() : null,
      Number.isInteger(Number(req.body.display_order)) ? Number(req.body.display_order) : 0, req.user.id]
  );
  await audit(req, { userId: req.user.id, action: 'CREATE EMERGENCY CONTACT', targetTable: 'emergency_contacts', recordId: rows[0].id });
  res.status(201).json(rows[0]);
}));

router.delete('/emergency-contacts/:id', authenticate, requireRole(ROLES.ADMIN), wrap(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) throw new HttpError(400, 'Invalid emergency contact id');
  const result = await db.query('DELETE FROM emergency_contacts WHERE id = $1', [id]);
  if (!result.rowCount) throw new HttpError(404, 'Emergency contact not found');
  await audit(req, { userId: req.user.id, action: 'DELETE EMERGENCY CONTACT', targetTable: 'emergency_contacts', recordId: id });
  res.json({ deleted: id });
}));

// POST /api/locations
router.post('/locations', ...manage, wrap(async (req, res) => {
  const { name, lat, lng } = req.body || {};

  if (!name || !String(name).trim()) {
    throw new HttpError(400, 'Location name is required');
  }

  const latitude = lat === '' || lat === undefined ? null : Number(lat);
  const longitude = lng === '' || lng === undefined ? null : Number(lng);

  if (latitude !== null &&
      (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new HttpError(400, 'Latitude must be between -90 and 90');
  }

  if (longitude !== null &&
      (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new HttpError(400, 'Longitude must be between -180 and 180');
  }

  const { rows } = await db.query(
    `INSERT INTO locations (name, lat, lng)
     VALUES ($1, $2, $3)
     RETURNING id, name, lat, lng`,
    [String(name).trim(), latitude, longitude]
  );

  await audit(req, {
    userId: req.user.id,
    action: 'CREATE LOCATION',
    targetTable: 'locations',
    recordId: rows[0].id
  });

  res.status(201).json(rows[0]);
}));

// PUT /api/locations/:id
router.put('/locations/:id', ...manage, wrap(async (req, res) => {
  const id = toInt(req.params.id);

  if (!id || id < 1) {
    throw new HttpError(400, 'Invalid location id');
  }

  const { name, lat, lng } = req.body || {};

  const latitude = lat === undefined || lat === '' ? null : Number(lat);
  const longitude = lng === undefined || lng === '' ? null : Number(lng);

  if (lat !== undefined && lat !== '' &&
      (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new HttpError(400, 'Invalid latitude');
  }

  if (lng !== undefined && lng !== '' &&
      (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new HttpError(400, 'Invalid longitude');
  }

  const { rows } = await db.query(
    `UPDATE locations
        SET name = COALESCE($1, name),
            lat = COALESCE($2, lat),
            lng = COALESCE($3, lng)
      WHERE id = $4
      RETURNING id, name, lat, lng`,
    [
      name && String(name).trim() ? String(name).trim() : null,
      latitude,
      longitude,
      id
    ]
  );

  if (!rows[0]) {
    throw new HttpError(404, 'Location not found');
  }

  await audit(req, {
    userId: req.user.id,
    action: 'UPDATE LOCATION',
    targetTable: 'locations',
    recordId: id
  });

  res.json(rows[0]);
}));

module.exports = router;
