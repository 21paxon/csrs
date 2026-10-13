const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { q, tx } = require('../db');
const { auth, optionalAuth, requireRole } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notifyUsers, notifyRoles } = require('../lib/notify');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|webm|wav)|application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // Random names: never trust the client's filename on disk.
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).slice(0, 8).replace(/[^.\w]/g, '')),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => cb(ALLOWED.test(file.mimetype) ? null : new Error('That file type is not allowed. Use photos, video, audio, PDF or Word documents.'), ALLOWED.test(file.mimetype)),
});

const anonLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// Target response times from the SRS (configurable by editing here)
const SLA_MINUTES = { Critical: 5, High: 30, Medium: 240, Low: 2 * 24 * 60 };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters
const makeCode = () => Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const FULL_VIEW = ['admin', 'head_security', 'management'];

async function loadIncident(id) {
  const { rows } = await q(
    `SELECT i.*, c.name AS category, l.name AS location,
            (SELECT COALESCE(json_agg(json_build_object('id',u.id,'name',u.full_name)),'[]')
               FROM incident_assignments a JOIN users u ON u.id=a.officer_id WHERE a.incident_id=i.id) AS officers
       FROM incidents i
       LEFT JOIN incident_categories c ON c.id=i.category_id
       LEFT JOIN locations l ON l.id=i.location_id
      WHERE i.id=$1`, [id]);
  return rows[0];
}

async function canView(user, inc) {
  if (!inc) return false;
  if (FULL_VIEW.includes(user.role)) return true;
  if (user.role === 'security_officer') return inc.officers.some((o) => o.id === user.id);
  if (user.role === 'dean') return inc.referred_to_discipline;
  return inc.reporter_id === user.id;
}

const isSecurity = (u) => ['admin', 'head_security', 'security_officer'].includes(u.role);

// Never expose the anonymous access-code hash
function sanitize(inc) {
  const { access_code_hash, ...rest } = inc;
  return rest;
}

