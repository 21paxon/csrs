
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.set('trust proxy', 1);

// --------------------------------------------------
// CSRS: Security headers
// --------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://*.tile.openstreetmap.org',
        'https://unpkg.com'
      ],
      connectSrc: [
        "'self'",
        ...(config.frontendOrigins || []),
        'https://csrs-backend.onrender.com'
      ],
      fontSrc: ["'self'", 'data:', 'https://unpkg.com'],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:']
    }
  }
}));

// --------------------------------------------------
// CSRS: CORS configuration
// --------------------------------------------------
function normalizeOrigin(origin) {
  if (typeof origin !== 'string') {
    return '';
  }

  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

const configuredOrigins = Array.isArray(config.frontendOrigins)
  ? config.frontendOrigins
  : [];

const allowedOrigins = new Set(
  [
    ...configuredOrigins,
    'https://rp-csrs.vercel.app',
    'https://www.rp-csrs.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

const corsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header can include health checks
    // and server-to-server requests.
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);

    if (allowedOrigins.has(normalizedOrigin)) {
      return callback(null, true);
    }

    console.error(
      `[CSRS CORS] Blocked origin: ${origin}`
    );

    return callback(
      new Error('Origin is not allowed by CSRS CORS policy')
    );
  },

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS'
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization'
  ],

  optionsSuccessStatus: 204,
  credentials: true,
  maxAge: 86400
};

app.use(cors(corsOptions));

// --------------------------------------------------
// Request parsing
// --------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({
  extended: false,
  limit: '1mb'
}));

// --------------------------------------------------
// Health check
// --------------------------------------------------
function health(req, res) {
  res.status(200).json({
    success: true,
    status: 'ok',
    system: 'CSRS',
    timestamp: new Date().toISOString()
  });
}
app.get('/health', health);
app.get('/api/health', health);

// --------------------------------------------------
// Authentication and user management
// --------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// Admin user management and registration approval
app.use('/api/admin', require('./routes/admin'));

// --------------------------------------------------
// Reference data
// --------------------------------------------------
app.use('/api', require('./routes/reference'));

// --------------------------------------------------
// Incident management
// --------------------------------------------------
app.use('/api/incidents', require('./routes/incidents'));

// Emergency management
app.use('/api/emergency', require('./routes/emergency'));

// Lost and found
app.use('/api/lost-found', require('./routes/lostfound'));

// Gate and campus access
app.use('/api/gate', require('./routes/gate'));

// Security patrols
app.use('/api/patrol', require('./routes/patrol'));

// Notifications
app.use('/api/notifications', require('./routes/notifications'));

// Dashboard statistics
app.use('/api/dashboard', require('./routes/dashboard'));

// Reports and audit logs
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit-logs', require('./routes/audit'));

// --------------------------------------------------
// Serve the frontend
// --------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, '..', '..', 'frontend', 'home.html')
  );
});

app.use(express.static(
  path.join(__dirname, '..', '..', 'frontend')
));

// --------------------------------------------------
// API 404 handler
// --------------------------------------------------
app.use('/api', notFound);

// --------------------------------------------------
// Global error handler
// --------------------------------------------------
app.use(errorHandler);

module.exports = app;
