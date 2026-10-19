const express = require('express');
const db = require('../db');
const { wrap } = require('../utils/helpers');

const router = express.Router();

router.get('/public', wrap(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT setting_key, setting_value FROM system_settings
      WHERE setting_key IN ('registration_enabled', 'support_email', 'emergency_phone')`
  );
  const settings = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  res.json({
    registration_enabled: settings.registration_enabled !== 'false',
    support_email: settings.support_email || '',
    emergency_phone: settings.emergency_phone || ''
  });
}));

module.exports = router;
