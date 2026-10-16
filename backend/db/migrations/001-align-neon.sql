-- CSRS Neon alignment migration 001.
-- Safe to run repeatedly; all changes are conditional or idempotent.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
  ALTER COLUMN email SET NOT NULL;

ALTER TABLE incidents
  ALTER COLUMN category_id SET NOT NULL,
  ALTER COLUMN location_id SET NOT NULL;

ALTER TABLE emergency_alerts
  ALTER COLUMN message SET NOT NULL;

ALTER TABLE evidence
  ALTER COLUMN mime_type SET NOT NULL,
  ALTER COLUMN size_bytes SET NOT NULL;

ALTER TABLE items
  ALTER COLUMN reported_by SET NOT NULL;

ALTER TABLE visitors
  ALTER COLUMN id_number SET NOT NULL,
  ALTER COLUMN phone SET NOT NULL,
  ALTER COLUMN purpose SET NOT NULL,
  ALTER COLUMN host_user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category_id);
CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents(location_id);
CREATE INDEX IF NOT EXISTS idx_incidents_reported ON incidents(reported_datetime);
CREATE INDEX IF NOT EXISTS idx_incidents_due ON incidents(due_at);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON emergency_alerts(status);
CREATE INDEX IF NOT EXISTS idx_gate_logs_entry ON visitors(entry_at);
CREATE INDEX IF NOT EXISTS idx_patrol_logs_time ON patrol_logs(scanned_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at);

INSERT INTO schema_migrations (version)
VALUES ('001-align-neon')
ON CONFLICT (version) DO NOTHING;
