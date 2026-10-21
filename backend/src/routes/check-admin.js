// Purpose: API routes and access rules for check admin operations.

require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const result = await db.query(
      `SELECT id, username, email, is_active, role
       FROM users
       WHERE username = $1 OR email = $1`,
      ['admin']
    );

    console.log('Admin account lookup:');
    console.log(result.rows);
  } catch (error) {
    console.error('Failed:', error.message);
  } finally {
    await db.pool.end();
  }
})();
