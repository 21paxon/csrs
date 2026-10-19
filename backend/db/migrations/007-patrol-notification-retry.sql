ALTER TABLE patrol_missed_alerts
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version)
VALUES ('007-patrol-notification-retry')
ON CONFLICT (version) DO NOTHING;
