-- Security hardening for authentication and administrator-issued resets.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_login_identifiers
  ON users (username, email, reg_no);

CREATE INDEX IF NOT EXISTS idx_users_locked_until
  ON users (locked_until)
  WHERE locked_until IS NOT NULL;

INSERT INTO schema_migrations (version)
VALUES ('002-security-hardening')
ON CONFLICT (version) DO NOTHING;
