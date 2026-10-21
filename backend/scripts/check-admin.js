// Purpose: Developer or deployment utility for check admin tasks.

require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const result = await db.query(
      `SELECT id, username, email, role, is_active,
              failed_attempts, locked_until,
              (password_hash IS NOT NULL) AS has_password
       FROM users
       WHERE username = $1 OR email = $1`,
      [process.env.ADMIN_USERNAME]
    );

    console.table(result.rows);
  } catch (error) {
    console.error('Database check failed:', error.message);
  } finally {
    await db.pool.end();
  }
})();
