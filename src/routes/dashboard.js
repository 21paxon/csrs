
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, ROLES } = require('../middleware/auth');
const { wrap, toInt } = require('../utils/helpers');

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

// GET /api/dashboard?days=30
router.get('/', wrap(async (req, res) => {
  const days = Math.min(Math.max(toInt(req.query.days) || 30, 1), 365);

  const [
    totals,
    bySeverity,
    byStatus,
    byCategory,
    hotspots,
    trend,
    alerts,
    visitors,
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (
                WHERE status NOT IN ('Resolved', 'Closed', 'Rejected', 'Duplicate')
              )::int AS open,
              COUNT(*) FILTER (
                WHERE severity = 'Critical'
                  AND status NOT IN ('Resolved', 'Closed', 'Rejected', 'Duplicate')
              )::int AS open_critical,
              ROUND(
                AVG(EXTRACT(EPOCH FROM (closed_datetime - reported_datetime)) / 3600)::numeric,
                1
              ) AS avg_hours_to_close
         FROM incidents
        WHERE reported_datetime >= CURRENT_TIMESTAMP - make_interval(days => $1)`,
      [days]
    ),

    db.query(
      `SELECT severity::text AS severity, COUNT(*)::int AS count
         FROM incidents
        WHERE reported_datetime >= CURRENT_TIMESTAMP - make_interval(days => $1)
        GROUP BY severity`,
      [days]
    ),

    db.query(
      `SELECT status::text AS status, COUNT(*)::int AS count
         FROM incidents
        WHERE reported_datetime >= CURRENT_TIMESTAMP - make_interval(days => $1)
        GROUP BY status`,
      [days]
    ),

    db.query(
      `SELECT c.name AS category, COUNT(*)::int AS count
         FROM incidents i
         JOIN incident_categories c ON c.id = i.category_id
        WHERE i.reported_datetime >= CURRENT_TIMESTAMP - make_interval(days => $1)
        GROUP BY c.name
        ORDER BY count DESC`,
      [days]
    ),

    db.query(
      `SELECT l.id AS location_id,
              l.name AS location,
              l.lat,
              l.lng,
              COUNT(*)::int AS incidents
         FROM incidents i
         JOIN locations l ON l.id = i.location_id
        WHERE i.reported_datetime >= CURRENT_TIMESTAMP - make_interval(days => $1)
        GROUP BY l.id, l.name, l.lat, l.lng
        ORDER BY incidents DESC
        LIMIT 10`,
      [days]
    ),

    db.query(
      `SELECT reported_datetime::date AS day, COUNT(*)::int AS count
         FROM incidents
        WHERE reported_datetime >= CURRENT_TIMESTAMP - make_interval(days => $1)
        GROUP BY day
        ORDER BY day`,
      [days]
    ),

    db.query(
      `SELECT COUNT(*)::int AS pending
         FROM emergency_alerts
        WHERE status = 'Pending'`
    ),

    db.query(
      `SELECT COUNT(*)::int AS on_campus
         FROM visitors
        WHERE exit_at IS NULL`
    ),
  ]);

  res.json({
    period_days: days,
    incidents: totals.rows[0],
    by_severity: bySeverity.rows,
    by_status: byStatus.rows,
    by_category: byCategory.rows,
    hotspots: hotspots.rows,
    daily_trend: trend.rows,
    pending_emergency_alerts: alerts.rows[0].pending,
    visitors_on_campus: visitors.rows[0].on_campus,
  });
}));

module.exports = router;
