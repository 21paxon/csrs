ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';

-- Before this field existed, every inactive account was treated as pending.
UPDATE users
   SET approval_status = CASE WHEN is_active THEN 'approved' ELSE 'pending' END;

ALTER TABLE users
  ADD CONSTRAINT users_approval_status_check
  CHECK (approval_status IN ('pending', 'approved'));

INSERT INTO schema_migrations (version)
VALUES ('010-user-approval-status')
ON CONFLICT (version) DO NOTHING;
