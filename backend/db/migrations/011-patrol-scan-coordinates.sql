-- Purpose: Store optional GPS coordinates captured at patrol checkpoints.
ALTER TABLE patrol_logs
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

INSERT INTO schema_migrations (version)
VALUES ('011-patrol-scan-coordinates')
ON CONFLICT (version) DO NOTHING;
