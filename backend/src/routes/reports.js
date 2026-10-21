// Purpose: API routes and access rules for reports operations.

const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, where, HttpError } = require('../utils/helpers');
const { toCsv } = require('../utils/csv');
const { audit } = require('../utils/audit');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const router = express.Router();

router.use(
  authenticate,
  requireRole(
    ROLES.ADMIN,
    ROLES.HEAD_OF_SECURITY,
    ROLES.COLLEGE_MANAGEMENT,
    ROLES.DEAN
  )
);

function range(w, column, q) {
  if (q.from) w.add(`${column} >= ?`, q.from);
  if (q.to) w.add(`${column} <= ?`, q.to);
}

const REPORTS = {
  incidents: (q) => {
    const w = where();
    range(w, 'i.reported_datetime', q);

    if (q.category_id) w.add('i.category_id = ?', Number(q.category_id));
    if (q.severity) w.add('i.severity = ?', q.severity);
    if (q.status) w.add('i.status = ?', q.status);
    if (q.location_id) w.add('i.location_id = ?', Number(q.location_id));
    if (q.assigned_to) {
      w.add(`EXISTS (
        SELECT 1 FROM incident_assignments ia
         WHERE ia.incident_id = i.id AND ia.officer_id = ?
      )`, Number(q.assigned_to));
    }

    return [
      `SELECT i.reference_no,
              c.name AS category,
              l.name AS location,
              i.severity,
              i.status,
              i.incident_datetime,
              i.reported_datetime,
              i.closed_datetime,
              i.is_anonymous
         FROM incidents i
         LEFT JOIN incident_categories c ON c.id = i.category_id
         LEFT JOIN locations l ON l.id = i.location_id
         ${w.clause}
        ORDER BY i.reported_datetime DESC`,
      w.params
    ];
  },

  'lost-found': (q) => {
    const w = where();
    range(w, 'i.created_at', q);

    if (q.kind) w.add('i.kind = ?', q.kind);
    if (q.status) w.add('i.status = ?', q.status);

    return [
      `SELECT i.id,
              i.kind,
              i.title,
              i.description,
              i.category,
              i.location_text,
              i.event_date,
              i.status,
              i.collected_by_name,
              i.collected_at,
              i.created_at
         FROM items i
         ${w.clause}
        ORDER BY i.created_at DESC`,
      w.params
    ];
  },

  gate: (q) => {
    const w = where();
    range(w, 'v.entry_at', q);

    if (q.on_campus === 'true') w.raw('v.exit_at IS NULL');

    return [
      `SELECT v.id,
              v.full_name,
              v.id_number,
              v.phone,
              v.purpose,
              v.host_text,
              v.badge_no,
              v.vehicle_plate,
              v.entry_at,
              v.exit_at
         FROM visitors v
         ${w.clause}
        ORDER BY v.entry_at DESC`,
      w.params
    ];
  },

  patrol: (q) => {
    const w = where();
    range(w, 'p.scanned_at', q);

    if (q.officer_id) w.add('p.officer_id = ?', Number(q.officer_id));

    return [
      `SELECT u.username AS officer,
              c.name AS checkpoint,
              p.scanned_at,
              p.notes
         FROM patrol_logs p
         JOIN users u ON u.id = p.officer_id
         JOIN checkpoints c ON c.id = p.checkpoint_id
         ${w.clause}
        ORDER BY p.scanned_at DESC`,
      w.params
    ];
  },

  audit: (q) => {
    const w = where();
    range(w, 'a.created_at', q);

    if (q.action) w.add('a.action = ?', q.action);

    return [
      `SELECT a.id,
              a.actor,
              a.action,
              a.entity,
              a.entity_id,
              a.ip,
              a.status,
              a.created_at
         FROM audit_log a
         ${w.clause}
        ORDER BY a.created_at DESC`,
      w.params
    ];
  }
};

