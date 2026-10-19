
const express = require("express");
const db = require("../db");
const {
  authenticate,
  requireRole,
  ROLES
} = require("../middleware/auth");
const {
  wrap,
  toInt
} = require("../utils/helpers");

const router = express.Router();

router.use(
  authenticate,
  requireRole(
    ROLES.ADMIN,
    ROLES.HEAD_OF_SECURITY,
    ROLES.COLLEGE_MANAGEMENT,
    ROLES.DEAN,
    ROLES.SECURITY_OFFICER
  )
);

// GET /api/dashboard?days=30
router.get(
  "/",
  wrap(async (req, res) => {
    const days = Math.min(
      Math.max(toInt(req.query.days) || 30, 1),
      365
    );
    const studentScope = req.user.role === ROLES.DEAN
      ? " AND i.reporter_id IN (SELECT id FROM users WHERE role = 'student')"
      : '';

    const [
      totals,
      bySeverity,
      byStatus,
      byCategory,
      hotspots,
      trend,
      alerts,
      visitors,
      users,
      overdue,
      missed
    ] = await Promise.all([
      // Incident totals and open critical incidents.
      db.query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE status NOT IN (
                'Resolved', 'Closed', 'Rejected', 'Duplicate'
              )
            )::int AS open,
            COUNT(*) FILTER (
              WHERE severity = 'Critical'
                AND status NOT IN (
                  'Resolved', 'Closed', 'Rejected', 'Duplicate'
                )
            )::int AS open_critical,
            ROUND(
              AVG(
                EXTRACT(
                  EPOCH FROM (closed_datetime - reported_datetime)
                ) / 3600
              )::numeric,
              1
            ) AS avg_hours_to_close
         FROM incidents i
         WHERE i.reported_datetime >=
           CURRENT_TIMESTAMP - make_interval(days => $1)${studentScope}`,
        [days]
      ),

      // Incidents grouped by severity.
      db.query(
        `SELECT
            i.severity::text AS severity,
            COUNT(*)::int AS count
         FROM incidents i
         WHERE i.reported_datetime >=
           CURRENT_TIMESTAMP - make_interval(days => $1)${studentScope}
         GROUP BY i.severity
         ORDER BY count DESC`,
        [days]
      ),

      // Incidents grouped by status.
      db.query(
        `SELECT
            i.status::text AS status,
            COUNT(*)::int AS count
         FROM incidents i
         WHERE i.reported_datetime >=
           CURRENT_TIMESTAMP - make_interval(days => $1)${studentScope}
         GROUP BY i.status
         ORDER BY count DESC`,
        [days]
      ),

      // Incidents grouped by category.
      db.query(
        `SELECT
            c.name AS category,
            COUNT(*)::int AS count
         FROM incidents i
         JOIN incident_categories c ON c.id = i.category_id
         WHERE i.reported_datetime >=
           CURRENT_TIMESTAMP - make_interval(days => $1)${studentScope}
         GROUP BY c.name
         ORDER BY count DESC`,
        [days]
      ),

      // Locations with the most reported incidents.
      db.query(
        `SELECT
            i.location_id,
            COALESCE(l.name, i.location_text, 'Map pin') AS location,
            COALESCE(i.lat, l.lat) AS lat,
            COALESCE(i.lng, l.lng) AS lng,
            COUNT(*)::int AS incidents
         FROM incidents i
         LEFT JOIN locations l ON l.id = i.location_id
         WHERE i.reported_datetime >=
           CURRENT_TIMESTAMP - make_interval(days => $1)
           AND COALESCE(i.lat, l.lat) IS NOT NULL
           AND COALESCE(i.lng, l.lng) IS NOT NULL
           ${studentScope}
         GROUP BY i.location_id, COALESCE(l.name, i.location_text, 'Map pin'),
                  COALESCE(i.lat, l.lat), COALESCE(i.lng, l.lng)
         ORDER BY incidents DESC, location ASC
         LIMIT 10`,
        [days]
      ),

      // Daily incident trend.
      db.query(
        `SELECT
            i.reported_datetime::date AS day,
            COUNT(*)::int AS count
         FROM incidents i
         WHERE i.reported_datetime >=
           CURRENT_TIMESTAMP - make_interval(days => $1)${studentScope}
         GROUP BY i.reported_datetime::date
         ORDER BY day ASC`,
        [days]
      ),

      // Count all unresolved emergency alerts.
      // The emergency module uses Triggered, Acknowledged,
      // and Arrived before an alert is Resolved.
      db.query(
        `SELECT COUNT(*)::int AS pending
         FROM emergency_alerts
         WHERE status IN ('Triggered', 'Acknowledged', 'Arrived')`
      ),

      // Visitors who have not recorded an exit.
      db.query(
        `SELECT COUNT(*)::int AS on_campus
         FROM visitors
         WHERE exit_at IS NULL`
      ),
      db.query(
        `SELECT
            COUNT(*)::int AS registered_users,
            COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_users,
            COUNT(*) FILTER (WHERE is_active = FALSE)::int AS pending_registrations
         FROM users`
      ),
      db.query(
        `SELECT COUNT(*)::int AS overdue
           FROM incidents i
          WHERE i.due_at IS NOT NULL
            AND i.due_at < CURRENT_TIMESTAMP
            AND i.status NOT IN ('Resolved', 'Closed', 'Rejected', 'Duplicate')${studentScope}`
      ),
      db.query(
        `SELECT COUNT(*)::int AS missed
           FROM duty_rosters d
           JOIN route_checkpoints rc ON rc.route_id = d.route_id
          WHERE d.end_at < CURRENT_TIMESTAMP
            AND d.start_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
            AND NOT EXISTS (
              SELECT 1 FROM patrol_logs p
               WHERE p.officer_id = d.officer_id
                 AND p.checkpoint_id = rc.checkpoint_id
                 AND p.scanned_at BETWEEN d.start_at AND d.end_at
            )`
      )
    ]);

    const incidentTotals = totals.rows[0];
    const userTotals = users.rows[0];

    res.json({
      period_days: days,
      incidents: incidentTotals,
      total_incidents: incidentTotals.total,
      by_severity: bySeverity.rows,
      severity_breakdown: bySeverity.rows,
      by_status: byStatus.rows,
      status_breakdown: byStatus.rows,
      by_category: byCategory.rows,
      hotspots: hotspots.rows,
      daily_trend: trend.rows,
      pending_emergency_alerts: alerts.rows[0].pending,
      pending_alerts: alerts.rows[0].pending,
      visitors_on_campus: visitors.rows[0].on_campus,
      registered_users: userTotals.registered_users,
      pending_registrations: userTotals.pending_registrations,
      overdue_incidents: overdue.rows[0].overdue,
      missed_patrols: missed.rows[0].missed
    });
  })
);

module.exports = router;
