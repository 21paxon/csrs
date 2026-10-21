// Purpose: Developer or deployment utility for check users tasks.

require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const result = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
      ORDER BY ordinal_position
    `);

    console.log('Actual users table columns:');
    console.log(result.rows.map(row => row.column_name));
  } catch (error) {
    console.error('Failed:', error.message);
  } finally {
    await db.pool.end();
  }
})();
