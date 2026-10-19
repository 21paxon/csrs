
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
      connectSrc: ["'self'", ...config.frontendOrigins, "https://csrs-backend.onrender.com"],
      fontSrc: ["'self'", "data:"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"]
    }
  }
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.frontendOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(
      new Error('Origin is not allowed by CSRS CORS policy')
    );
  }
}));

app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'CSRS'
  });
});

// Authentication and user routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// Admin user management and registration approval
app.use('/api/admin', require('./routes/admin'));

// Reference data
app.use('/api', require('./routes/reference'));

// Incident management
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

// Serve the landing page
app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, '..', '..', 'frontend', 'home.html')
  );
});

// Serve frontend files
app.use(express.static(
  path.join(__dirname, '..', '..', 'frontend')
));

// API 404 handler
app.use('/api', notFound);

// Global error handler
app.use(errorHandler);

module.exports = app;
