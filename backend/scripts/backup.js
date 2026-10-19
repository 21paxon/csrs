require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const backupRoot = path.resolve(process.env.CSRS_BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const evidenceRoot = path.join(__dirname, '..', 'uploads');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupRoot, `csrs-${stamp}`);

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
  await fs.mkdir(backupRoot, { recursive: true });
  await fs.mkdir(destination, { recursive: false });
  try {
    await run('pg_dump', ['--format=custom', '--no-owner', '--file', path.join(destination, 'database.dump')], {
      ...process.env,
      PGDATABASE: databaseUrl
    });
    let evidenceFiles = 0;
    try {
      await fs.cp(evidenceRoot, path.join(destination, 'evidence'), { recursive: true });
      evidenceFiles = (await fs.readdir(evidenceRoot)).length;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({
      created_at: new Date().toISOString(),
      database_file: 'database.dump',
      evidence_directory: 'evidence',
      evidence_entry_count: evidenceFiles
    }, null, 2));
    await pruneOldBackups();
    process.stdout.write(`Backup completed: ${destination}\n`);
  } catch (err) {
    await fs.rm(destination, { recursive: true, force: true });
    throw err;
  }
})().catch((err) => {
  console.error(`Backup failed: ${err.message}`);
  process.exitCode = 1;
});
