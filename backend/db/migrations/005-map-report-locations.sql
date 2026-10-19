ALTER TABLE incidents ALTER COLUMN location_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_reference ON incidents(reference_no);
CREATE INDEX IF NOT EXISTS idx_incident_assignments_officer ON incident_assignments(officer_id, incident_id);
CREATE INDEX IF NOT EXISTS idx_incidents_severity_status_date ON incidents(severity, status, reported_datetime);

INSERT INTO schema_migrations (version)
VALUES ('005-map-report-locations')
ON CONFLICT (version) DO NOTHING;
