ALTER TABLE incident_assignments
  ADD COLUMN IF NOT EXISTS unassigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incident_assignments_current
  ON incident_assignments(incident_id, assigned_at DESC)
  WHERE unassigned_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('012-incident-reassignment-history')
ON CONFLICT (version) DO NOTHING;
