// Purpose: Backend setup for server services.

const config = require('./config');
const app = require('./app');
const db = require('./db');
const backgroundWorker = require('./services/background-worker');

const server = app.listen(config.port, () => {
  console.log(`CSRS running on http://localhost:${config.port}`);
  backgroundWorker.start();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`CSRS received ${signal}; shutting down.`);
  backgroundWorker.stop();
  server.close(async () => {
    await db.pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use.`);
  } else {
    console.error('Failed to start CSRS:', err.message);
  }

  process.exitCode = 1;
});
