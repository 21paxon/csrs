-- CSRS schema for PostgreSQL (Neon). Safe to re-run: uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE,
  reg_no          TEXT UNIQUE,           -- registration / staff number
  username        TEXT UNIQUE,
  phone           TEXT,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN
                    ('admin','head_security','security_officer','management','dean','staff','student')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  lang            TEXT NOT NULL DEFAULT 'en',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  id   SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  lat  DOUBLE PRECISION,
  lng  DOUBLE PRECISION
);

CREATE SEQUENCE IF NOT EXISTS incident_ref_seq;

CREATE TABLE IF NOT EXISTS incidents (
  id                 SERIAL PRIMARY KEY,
  reference_no       TEXT UNIQUE NOT NULL,
  category_id        INT REFERENCES incident_categories(id),
  location_id        INT REFERENCES locations(id),
  location_text      TEXT,
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  description        TEXT NOT NULL,
  incident_datetime  TIMESTAMPTZ NOT NULL,
  reported_datetime  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reporter_id        INT REFERENCES users(id),          -- NULL when anonymous
  is_anonymous       BOOLEAN NOT NULL DEFAULT FALSE,
  hide_identity      BOOLEAN NOT NULL DEFAULT FALSE,    -- named reporter asks to be hidden from non-security users
  access_code_hash   TEXT,                              -- anonymous reporters only
  severity           TEXT CHECK (severity IN ('Critical','High','Medium','Low')),
  status             TEXT NOT NULL DEFAULT 'Submitted'
                       CHECK (status IN ('Submitted','Verified','In Progress','Resolved','Closed')),
  due_at             TIMESTAMPTZ,
  closed_datetime    TIMESTAMPTZ,
  resolution_summary TEXT,
  escalated_to       TEXT,
  referred_to_discipline BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incidents_when     ON incidents(incident_datetime);

CREATE TABLE IF NOT EXISTS incident_assignments (
  incident_id INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  officer_id  INT NOT NULL REFERENCES users(id),
  assigned_by INT REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, officer_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id            SERIAL PRIMARY KEY,
  incident_id   INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  stored_name   TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INT,
  uploaded_by   INT REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_updates (
  id          SERIAL PRIMARY KEY,
  incident_id INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id),
  note        TEXT,
  old_status  TEXT,
  new_status  TEXT,
  is_public   BOOLEAN NOT NULL DEFAULT FALSE,   -- visible to the reporter
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_alerts (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id),   -- sender is always identified (anti-misuse)
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'Triggered'
                    CHECK (status IN ('Triggered','Acknowledged','Arrived','Resolved')),
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INT REFERENCES users(id),
  arrived_at      TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS items (            -- lost & found
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('lost','found')),
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  location_text TEXT,
  event_date    DATE,
  photo_name    TEXT,
  reported_by   INT REFERENCES users(id),
  contact_phone TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','collected','unclaimed_disposed')),
  matched_item_id INT REFERENCES items(id),
  collected_by_name TEXT,
  collected_id_no   TEXT,
  collected_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visitors (
  id          SERIAL PRIMARY KEY,
  full_name   TEXT NOT NULL,
  id_number   TEXT,
  phone       TEXT,
  purpose     TEXT,
  host_user_id INT REFERENCES users(id),
  host_text   TEXT,
  badge_no    TEXT,
  vehicle_plate TEXT,
  entry_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_at     TIMESTAMPTZ,
  registered_by INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS blacklist (
  id        SERIAL PRIMARY KEY,
  full_name TEXT,
  id_number TEXT UNIQUE,
  reason    TEXT,
  added_by  INT REFERENCES users(id),
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE NOT NULL,            -- value encoded in the printed QR code
  location_id INT REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS patrol_routes (
  id   SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS route_checkpoints (
  route_id      INT NOT NULL REFERENCES patrol_routes(id) ON DELETE CASCADE,
  checkpoint_id INT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  seq           INT NOT NULL,
  PRIMARY KEY (route_id, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS duty_rosters (
  id         SERIAL PRIMARY KEY,
  officer_id INT NOT NULL REFERENCES users(id),
  route_id   INT REFERENCES patrol_routes(id),
  start_at   TIMESTAMPTZ NOT NULL,
  end_at     TIMESTAMPTZ NOT NULL,
  handover_notes TEXT,
  created_by INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS patrol_logs (
  id            SERIAL PRIMARY KEY,
  officer_id    INT NOT NULL REFERENCES users(id),
  checkpoint_id INT NOT NULL REFERENCES checkpoints(id),
  roster_id     INT REFERENCES duty_rosters(id),
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS announcements (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'all',      -- 'all' or a role name
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  type       TEXT,
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT,
  actor      TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  ip         TEXT,
  status     TEXT NOT NULL DEFAULT 'Successful',
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FR-15: audit records cannot be modified or deleted.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_log;
CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
