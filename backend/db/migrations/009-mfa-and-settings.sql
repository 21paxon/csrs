-- Purpose: Database migration that updates the schema for 009 mfa and settings features.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value)
VALUES
  ('registration_enabled', 'true'),
  ('support_email', ''),
  ('emergency_phone', '')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO schema_migrations (version)
VALUES ('009-mfa-and-settings')
ON CONFLICT (version) DO NOTHING;