REPORTS.incident = (q) => {
  if (!q.reference_no) throw new HttpError(400, 'reference_no is required for an individual incident report');
  const w = where();
  w.add('i.reference_no = ?', String(q.reference_no).trim());
  return [
    `SELECT i.reference_no, c.name AS category, l.name AS location,
            i.description, i.incident_datetime, i.reported_datetime,
            i.severity, i.status, i.resolution_summary, i.closed_datetime,
            i.is_anonymous
       FROM incidents i
       LEFT JOIN incident_categories c ON c.id = i.category_id
       LEFT JOIN locations l ON l.id = i.location_id ${w.clause}`,
    w.params
  ];
};

REPORTS.emergency = (q) => {
  const w = where();
  range(w, 'a.triggered_at', q);
  if (q.status) w.add('a.status = ?', q.status);
  return [
    `SELECT a.id, COALESCE(u.full_name, u.username) AS sender,
            a.message, a.lat, a.lng, a.status, a.triggered_at,
            a.acknowledged_at, a.arrived_at, a.resolved_at, a.repeat_count
       FROM emergency_alerts a JOIN users u ON u.id = a.user_id
       ${w.clause} ORDER BY a.triggered_at DESC`,
    w.params
  ];
};

REPORTS['response-time'] = (q) => {
  const w = where();
  range(w, 'i.reported_datetime', q);
  if (q.severity) w.add('i.severity = ?', q.severity);
  if (q.location_id) w.add('i.location_id = ?', Number(q.location_id));
  return [
    `SELECT i.reference_no, i.severity, i.reported_datetime,
            first_response.responded_at,
            ROUND(EXTRACT(EPOCH FROM (first_response.responded_at - i.reported_datetime)) / 60)::int AS response_minutes,
            i.closed_datetime,
            ROUND(EXTRACT(EPOCH FROM (i.closed_datetime - i.reported_datetime)) / 60)::int AS resolution_minutes
       FROM incidents i
       LEFT JOIN LATERAL (
         SELECT MIN(u.created_at) AS responded_at FROM incident_updates u
          WHERE u.incident_id = i.id AND u.new_status IN ('Verified', 'In Progress')
       ) first_response ON TRUE
       ${w.clause} ORDER BY i.reported_datetime DESC`,
    w.params
  ];
};

REPORTS['incident-summary'] = (q) => {
  const requested = String(q.period || 'month').toLowerCase();
  const period = ['day', 'week', 'month', 'year'].includes(requested) ? requested : 'month';
  const w = where();
  range(w, 'i.reported_datetime', q);
  if (q.category_id) w.add('i.category_id = ?', Number(q.category_id));
  if (q.location_id) w.add('i.location_id = ?', Number(q.location_id));
  if (q.severity) w.add('i.severity = ?', q.severity);
  return [
    `SELECT date_trunc('${period}', i.reported_datetime) AS period,
            c.name AS category, i.severity, i.status,
            COUNT(*)::int AS incident_count
       FROM incidents i JOIN incident_categories c ON c.id = i.category_id
       ${w.clause} GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 2, 3`,
    w.params
  ];
};

REPORTS.disciplinary = (q) => {
  const w = where();
  range(w, 'i.reported_datetime', q);
  w.raw('i.referred_to_discipline = TRUE');
  if (q.status) w.add('i.status = ?', q.status);
  return [
    `SELECT i.reference_no, i.reported_datetime, i.severity, i.status,
            i.resolution_summary, c.name AS category
       FROM incidents i LEFT JOIN incident_categories c ON c.id = i.category_id
       ${w.clause} ORDER BY i.reported_datetime DESC`,
    w.params
  ];
};

