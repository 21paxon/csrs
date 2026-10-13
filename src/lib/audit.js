const { q } = require('../db');

// Never throws: an audit failure must not break the user's action, but is logged loudly.
async function audit(req, action, entity, entityId, details, status = 'Successful', userOverride) {
  try {
    const u = userOverride || (req && req.user) || null;
    const ip = req ? (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() : null;
    await q(
      `INSERT INTO audit_log(user_id,actor,action,entity,entity_id,ip,status,details)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u ? u.id : null, u ? (u.username || u.email || u.full_name) : 'anonymous',
       action, entity || null, entityId != null ? String(entityId) : null, ip, status,
       details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('AUDIT FAILURE', action, e.message);
  }
}
module.exports = { audit };