// FR-03 / UC-01 / UC-02: submit a report. Works logged-in or anonymous.
router.post('/', anonLimiter, optionalAuth, upload.array('evidence', 5), async (req, res) => {
  const b = req.body || {};
  const wantsAnon = b.is_anonymous === true || b.is_anonymous === 'true' || b.is_anonymous === 'on';
  if (!req.user && !wantsAnon) return res.status(401).json({ error: 'Please log in, or choose to report anonymously.' });
  if (!b.category_id) return res.status(400).json({ error: 'Incident report not submitted. Please select a category.' });
  if (!b.location_id && !b.location_text) return res.status(400).json({ error: 'Incident report not submitted. Please select the location of the incident.' });
  if (!b.description || String(b.description).trim().length < 10) return res.status(400).json({ error: 'Incident report not submitted. Please describe what happened (at least 10 characters).' });
  const when = b.incident_datetime ? new Date(b.incident_datetime) : new Date();
  if (isNaN(when) || when > new Date(Date.now() + 5 * 60000)) return res.status(400).json({ error: 'Incident report not submitted. The date and time cannot be in the future.' });

  const code = wantsAnon ? makeCode() : null;
  const codeHash = code ? await bcrypt.hash(code, 10) : null;

  const inc = await tx(async (c) => {
    const { rows: [{ n }] } = await c.query("SELECT nextval('incident_ref_seq') AS n");
    const ref = `INC-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
    const { rows } = await c.query(
      `INSERT INTO incidents(reference_no,category_id,location_id,location_text,lat,lng,description,
                             incident_datetime,reporter_id,is_anonymous,hide_identity,access_code_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [ref, Number(b.category_id), b.location_id ? Number(b.location_id) : null, b.location_text || null,
       b.lat ? Number(b.lat) : null, b.lng ? Number(b.lng) : null, String(b.description).trim(), when,
       wantsAnon ? null : req.user.id, wantsAnon, b.hide_identity === 'true' || b.hide_identity === true,
       codeHash]);
    for (const f of req.files || [])
      await c.query(
        `INSERT INTO evidence(incident_id,stored_name,original_name,mime_type,size_bytes,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [rows[0].id, f.filename, f.originalname, f.mimetype, f.size, wantsAnon ? null : req.user.id]);
    await c.query(`INSERT INTO incident_updates(incident_id,user_id,note,new_status,is_public)
                   VALUES($1,$2,'Report submitted','Submitted',TRUE)`, [rows[0].id, wantsAnon ? null : req.user.id]);
    return rows[0];
  });

  // Anonymous audit entries deliberately omit the actor.
  await audit(req, 'INCIDENT_SUBMITTED', 'incident', inc.id, { reference_no: inc.reference_no, anonymous: wantsAnon }, 'Successful', wantsAnon ? { id: null, username: 'anonymous' } : null);
  await notifyRoles(['head_security'], 'New incident reported', `${inc.reference_no} is waiting to be verified.`, 'incident', `#/incident/${inc.id}`);

  res.status(201).json({
    reference_no: inc.reference_no,
    id: wantsAnon ? undefined : inc.id,
    access_code: code || undefined, // shown ONCE; only a hash is stored
    message: wantsAnon
      ? 'Your anonymous report was submitted. Keep your reference number and access code safe; the code cannot be recovered.'
      : 'Your report was submitted.',
  });
});

// UC-06 anonymous tracking (no login): reference number + access code
async function anonLookup(ref, code) {
  const { rows } = await q('SELECT * FROM incidents WHERE reference_no=$1 AND is_anonymous', [String(ref || '').trim().toUpperCase()]);
  const inc = rows[0];
  if (!inc || !code || !(await bcrypt.compare(String(code).trim().toUpperCase(), inc.access_code_hash))) return null;
  return inc;
}

router.post('/track', anonLimiter, async (req, res) => {
  const inc = await anonLookup(req.body.reference_no, req.body.access_code);
  if (!inc) return res.status(404).json({ error: 'No report matches that reference number and access code.' });
  const { rows: updates } = await q(
    `SELECT note,new_status,created_at,(user_id IS NULL) AS from_reporter
       FROM incident_updates WHERE incident_id=$1 AND is_public ORDER BY created_at`, [inc.id]);
  res.json({ reference_no: inc.reference_no, status: inc.status, reported_datetime: inc.reported_datetime, updates });
});

router.post('/track/reply', anonLimiter, async (req, res) => {
  const inc = await anonLookup(req.body.reference_no, req.body.access_code);
  if (!inc) return res.status(404).json({ error: 'No report matches that reference number and access code.' });
  const msg = String(req.body.message || '').trim();
  if (!msg) return res.status(400).json({ error: 'Write a message first.' });
  await q('INSERT INTO incident_updates(incident_id,user_id,note,is_public) VALUES($1,NULL,$2,TRUE)', [inc.id, msg]);
  const { rows } = await q('SELECT officer_id FROM incident_assignments WHERE incident_id=$1', [inc.id]);
  await notifyUsers(rows.map((r) => r.officer_id), 'Reply from anonymous reporter', inc.reference_no, 'incident', `#/incident/${inc.id}`);
  res.json({ ok: true });
});

// FR-11: list + search/filter
router.get('/', auth, async (req, res) => {
  const { status, severity, category_id, location_id, officer_id, from, to, ref, mine } = req.query;
  const where = []; const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', '$' + p.length)); };

  if (mine === 'true' || !['admin', 'head_security', 'management', 'security_officer', 'dean'].includes(req.user.role)) add('i.reporter_id = ?', req.user.id);
  else if (req.user.role === 'security_officer') add('EXISTS (SELECT 1 FROM incident_assignments a WHERE a.incident_id=i.id AND a.officer_id=?)', req.user.id);
  else if (req.user.role === 'dean') where.push('i.referred_to_discipline');

  if (status) add('i.status = ?', status);
  if (severity) add('i.severity = ?', severity);
  if (category_id) add('i.category_id = ?', Number(category_id));
  if (location_id) add('i.location_id = ?', Number(location_id));
  if (officer_id) add('EXISTS (SELECT 1 FROM incident_assignments a WHERE a.incident_id=i.id AND a.officer_id=?)', Number(officer_id));
  if (from) add('i.incident_datetime >= ?', from);
  if (to) add("i.incident_datetime < (?::date + 1)", to);
  if (ref) add('i.reference_no ILIKE ?', `%${ref}%`);

  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(100, Number(req.query.size) || 25);
  const { rows } = await q(
    `SELECT i.id,i.reference_no,i.severity,i.status,i.incident_datetime,i.reported_datetime,i.due_at,
            i.is_anonymous,i.referred_to_discipline,c.name AS category,l.name AS location,
            (i.due_at IS NOT NULL AND i.due_at < now() AND i.status NOT IN ('Resolved','Closed')) AS overdue,
            COUNT(*) OVER() AS total
       FROM incidents i
       LEFT JOIN incident_categories c ON c.id=i.category_id
       LEFT JOIN locations l ON l.id=i.location_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY i.reported_datetime DESC
      LIMIT ${size} OFFSET ${(page - 1) * size}`, p);
  res.json({ total: rows[0] ? Number(rows[0].total) : 0, page, items: rows.map(({ total, ...r }) => r) });
});

router.get('/:id(\\d+)', auth, async (req, res) => {
  const inc = await loadIncident(req.params.id);
  if (!(await canView(req.user, inc))) return res.status(404).json({ error: 'Incident not found.' });
  const security = isSecurity(req.user) || req.user.role === 'management';
  const isReporter = inc.reporter_id === req.user.id;

  const { rows: updates } = await q(
    `SELECT u.id,u.note,u.old_status,u.new_status,u.is_public,u.created_at,
            CASE WHEN u.user_id IS NULL THEN 'Reporter' ELSE us.full_name END AS author
       FROM incident_updates u LEFT JOIN users us ON us.id=u.user_id
      WHERE u.incident_id=$1 ${security || req.user.role === 'dean' ? '' : 'AND u.is_public'} ORDER BY u.created_at`, [inc.id]);
  const { rows: evidence } = await q(
    'SELECT id,original_name,mime_type,size_bytes,uploaded_at FROM evidence WHERE incident_id=$1 ORDER BY id', [inc.id]);

  let reporter = null;
  if (inc.reporter_id && (isSecurity(req.user) || isReporter || (req.user.role === 'management' && !inc.hide_identity) || (req.user.role === 'dean' && !inc.hide_identity))) {
    const { rows } = await q('SELECT id,full_name,reg_no,phone,email FROM users WHERE id=$1', [inc.reporter_id]);
    reporter = rows[0];
  }
  const out = sanitize(inc);
  delete out.reporter_id;
  res.json({ ...out, reporter, updates, evidence });
});

// Head of Security: verify/classify (severity + SLA)
router.post('/:id(\\d+)/classify', auth, requireRole('head_security', 'admin'), async (req, res) => {
  const { severity, category_id } = req.body || {};
  if (!SLA_MINUTES[severity]) return res.status(400).json({ error: 'Choose a severity: Critical, High, Medium or Low.' });
  const inc = await loadIncident(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found.' });
  await tx(async (c) => {
    await c.query(
      `UPDATE incidents SET severity=$2, category_id=COALESCE($3,category_id),
              due_at=reported_datetime + ($4 || ' minutes')::interval,
              status=CASE WHEN status='Submitted' THEN 'Verified' ELSE status END WHERE id=$1`,
      [inc.id, severity, category_id ? Number(category_id) : null, String(SLA_MINUTES[severity])]);
    await c.query(`INSERT INTO incident_updates(incident_id,user_id,note,old_status,new_status,is_public)
                   VALUES($1,$2,$3,$4,'Verified',TRUE)`,
      [inc.id, req.user.id, `Classified as ${severity}`, inc.status]);
  });
  await audit(req, 'INCIDENT_CLASSIFIED', 'incident', inc.id, { severity });
  if (inc.reporter_id) await notifyUsers([inc.reporter_id], 'Your report was verified', inc.reference_no, 'incident', `#/incident/${inc.id}`);
  if (severity === 'Critical') await notifyRoles(['management'], 'CRITICAL incident', `${inc.reference_no} classified Critical`, 'critical', `#/incident/${inc.id}`);
  res.json({ ok: true });
});

// Assign to one or more officers
router.post('/:id(\\d+)/assign', auth, requireRole('head_security', 'admin'), async (req, res) => {
  const ids = (req.body.officer_ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Select at least one officer.' });
  const inc = await loadIncident(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found.' });
  const { rows: valid } = await q("SELECT id FROM users WHERE id = ANY($1) AND role='security_officer' AND is_active", [ids]);
  if (!valid.length) return res.status(400).json({ error: 'Those users are not active security officers.' });
  for (const o of valid)
    await q('INSERT INTO incident_assignments(incident_id,officer_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [inc.id, o.id, req.user.id]);
  await q(`INSERT INTO incident_updates(incident_id,user_id,note,is_public) VALUES($1,$2,'Assigned to security officer(s)',TRUE)`, [inc.id, req.user.id]);
  await audit(req, 'INCIDENT_ASSIGNED', 'incident', inc.id, { officers: valid.map((v) => v.id) });
  await notifyUsers(valid.map((v) => v.id), 'New assignment', `${inc.reference_no} was assigned to you`, 'assignment', `#/incident/${inc.id}`);
  res.json({ ok: true });
});

const TRANSITIONS = {
  Submitted: { Verified: ['head_security', 'admin'] },
  Verified: { 'In Progress': ['head_security', 'admin', 'security_officer'] },
  'In Progress': { Resolved: ['head_security', 'admin', 'security_officer'] },
  Resolved: { Closed: ['head_security', 'admin'], 'In Progress': ['head_security', 'admin'] },
  Closed: {},
};

router.post('/:id(\\d+)/status', auth, requireRole('head_security', 'admin', 'security_officer'), async (req, res) => {
  const { status, note, resolution_summary } = req.body || {};
  const inc = await loadIncident(req.params.id);
  if (!(await canView(req.user, inc))) return res.status(404).json({ error: 'Incident not found.' });
  const allowed = TRANSITIONS[inc.status] && TRANSITIONS[inc.status][status];
  if (!allowed || !allowed.includes(req.user.role))
    return res.status(400).json({ error: `You cannot change an incident from "${inc.status}" to "${status}".` });
  if (['Resolved', 'Closed'].includes(status) && !(resolution_summary || inc.resolution_summary))
    return res.status(400).json({ error: 'Please write a resolution summary.' });
  if (status === 'Verified' && !inc.severity) return res.status(400).json({ error: 'Classify the incident (set severity) first.' });

  await q(
    `UPDATE incidents SET status=$2, resolution_summary=COALESCE($3,resolution_summary),
            closed_datetime=CASE WHEN $2='Closed' THEN now() ELSE closed_datetime END WHERE id=$1`,
    [inc.id, status, resolution_summary || null]);
  await q(`INSERT INTO incident_updates(incident_id,user_id,note,old_status,new_status,is_public)
           VALUES($1,$2,$3,$4,$5,TRUE)`, [inc.id, req.user.id, note || resolution_summary || null, inc.status, status]);
  await audit(req, 'INCIDENT_STATUS_CHANGED', 'incident', inc.id, { from: inc.status, to: status });
  if (inc.reporter_id) await notifyUsers([inc.reporter_id], `Report ${inc.reference_no}: ${status}`, note || resolution_summary, 'incident', `#/incident/${inc.id}`);
  if (status === 'Resolved') await notifyRoles(['head_security'], 'Closure requested', `${inc.reference_no} is resolved and needs your approval to close.`, 'incident', `#/incident/${inc.id}`);
  res.json({ ok: true });
});

router.post('/:id(\\d+)/notes', auth, requireRole('head_security', 'admin', 'security_officer', 'dean'), async (req, res) => {
  const note = String(req.body.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Write a note first.' });
  const inc = await loadIncident(req.params.id);
  if (!(await canView(req.user, inc))) return res.status(404).json({ error: 'Incident not found.' });
  const pub = req.body.is_public === true || req.body.is_public === 'true';
  await q('INSERT INTO incident_updates(incident_id,user_id,note,is_public) VALUES($1,$2,$3,$4)', [inc.id, req.user.id, note, pub && req.user.role !== 'dean']);
  await audit(req, 'INCIDENT_NOTE_ADDED', 'incident', inc.id, { public: pub });
  if (pub && inc.reporter_id) await notifyUsers([inc.reporter_id], `Update on ${inc.reference_no}`, note, 'incident', `#/incident/${inc.id}`);
  res.json({ ok: true });
});

router.post('/:id(\\d+)/evidence', auth, upload.array('evidence', 5), async (req, res) => {
  const inc = await loadIncident(req.params.id);
  if (!(await canView(req.user, inc)) || !(isSecurity(req.user) || inc.reporter_id === req.user.id)) {
    for (const f of req.files || []) fs.unlink(f.path, () => {});
    return res.status(404).json({ error: 'Incident not found.' });
  }
  for (const f of req.files || [])
    await q(`INSERT INTO evidence(incident_id,stored_name,original_name,mime_type,size_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)`,
      [inc.id, f.filename, f.originalname, f.mimetype, f.size, req.user.id]);
  await audit(req, 'EVIDENCE_UPLOADED', 'incident', inc.id, { count: (req.files || []).length });
  res.json({ ok: true });
});

router.post('/:id(\\d+)/escalate', auth, requireRole('head_security', 'admin'), async (req, res) => {
  const { to, note } = req.body || {};
  if (!['management', 'dean', 'external'].includes(to)) return res.status(400).json({ error: 'Choose management, dean or external.' });
  const inc = await loadIncident(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found.' });
  await q('UPDATE incidents SET escalated_to=$2, referred_to_discipline = referred_to_discipline OR $3 WHERE id=$1', [inc.id, to, to === 'dean']);
  await q('INSERT INTO incident_updates(incident_id,user_id,note,is_public) VALUES($1,$2,$3,FALSE)', [inc.id, req.user.id, `Escalated to ${to}${note ? ': ' + note : ''}`]);
  await audit(req, 'INCIDENT_ESCALATED', 'incident', inc.id, { to });
  if (to === 'management') await notifyRoles(['management'], 'Escalated incident', inc.reference_no, 'critical', `#/incident/${inc.id}`);
  if (to === 'dean') await notifyRoles(['dean'], 'Disciplinary referral', inc.reference_no, 'incident', `#/incident/${inc.id}`);
  res.json({ ok: true });
});

// Evidence download: authenticated + same visibility rules as the incident
router.get('/evidence/:eid(\\d+)', auth, async (req, res) => {
  const { rows } = await q('SELECT * FROM evidence WHERE id=$1', [req.params.eid]);
  const ev = rows[0];
  if (!ev) return res.status(404).json({ error: 'File not found.' });
  const inc = await loadIncident(ev.incident_id);
  if (!(await canView(req.user, inc))) return res.status(404).json({ error: 'File not found.' });
  res.setHeader('Content-Type', ev.mime_type || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(ev.original_name)}"`);
  res.sendFile(path.join(UPLOAD_DIR, ev.stored_name));
});

module.exports = router;
