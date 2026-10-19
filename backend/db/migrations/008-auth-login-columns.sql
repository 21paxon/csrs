-- Ensure login-required fields exist on databases created before the current
-- schema or partially migrated during earlier deployments.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_locked_until
  ON users (locked_until)
  WHERE locked_until IS NOT NULL;

INSERT INTO schema_migrations (version)
VALUES ('008-auth-login-columns')
ON CONFLICT (version) DO NOTHING;
