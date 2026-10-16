const config = require('./config');
const app = require('./app');

app.listen(config.port, () => {
  console.log(`CSRS running on http://localhost:${config.port}`);
});
