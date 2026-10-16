
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  authenticate, optionalAuth, requireRole, ROLES
} = require('../middleware/auth');
const { upload, fileKind, discard, UPLOAD_ROOT } = require('../middleware/upload');
const {
  wrap, toInt, toBool, isDate, SEVERITIES,
  INCIDENT_STATUSES, paging, where, HttpError
} = require('../utils/helpers');
const { notify, notifyRoles } = require('../utils/notify');
const { audit } = require('../utils/audit');

const router = express.Router();

const SEE_ALL = [
  ROLES.ADMIN,
  ROLES.HEAD_OF_SECURITY,
  ROLES.COLLEGE_MANAGEMENT,
  ROLES.DEAN
];
const MANAGE = [ROLES.ADMIN, ROLES.HEAD_OF_SECURITY];

const SELECT_INCIDENT = `
  SELECT i.id, i.reference_no,
         c.name AS category,
         COALESCE(l.name, i.location_text) AS location,
         i.description, i.incident_datetime, i.reported_datetime,
         i.severity, i.status, i.is_anonymous, i.reporter_id,
         i.closed_datetime,
         (SELECT ia.officer_id
            FROM incident_assignments ia
           WHERE ia.incident_id = i.id
           ORDER BY ia.assigned_at DESC
           LIMIT 1) AS assigned_to,
         (SELECT COALESCE(u.full_name, u.username)
            FROM incident_assignments ia
            JOIN users u ON u.id = ia.officer_id
           WHERE ia.incident_id = i.id
           ORDER BY ia.assigned_at DESC
           LIMIT 1) AS assigned_officer
    FROM incidents i
    LEFT JOIN incident_categories c ON c.id = i.category_id
    LEFT JOIN locations l ON l.id = i.location_id`;

function canView(user, inc) {
  if (SEE_ALL.includes(user.role)) return true;
  if (inc.assigned_to === user.id) return true;
  return inc.reporter_id === user.id;
}

async function getIncident(id) {
  const { rows } = await db.query(`${SELECT_INCIDENT} WHERE i.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Incident not found');
  return rows[0];
}

async function saveEvidence(client, incidentId, files, userId = null) {
  for (const f of files || []) {
    await client.query(
      `INSERT INTO evidence
        (incident_id, stored_name, original_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        incidentId, f.filename, f.originalname,
        f.mimetype, f.size, userId
      ]
    );
  }
}

