
const config = require('./config');
const app = require('./app');

const server = app.listen(config.port, () => {
  console.log(`CSRS running on http://localhost:${config.port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use.`);
  } else {
    console.error('Failed to start CSRS:', err.message);
  }

  process.exitCode = 1;
});