REPORTS['officer-performance'] = (q) => {
  const w = where();
  range(w, 'p.scanned_at', q);
  if (q.officer_id) w.add('p.officer_id = ?', Number(q.officer_id));
  return [
    `SELECT u.id AS officer_id, u.full_name AS officer,
            COUNT(*)::int AS checkins,
            COUNT(DISTINCT p.checkpoint_id)::int AS checkpoints_covered,
            MAX(p.scanned_at) AS last_checkin
       FROM patrol_logs p JOIN users u ON u.id = p.officer_id
       ${w.clause} GROUP BY u.id, u.full_name ORDER BY checkins DESC`,
    w.params
  ];
};

// GET /api/reports/:type?from=&to=&format=csv|xlsx|pdf
router.get('/:type', wrap(async (req, res) => {
  const build = REPORTS[req.params.type];

  if (!build) {
    throw new HttpError(
      404,
      `Unknown report. Available: ${Object.keys(REPORTS).join(', ')}`
    );
  }
  if (req.params.type === 'audit' &&
      ![ROLES.ADMIN, ROLES.HEAD_OF_SECURITY].includes(req.user.role)) {
    throw new HttpError(403, 'You do not have access to audit reports');
  }

  let [sql, params] = build(req.query);
  if (req.user.role === ROLES.DEAN && /\bincidents\s+i\b/i.test(sql)) {
    const clause = 'i.reporter_id IN (SELECT id FROM users WHERE role = \'student\')';
    const boundary = sql.search(/\s(?:GROUP BY|ORDER BY)\b/i);
    const head = boundary < 0 ? sql : sql.slice(0, boundary);
    const tail = boundary < 0 ? '' : sql.slice(boundary);
    sql = `${head}${/\bWHERE\b/i.test(head) ? ' AND ' : ' WHERE '}${clause}${tail}`;
  }
  const { rows } = await db.query(`${sql} LIMIT 10000`, params);
  const format = String(req.query.format || 'json').toLowerCase();
  if (!['json', 'csv', 'xlsx', 'pdf'].includes(format)) {
    throw new HttpError(400, 'format must be json, csv, xlsx, or pdf');
  }

  await audit(req, {
    userId: req.user.id,
    action: `GENERATE REPORT ${req.params.type}`,
    targetTable: 'reports'
  });

  if (format === 'csv') {
    const csv = rows.length
      ? toCsv(rows)
      : 'No records found';

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="csrs-${req.params.type}-report.csv"`
    );

    return res.send(csv);
  }

  const filename = `csrs-${req.params.type}-report`;
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CSRS';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Report');
    const headers = rows.length ? Object.keys(rows[0]) : [];
    sheet.columns = headers.map((header) => ({ header, key: header, width: Math.min(32, Math.max(14, header.length + 2)) }));
    for (const row of rows) {
      const safe = {};
      for (const header of headers) {
        const value = row[header];
        safe[header] = typeof value === 'string' && /^[=+\-@\t\r]/.test(value)
          ? `'${value}`
          : value;
      }
      sheet.addRow(safe);
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123B70' } };
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  }

  if (format === 'pdf') {
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    pdf.pipe(res);
    pdf.fontSize(16).font('Helvetica-Bold').text(`CSRS ${req.params.type} report`);
    pdf.moveDown(0.5).fontSize(9).font('Helvetica').text(`Generated: ${new Date().toISOString()} | Records: ${rows.length}`);
    pdf.moveDown();
    if (!rows.length) {
      pdf.text('No records found for the selected filters.');
    } else {
      for (const [index, row] of rows.entries()) {
        const line = Object.entries(row)
          .map(([key, value]) => `${key}: ${value == null ? '' : String(value)}`)
          .join('   |   ');
        if (pdf.y > pdf.page.height - 55) pdf.addPage();
        pdf.font('Helvetica-Bold').fontSize(9).text(`${index + 1}.`, { continued: true });
        pdf.font('Helvetica').fontSize(8).text(` ${line}`, { width: pdf.page.width - 72 });
        pdf.moveDown(0.35);
      }
    }
    pdf.end();
    return;
  }

  return res.json({
    report: req.params.type,
    count: rows.length,
    rows
  });
}));

module.exports = router;