// Submit an incident.
router.post('/', optionalAuth, upload.array('evidence', 5), wrap(async (req, res) => {
  const files = req.files || [];

  try {
    const b = req.body || {};
    const categoryId = toInt(b.category_id);
    const locationId = toInt(b.location_id);
    const severity = b.severity || 'Medium';

    if (!categoryId || !locationId || !b.description || !isDate(b.incident_datetime)) {
      throw new HttpError(400, 'category_id, location_id, description and a valid incident_datetime are required');
    }
    if (!SEVERITIES.includes(severity)) {
      throw new HttpError(400, `severity must be one of: ${SEVERITIES.join(', ')}`);
    }

    const anonymous = !req.user || toBool(b.is_anonymous);
    const accessCode = anonymous
      ? crypto.randomBytes(5).toString('hex').toUpperCase()
      : null;
    const accessHash = accessCode ? await bcrypt.hash(accessCode, 10) : null;

    const client = await db.pool.connect();
    let incident;

    try {
      await client.query('BEGIN');

      const seq = await client.query("SELECT nextval('incident_ref_seq') AS n");
      const ref = `INC-${new Date().getFullYear()}-${String(seq.rows[0].n).padStart(4, '0')}`;

      const ins = await client.query(
        `INSERT INTO incidents
          (reference_no, category_id, location_id, description,
           incident_datetime, reporter_id, is_anonymous,
           access_code_hash, severity, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Submitted')
         RETURNING id, reference_no, severity, status`,
        [
          ref, categoryId, locationId, b.description,
          b.incident_datetime, anonymous ? null : req.user.id,
          anonymous, accessHash, severity
        ]
      );

      incident = ins.rows[0];

      await saveEvidence(client, incident.id, files, req.user?.id ?? null);

      await client.query(
        `INSERT INTO incident_updates
          (incident_id, user_id, note, new_status, is_public)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [incident.id, req.user?.id ?? null, 'Report submitted', 'Submitted']
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const alertRoles = [ROLES.HEAD_OF_SECURITY];
    if (severity === 'Critical' || severity === 'High') {
      alertRoles.push(ROLES.SECURITY_OFFICER);
    }
    if (severity === 'Critical') {
      alertRoles.push(ROLES.COLLEGE_MANAGEMENT);
    }

    await notifyRoles(alertRoles, `New ${severity} incident`, `${incident.reference_no} has been reported.`);
    await audit(req, {
      userId: req.user?.id ?? null,
      action: 'CREATE INCIDENT',
      targetTable: 'incidents',
      recordId: incident.id
    });

    const out = { ...incident, anonymous };
    if (anonymous) {
      out.access_code = accessCode;
      out.notice = 'Keep your reference number and access code. The access code is shown only once.';
    }

    res.status(201).json(out);
  } catch (err) {
    discard(files);
    throw err;
  }
}));

// Track anonymous reports.
router.get('/track/:ref', wrap(async (req, res) => {
  const code = req.headers['x-access-code'];

  const { rows } = await db.query(
    `SELECT id, reference_no, status, severity, reported_datetime,
            closed_datetime, access_code_hash
       FROM incidents
      WHERE reference_no = $1 AND is_anonymous = TRUE`,
    [req.params.ref]
  );

  const inc = rows[0];
  if (!inc || !code || !inc.access_code_hash ||
      !(await bcrypt.compare(String(code), inc.access_code_hash))) {
    throw new HttpError(404, 'No report matches that reference number and access code');
  }

  const updates = await db.query(
    `SELECT new_status, note, is_public, created_at
       FROM incident_updates
      WHERE incident_id = $1 AND is_public = TRUE
      ORDER BY created_at`,
    [inc.id]
  );

  res.json({
    reference_no: inc.reference_no,
    status: inc.status,
    severity: inc.severity,
    reported_datetime: inc.reported_datetime,
    closed_datetime: inc.closed_datetime,
    updates: updates.rows
  });
}));

// Anonymous reporter reply.
router.post('/track/:ref/reply', wrap(async (req, res) => {
  const code = req.headers['x-access-code'];
  const message = (req.body || {}).message;

  if (!message) throw new HttpError(400, 'message is required');

  const { rows } = await db.query(
    `SELECT id, access_code_hash
       FROM incidents
      WHERE reference_no = $1 AND is_anonymous = TRUE`,
    [req.params.ref]
  );

  const inc = rows[0];
  if (!inc || !code || !inc.access_code_hash ||
      !(await bcrypt.compare(String(code), inc.access_code_hash))) {
    throw new HttpError(404, 'No report matches that reference number and access code');
  }

  await db.query(
    `INSERT INTO incident_updates (incident_id, note, is_public)
     VALUES ($1, $2, TRUE)`,
    [inc.id, message]
  );

  await notifyRoles(
    [ROLES.HEAD_OF_SECURITY],
    'Reporter replied',
    `The anonymous reporter of ${req.params.ref} sent a message.`
  );

  res.status(201).json({ message: 'Reply sent' });
}));

// List incidents.
router.get('/', authenticate, wrap(async (req, res) => {
  const w = where();

  if (!SEE_ALL.includes(req.user.role)) {
    if (req.user.role === ROLES.SECURITY_OFFICER) {
      w.add(`(
        EXISTS (
          SELECT 1 FROM incident_assignments ia
           WHERE ia.incident_id = i.id AND ia.officer_id = ?
        ) OR i.reporter_id = ?
      )`, req.user.id);
    } else {
      w.add('i.reporter_id = ?', req.user.id);
    }
  }

  const q = req.query;
  if (q.status) w.add('i.status = ?', q.status);
  if (q.severity) w.add('i.severity = ?', q.severity);
  if (q.category_id) w.add('i.category_id = ?', toInt(q.category_id));
  if (q.location_id) w.add('i.location_id = ?', toInt(q.location_id));
  if (q.from) w.add('i.reported_datetime >= ?', q.from);
  if (q.to) w.add('i.reported_datetime <= ?', q.to);

  const { limit, offset } = paging(req);
  const { rows } = await db.query(
    `${SELECT_INCIDENT} ${w.clause}
      ORDER BY i.reported_datetime DESC
      LIMIT ${limit} OFFSET ${offset}`,
    w.params
  );

  res.json(rows);
}));

// Get incident details.
router.get('/:id', authenticate, wrap(async (req, res) => {
  const inc = await getIncident(toInt(req.params.id));
  if (!canView(req.user, inc)) {
    throw new HttpError(403, 'You do not have access to this incident');
  }

  const internalOk = SEE_ALL.includes(req.user.role) || inc.assigned_to === req.user.id;

  const [evidence, updates] = await Promise.all([
    db.query(
      `SELECT id, stored_name, original_name, mime_type, size_bytes, uploaded_at
         FROM evidence WHERE incident_id = $1 ORDER BY uploaded_at`,
      [inc.id]
    ),
    db.query(
      `SELECT id, user_id, old_status, new_status, note, is_public, created_at
         FROM incident_updates
        WHERE incident_id = $1
          ${internalOk ? '' : 'AND is_public = TRUE'}
        ORDER BY created_at`,
      [inc.id]
    )
  ]);

  res.json({ ...inc, evidence: evidence.rows, updates: updates.rows });
}));

// Update incident status or add a note.
router.patch('/:id', authenticate, requireRole(...MANAGE, ROLES.SECURITY_OFFICER), wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const inc = await getIncident(id);

  if (req.user.role === ROLES.SECURITY_OFFICER && inc.assigned_to !== req.user.id) {
    throw new HttpError(403, 'Only the assigned officer can update this incident');
  }

  const { status, notes, internal } = req.body || {};
  if (!status && !notes) throw new HttpError(400, 'status or notes is required');
  if (status && !INCIDENT_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${INCIDENT_STATUSES.join(', ')}`);
  }

  const newStatus = status || inc.status;

  await db.query(
    `UPDATE incidents
        SET status = $1,
            closed_datetime = CASE WHEN $1 = 'Closed'
              THEN COALESCE(closed_datetime, CURRENT_TIMESTAMP)
              ELSE NULL END
      WHERE id = $2`,
    [newStatus, id]
  );

  await db.query(
    `INSERT INTO incident_updates
      (incident_id, user_id, old_status, new_status, note, is_public)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, req.user.id, inc.status, newStatus, notes || null, !toBool(internal)]
  );

  if (newStatus !== inc.status) {
    if (inc.reporter_id) {
      await notify([inc.reporter_id], 'Report status updated', `${inc.reference_no} is now: ${newStatus}.`);
    }
    if (newStatus === 'Escalated') {
      await notifyRoles([ROLES.COLLEGE_MANAGEMENT, ROLES.DEAN], 'Incident escalated', `${inc.reference_no} was escalated.`);
    }
  }

  await audit(req, {
    userId: req.user.id,
    action: 'UPDATE INCIDENT STATUS',
    targetTable: 'incidents',
    recordId: id
  });

  res.json({ id, reference_no: inc.reference_no, status: newStatus });
}));

// Assign incident to an active security officer.
router.post('/:id/assign', authenticate, requireRole(...MANAGE), wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const officerId = toInt((req.body || {}).officer_id);
  if (!officerId) throw new HttpError(400, 'officer_id is required');

  const inc = await getIncident(id);

  const off = await db.query(
    `SELECT id FROM users
      WHERE id = $1 AND role = $2 AND is_active = TRUE`,
    [officerId, ROLES.SECURITY_OFFICER]
  );

  if (!off.rows[0]) {
    throw new HttpError(400, 'officer_id must be an active Security Officer');
  }

  await db.query(
    `INSERT INTO incident_assignments (incident_id, officer_id, assigned_by)
     VALUES ($1, $2, $3)`,
    [id, officerId, req.user.id]
  );

  await db.query(
    `UPDATE incidents
        SET status = CASE
          WHEN status IN ('Submitted', 'Verified') THEN 'In Progress'
          ELSE status
        END
      WHERE id = $1`,
    [id]
  );

  await db.query(
    `INSERT INTO incident_updates
      (incident_id, user_id, old_status, new_status, note, is_public)
     VALUES ($1, $2, $3, $4, $5, FALSE)`,
    [id, req.user.id, inc.status, 'In Progress', `Assigned to officer #${officerId}`]
  );

  await notify([officerId], 'New case assigned', `${inc.reference_no} (${inc.severity}) has been assigned to you.`);
  await audit(req, {
    userId: req.user.id,
    action: 'ASSIGN INCIDENT',
    targetTable: 'incidents',
    recordId: id
  });

  res.status(201).json({ id, assigned_to: officerId });
}));

// Upload evidence.
router.post('/:id/evidence', authenticate, upload.array('evidence', 5), wrap(async (req, res) => {
  const files = req.files || [];

  try {
    if (!files.length) {
      throw new HttpError(400, 'Attach at least one file in the "evidence" field');
    }

    const inc = await getIncident(toInt(req.params.id));
    if (!canView(req.user, inc)) {
      throw new HttpError(403, 'You do not have access to this incident');
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await saveEvidence(client, inc.id, files, req.user.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await audit(req, {
      userId: req.user.id,
      action: 'ADD EVIDENCE',
      targetTable: 'incidents',
      recordId: inc.id
    });

    res.status(201).json({ added: files.length });
  } catch (err) {
    discard(files);
    throw err;
  }
}));

// Download evidence privately.
router.get('/:id/evidence/:evidenceId', authenticate, wrap(async (req, res) => {
  const inc = await getIncident(toInt(req.params.id));

  if (!canView(req.user, inc)) {
    throw new HttpError(403, 'You do not have access to this incident');
  }

  const { rows } = await db.query(
    `SELECT stored_name FROM evidence WHERE id = $1 AND incident_id = $2`,
    [toInt(req.params.evidenceId), inc.id]
  );

  if (!rows[0]) throw new HttpError(404, 'Evidence not found');

  const full = path.join(UPLOAD_ROOT, path.basename(rows[0].stored_name));
  if (!fs.existsSync(full)) throw new HttpError(404, 'File is missing from storage');

  res.sendFile(full);
}));

module.exports = router;
