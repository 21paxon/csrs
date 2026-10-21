// Purpose: Developer or deployment utility for migrate db tasks.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const migrationDirectory = path.join(__dirname, '..', 'db', 'migrations');

(async () => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    // Only one backend instance may apply migrations at a time.
    await client.query('SELECT pg_advisory_xact_lock($1)', [726384291]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = fs.readdirSync(migrationDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = path.basename(file, '.sql');
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [version]
      );

      if (applied.rowCount > 0) {
        console.log(`Skipping ${file} (already applied).`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
      await client.query(sql);
      console.log(`Applied ${file}.`);
    }

    await client.query('COMMIT');
    console.log('Neon database migration completed.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Neon database migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
})();
