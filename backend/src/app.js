
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.frontendOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin is not allowed by CSRS CORS policy'));
  }
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', system: 'CSRS' })
);

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api', require('./routes/reference'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/emergency', require('./routes/emergency'));
app.use('/api/lost-found', require('./routes/lostfound'));
app.use('/api/gate', require('./routes/gate'));
app.use('/api/patrol', require('./routes/patrol'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit-logs', require('./routes/audit'));

// Serve the landing page at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'home.html'));
});

// Serve other public files
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
