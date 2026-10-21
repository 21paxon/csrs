// Purpose: Developer or deployment utility for test db tasks.

const db = require('../src/db');

(async () => {
  try {
    const result = await db.query(`
      SELECT current_database() AS database_name,
             current_user AS database_user,
             NOW() AS server_time
    `);

    console.log('Database connection successful:');
    console.log(result.rows[0]);
  } catch (error) {
    console.error('Database connection failed:');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
  } finally {
    await db.pool.end();
  }
})();
