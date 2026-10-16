
const express = require('express');
const db = require('../db');
const {
  authenticate,
  requireRole,
  ROLES
} = require('../middleware/auth');
const { wrap, toInt, paging, where } = require('../utils/helpers');

const router = express.Router();

// GET /api/audit-logs?user_id=&action=&from=&to=
router.get(
  '/',
  authenticate,
  requireRole(ROLES.ADMIN, ROLES.HEAD_OF_SECURITY),
  wrap(async (req, res) => {
    const w = where();

    if (req.query.user_id) {
      w.add('a.user_id = ?', toInt(req.query.user_id));
    }

    if (req.query.action) {
      w.add('a.action ILIKE ?', `%${req.query.action}%`);
    }

    if (req.query.status) {
      w.add('a.status = ?', req.query.status);
    }

    if (req.query.from) {
      w.add('a.created_at >= ?', req.query.from);
    }

    if (req.query.to) {
      w.add('a.created_at <= ?', req.query.to);
    }

    const { limit, offset } = paging(req);

    const { rows } = await db.query(
      `SELECT
         a.id,
         a.user_id,
         u.username,
         a.actor,
         a.action,
         a.entity AS target_table,
         a.entity_id AS record_id,
         a.ip AS ip_address,
         a.created_at AS timestamp,
         a.status,
         a.details
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${w.clause}
       ORDER BY a.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      w.params
    );

    res.json(rows);
  })
);

module.exports = router;
