// Purpose: Developer or deployment utility for seed admin tasks.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

(async () => {
  try {
    const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;

    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        'Set ADMIN_USERNAME and ADMIN_PASSWORD in .env'
      );
    }

    if (ADMIN_PASSWORD.length < 12) {
      throw new Error('Use an admin password of at least 12 characters.');
    }

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    const result = await db.query(
      `UPDATE users
       SET password_hash = $1,
           failed_attempts = 0,
           locked_until = NULL
       WHERE username = $2
       RETURNING id`,
      [hash, ADMIN_USERNAME]
    );

    if (result.rowCount === 0) {
      console.log(
        `No account found for username "${ADMIN_USERNAME}". No changes made.`
      );
    } else {
      console.log(
        `Password reset successfully for "${ADMIN_USERNAME}".`
      );
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
