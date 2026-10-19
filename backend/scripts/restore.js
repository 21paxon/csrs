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
  await run('pg_restore', [
    '--clean', '--if-exists', '--no-owner', '--dbname', databaseUrl, dump
  ]);
  const backupEvidence = path.join(backupFolder, 'evidence');
  try {
    await fs.cp(backupEvidence, path.join(__dirname, '..', 'uploads'), {
      recursive: true, force: false, errorOnExist: true
    });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`Database restored; evidence restore stopped: ${err.message}. Restore into an empty uploads directory.`);
    }
  }
  process.stdout.write(`Restore completed from ${backupFolder}\n`);
})().catch((err) => {
  console.error(`Restore failed: ${err.message}`);
  process.exitCode = 1;
});
