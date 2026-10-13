
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

(async () => {
  try {
    const result = await db.query(
      'SELECT password_hash FROM users WHERE username = $1',
      [process.env.ADMIN_USERNAME]
    );

    if (!result.rows.length) {
      console.log('Admin account not found.');
      return;
    }

    const matches = await bcrypt.compare(
      process.env.ADMIN_PASSWORD || '',
      result.rows[0].password_hash
    );

    console.log('Configured password matches database:', matches);
  } catch (error) {
    console.error('Verification failed:', error.message);
  } finally {
    await db.pool.end();
  }
})();
