
require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const result = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_log'
      ORDER BY ordinal_position
    `);

    console.table(result.rows);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.pool.end();
  }
})();
