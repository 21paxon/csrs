require('dotenv').config();
const express = require('express');
require('express-async-errors'); // async route errors -> error handler
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { pool } = require('./db');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/items', require('./routes/lostfound'));
app.use('/api/gate', require('./routes/gate'));
app.use('/api/patrol', require('./routes/patrol'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/misc'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Friendly errors: never leak stack traces or "Error 500" to users.
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `A file is too large (max ${process.env.MAX_UPLOAD_MB || 20} MB).` });
  if (err.name === 'MulterError' || /file type is not allowed/.test(err.message)) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request data.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Your data was not lost; please try again.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CSRS running on http://localhost:${port}`));
