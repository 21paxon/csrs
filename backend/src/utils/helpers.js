// Small shared helpers: async wrapper, validation, pagination.

// Express 4 does not catch rejected promises; this forwards them to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const toInt = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toBool = (v) => v === true || v === 'true' || v === '1' || v === 1;

const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const INCIDENT_STATUSES = ['Submitted', 'Verified', 'In Progress', 'Resolved', 'Closed', 'Rejected', 'Duplicate', 'Escalated'];
const SHIFT_TYPES = ['Morning', 'Afternoon', 'Night'];

// ?limit=&offset= with sane caps.
function paging(req) {
  const limit = Math.min(Math.max(toInt(req.query.limit) || 50, 1), 200);
  const offset = Math.max(toInt(req.query.offset) || 0, 0);
  return { limit, offset };
}

// Builds "WHERE a = $1 AND b = $2" incrementally.
function where() {
  const parts = [];
  const params = [];
  return {
    add(sqlWithPlaceholder, value) {
      params.push(value);
      parts.push(sqlWithPlaceholder.replaceAll('?', `$${params.length}`)); // every ? refers to this one value
    },
    raw(sql) { parts.push(sql); },
    get clause() { return parts.length ? `WHERE ${parts.join(' AND ')}` : ''; },
    params,
  };
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { wrap, toInt, toNum, toBool, isDate, SEVERITIES, INCIDENT_STATUSES, SHIFT_TYPES, paging, where, HttpError };
