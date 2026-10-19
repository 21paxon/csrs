
const db = require('../db');

// Write audit events to the existing audit_log table.
// Logging failures must not break the original request.
async function audit(req, {
  userId = null,
  action,
  targetTable = null,
  recordId = null,
  status = 'Successful',
  anonymous = false
}) {
  try {
    await db.query(
      `INSERT INTO audit_log
        (user_id, actor, action, entity, entity_id, ip, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        anonymous ? null : (req.user?.username || null),
        action,
        targetTable,
        recordId == null ? null : String(recordId),
        anonymous ? null : (req.ip || null),
        status
      ]
    );
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

module.exports = { audit };
