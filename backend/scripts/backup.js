// Purpose: Developer or deployment utility for backup tasks.
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const backupRoot = path.resolve(process.env.CSRS_BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const evidenceRoot = path.join(__dirname, '..', 'uploads');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupRoot, `csrs-${stamp}`);
const pool = new Pool({ connectionString: databaseUrl });

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with status ${code}`)));
  });
}

async function pruneOldBackups() {
  const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 30);
  const cutoff = Date.now() - retentionDays * 86400000;
  for (const entry of await fs.readdir(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('csrs-')) continue;
    const fullPath = path.join(backupRoot, entry.name);
    const stat = await fs.stat(fullPath);
    if (stat.mtimeMs < cutoff) await fs.rm(fullPath, { recursive: true, force: true });
  }
}

(async () => {
  let runId;
  await fs.mkdir(backupRoot, { recursive: true });
  await fs.mkdir(destination, { recursive: false });
  try {
    const backupRecord = await pool.query(
      `INSERT INTO backup_runs (status, backup_name) VALUES ('running', $1) RETURNING id`,
      [path.basename(destination)]
    );
    runId = backupRecord.rows[0].id;
    await run('pg_dump', ['--format=custom', '--no-owner', '--file', path.join(destination, 'database.dump')], {
      ...process.env,
      PGDATABASE: databaseUrl
    });
    let evidenceFiles = 0;
    try {
      const entries = (await fs.readdir(evidenceRoot, { withFileTypes: true }))
        .filter((entry) => entry.name !== '.gitkeep');
      await fs.mkdir(path.join(destination, 'evidence'), { recursive: true });
      for (const entry of entries) {
        await fs.cp(path.join(evidenceRoot, entry.name), path.join(destination, 'evidence', entry.name), {
          recursive: true, errorOnExist: true
        });
      }
      evidenceFiles = entries.length;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({
      created_at: new Date().toISOString(),
      database_file: 'database.dump',
      evidence_directory: 'evidence',
      evidence_entry_count: evidenceFiles
    }, null, 2));
    await pool.query(
      `UPDATE backup_runs SET status = 'complete', finished_at = CURRENT_TIMESTAMP,
                              evidence_entry_count = $2 WHERE id = $1`,
      [runId, evidenceFiles]
    );
    await pruneOldBackups();
    process.stdout.write(`Backup completed: ${destination}\n`);
  } catch (err) {
    await fs.rm(destination, { recursive: true, force: true });
    if (runId) {
      await pool.query(
        `UPDATE backup_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
                                error_message = $2 WHERE id = $1`,
        [runId, String(err.message).slice(0, 1000)]
      ).catch(() => {});
    }
    throw err;
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(`Backup failed: ${err.message}`);
  process.exitCode = 1;
});
