// Creates all tables from db/schema.sql. Run once on an empty csrs_db: npm run db:init
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await db.query(sql);
    console.log('Database schema created.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
