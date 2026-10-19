require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const backupFolder = process.argv[2] && path.resolve(process.argv[2]);
const databaseUrl = process.env.DATABASE_URL;
if (!backupFolder || !databaseUrl) {
  throw new Error('Usage: RESTORE_CONFIRM=I_UNDERSTAND_THIS_REPLACES_DATABASE npm run db:restore -- <backup-folder>');
}
if (process.env.RESTORE_CONFIRM !== 'I_UNDERSTAND_THIS_REPLACES_DATABASE') {
  throw new Error('Restore stopped. Set RESTORE_CONFIRM=I_UNDERSTAND_THIS_REPLACES_DATABASE after checking the target database.');
}
const evidenceSource = path.join(backupFolder, 'evidence');
const evidenceTarget = path.join(__dirname, '..', 'uploads');

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with status ${code}`)));
  });
}

(async () => {
  const dump = path.join(backupFolder, 'database.dump');
  await fs.access(dump);
  let evidenceNames = [];
  try {
    evidenceNames = (await fs.readdir(evidenceSource)).filter((name) => name !== '.gitkeep');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(evidenceTarget, { recursive: true });
  const existingEvidence = (await fs.readdir(evidenceTarget)).filter((name) => name !== '.gitkeep');
  if (evidenceNames.length && existingEvidence.length) {
    throw new Error('Restore stopped before database changes: restore evidence into an empty uploads directory.');
  }
  await run('pg_restore', [
    '--clean', '--if-exists', '--no-owner', dump
  ], { ...process.env, PGDATABASE: databaseUrl });
  for (const name of evidenceNames) {
    await fs.cp(path.join(evidenceSource, name), path.join(evidenceTarget, name), {
      recursive: true, force: false, errorOnExist: true
    });
  }
  process.stdout.write(`Restore completed from ${backupFolder}\n`);
})().catch((err) => {
  console.error(`Restore failed: ${err.message}`);
  process.exitCode = 1;
});
