const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err.message);
});

// All queries use parameters ($1, $2...) to prevent SQL injection (SRS 3.5).
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  connect: () => pool.connect(),
};
