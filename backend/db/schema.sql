-- CSRS PostgreSQL schema.
-- This schema matches the application queries in src/ and is safe to run on
-- a newly created, empty database.

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  reg_no TEXT UNIQUE,
  username TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'admin', 'head_security', 'security_officer', 'management',
    'dean', 'staff', 'student'
  )),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  approval_status TEXT NOT NULL DEFAULT 'approved',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  lang TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE incident_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION
);

CREATE TABLE incidents (
  id SERIAL PRIMARY KEY,
  reference_no TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES incident_categories(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  location_text TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  description TEXT NOT NULL,
  incident_datetime TIMESTAMPTZ NOT NULL,
  reported_datetime TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  hide_identity BOOLEAN NOT NULL DEFAULT FALSE,
  access_code_hash TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
  status TEXT NOT NULL DEFAULT 'Submitted',
  due_at TIMESTAMPTZ,
  closed_datetime TIMESTAMPTZ,
  resolution_summary TEXT,
  escalated_to TEXT,
  referred_to_discipline BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE evidence (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE incident_updates (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  old_status TEXT,
  new_status TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE incident_assignments (
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  officer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (incident_id, officer_id)
);

CREATE TABLE emergency_alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Triggered',
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  arrived_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE items (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('lost', 'found')),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  location_text TEXT,
  event_date DATE,
  photo_name TEXT,
  reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  matched_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  collected_by_name TEXT,
  collected_id_no TEXT,
  collected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE visitors (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  id_number TEXT NOT NULL,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  host_user_id INTEGER NOT NULL REFERENCES users(id),
  host_text TEXT,
  badge_no TEXT,
  vehicle_plate TEXT,
  entry_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  exit_at TIMESTAMPTZ,
  registered_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE blacklist (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  id_number TEXT NOT NULL UNIQUE,
  reason TEXT,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE patrol_routes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE checkpoints (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  location_id INTEGER NOT NULL REFERENCES locations(id)
);

CREATE TABLE route_checkpoints (
  route_id INTEGER NOT NULL REFERENCES patrol_routes(id) ON DELETE CASCADE,
  checkpoint_id INTEGER NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  PRIMARY KEY (route_id, checkpoint_id)
);

CREATE TABLE duty_rosters (
  id SERIAL PRIMARY KEY,
  officer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id INTEGER REFERENCES patrol_routes(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  handover_notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE patrol_logs (
  id SERIAL PRIMARY KEY,
  officer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkpoint_id INTEGER NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  roster_id INTEGER REFERENCES duty_rosters(id) ON DELETE SET NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  ip TEXT,
  status TEXT NOT NULL DEFAULT 'Successful',
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE incident_ref_seq START 1;
CREATE SEQUENCE visitor_badge_seq START 1;

CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_category ON incidents(category_id);
CREATE INDEX idx_incidents_location ON incidents(location_id);
CREATE INDEX idx_incidents_reported ON incidents(reported_datetime);
CREATE INDEX idx_incidents_due ON incidents(due_at);
CREATE INDEX idx_alerts_status ON emergency_alerts(status);
CREATE INDEX idx_gate_logs_entry ON visitors(entry_at);
CREATE INDEX idx_patrol_logs_time ON patrol_logs(scanned_at);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_audit_log_time ON audit_log(created_at);

INSERT INTO incident_categories (name, description) VALUES
  ('Theft', 'Stolen laptop, phone, or personal belongings'),
  ('Violence / Assault', 'Fighting, threats, bullying'),
  ('Harassment', 'Sexual harassment, intimidation, discrimination'),
  ('Fire / Safety Hazard', 'Fire outbreak, faulty wiring, blocked exits'),
  ('Medical Emergency', 'Accident, sudden illness, or injury'),
  ('Vandalism / Property Damage', 'Damaged equipment or property'),
  ('Suspicious Activity', 'Unknown persons or unauthorized entry'),
  ('Drug / Alcohol Abuse', 'Possession or use of prohibited substances'),
  ('Cyber Incident', 'Account hacking or online harassment'),
  ('Other', 'Any other security concern');

CREATE OR REPLACE FUNCTION prevent_audit_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_changes();
