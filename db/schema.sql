-- =========================================================================
-- Database Name : csrs_db
-- Project       : Campus Security and Reporting System (CSRS)
-- Institution   : Rwanda Polytechnic (RP) Musanze College
-- DBMS          : PostgreSQL
-- Team          : Group Two
-- =========================================================================
-- Usage:
--   1. CREATE DATABASE csrs_db;      (run once, as a superuser)
--   2. \c csrs_db
--   3. \i schema.sql
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. CUSTOM ENUM TYPES
-- -------------------------------------------------------------------------
CREATE TYPE severity_level      AS ENUM ('Critical', 'High', 'Medium', 'Low');
CREATE TYPE incident_status     AS ENUM ('Submitted', 'Verified', 'In Progress', 'Resolved', 'Closed', 'Rejected', 'Duplicate', 'Escalated');
CREATE TYPE alert_status        AS ENUM ('Pending', 'Acknowledged', 'Resolved');
CREATE TYPE item_status         AS ENUM ('Unclaimed', 'Matched', 'Returned');
CREATE TYPE found_item_status   AS ENUM ('Available', 'Claimed');
CREATE TYPE notification_channel AS ENUM ('In-App', 'Email', 'SMS', 'Push');
CREATE TYPE patrol_log_status   AS ENUM ('Checked', 'Missed');


-- -------------------------------------------------------------------------
-- 2. USERS, ROLES & PROFILES (SRS Sections 2.3, 3.1, 3.3.5)
-- -------------------------------------------------------------------------

CREATE TABLE roles (
    role_id     SERIAL PRIMARY KEY,
    role_name   VARCHAR(50) UNIQUE NOT NULL, -- Admin, Head of Security, Security Officer, Student, Staff, Dean of Students
    description TEXT
);

-- Base authentication for all system actors
CREATE TABLE users (
    user_id       SERIAL PRIMARY KEY,
    username      VARCHAR(50)  UNIQUE NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INT NOT NULL,
    phone         VARCHAR(20),
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_role FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
);

-- Student & staff details (imported from college records)
CREATE TABLE students_staff (
    record_id           SERIAL PRIMARY KEY,
    user_id             INT NOT NULL,
    registration_number VARCHAR(50) UNIQUE,
    full_name           VARCHAR(100) NOT NULL,
    program             VARCHAR(100), -- e.g., Information Technology
    department          VARCHAR(100),
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


-- -------------------------------------------------------------------------
-- 3. CONFIGURATION DATA (Categories & Locations) (SRS Sections 2.1, 2.2.1, 3.5)
-- -------------------------------------------------------------------------

CREATE TABLE incident_categories (
    category_id   SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL, -- Theft, Assault, Fire, Medical, Vandalism, etc.
    description   TEXT
);

CREATE TABLE locations (
    location_id   SERIAL PRIMARY KEY,
    location_name VARCHAR(100) NOT NULL, -- Library, Block A, Main Gate, etc.
    building      VARCHAR(50),
    description   TEXT,
    coordinates   VARCHAR(100)           -- GPS latitude/longitude mapping
);


-- -------------------------------------------------------------------------
-- 4. INCIDENT REPORTING & MANAGEMENT (SRS Sections 2.2.1, 2.2.3, 2.2.4)
-- -------------------------------------------------------------------------

-- Supports named and anonymous reporting (reporter_id is NULL when anonymous)
CREATE TABLE incidents (
    incident_id       SERIAL PRIMARY KEY,
    reference_no      VARCHAR(50) UNIQUE NOT NULL, -- e.g., INC-2026-0045
    category_id       INT NOT NULL,
    location_id       INT NOT NULL,
    description       TEXT NOT NULL,
    incident_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    reported_datetime TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reporter_id       INT NULL,                    -- NULL if reported anonymously
    is_anonymous      BOOLEAN DEFAULT FALSE,
    access_code_hash  VARCHAR(255) NULL,                   -- hashed secret code so anonymous reporters can check status (SRS 2.2.4)
    severity          severity_level NOT NULL,
    status            incident_status DEFAULT 'Submitted',
    assigned_to       INT NULL,                    -- Security Officer user_id
    closed_datetime   TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT fk_category         FOREIGN KEY (category_id) REFERENCES incident_categories(category_id),
    CONSTRAINT fk_location         FOREIGN KEY (location_id) REFERENCES locations(location_id),
    CONSTRAINT fk_reporter         FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE SET NULL,
    CONSTRAINT fk_assigned_officer FOREIGN KEY (assigned_to) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Photos, videos, documents attached to incidents
CREATE TABLE evidence (
    evidence_id SERIAL PRIMARY KEY,
    incident_id INT NOT NULL,
    file_path   VARCHAR(255) NOT NULL,
    file_type   VARCHAR(50),             -- image, video, audio, document
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_incident_evidence FOREIGN KEY (incident_id) REFERENCES incidents(incident_id) ON DELETE CASCADE
);

-- Audit trail of status changes and notes
CREATE TABLE incident_updates (
    update_id       SERIAL PRIMARY KEY,
    incident_id     INT NOT NULL,
    updated_by      INT NULL,             -- NULL when the update comes from an anonymous reporter
    previous_status VARCHAR(50),
    new_status      VARCHAR(50),
    notes           TEXT,
    from_reporter   BOOLEAN DEFAULT FALSE,
    is_internal     BOOLEAN DEFAULT FALSE, -- internal notes are hidden from the reporter
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_incident_updates FOREIGN KEY (incident_id) REFERENCES incidents(incident_id) ON DELETE CASCADE,
    CONSTRAINT fk_updated_by       FOREIGN KEY (updated_by)  REFERENCES users(user_id)
);

-- Supervisor assigning cases to officers
CREATE TABLE assignments (
    assignment_id SERIAL PRIMARY KEY,
    incident_id   INT NOT NULL,
    officer_id    INT NOT NULL,
    assigned_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes         TEXT,
    CONSTRAINT fk_incident_assignment FOREIGN KEY (incident_id) REFERENCES incidents(incident_id) ON DELETE CASCADE,
    CONSTRAINT fk_officer_assignment  FOREIGN KEY (officer_id)  REFERENCES users(user_id)
);


-- -------------------------------------------------------------------------
-- 5. EMERGENCY & PANIC ALERTS (SRS Section 2.2.2)
-- -------------------------------------------------------------------------

CREATE TABLE emergency_alerts (
    alert_id        SERIAL PRIMARY KEY,
    user_id         INT NOT NULL,
    latitude        DECIMAL(10, 8),
    longitude       DECIMAL(11, 8),
    status          alert_status DEFAULT 'Pending',
    triggered_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP WITH TIME ZONE NULL,
    resolved_at     TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT fk_alert_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


-- -------------------------------------------------------------------------
-- 6. LOST AND FOUND MODULE (SRS Section 2.2.5)
-- -------------------------------------------------------------------------

CREATE TABLE lost_items (
    item_id       SERIAL PRIMARY KEY,
    user_id       INT NOT NULL,
    item_name     VARCHAR(100) NOT NULL,
    description   TEXT,
    location_lost VARCHAR(100),
    date_lost     DATE,
    photo_path    VARCHAR(255) NULL,
    status        item_status DEFAULT 'Unclaimed',
    matched_found_id INT NULL,           -- set when matched with a found item
    CONSTRAINT fk_lost_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE found_items (
    found_id          SERIAL PRIMARY KEY,
    found_by_user_id  INT NOT NULL,
    item_name         VARCHAR(100) NOT NULL,
    description       TEXT,
    location_found    VARCHAR(100),
    date_found        DATE,
    photo_path        VARCHAR(255) NULL,
    status            found_item_status DEFAULT 'Available',
    collected_by_user_id INT NULL,       -- owner verification on collection
    collected_at      TIMESTAMP WITH TIME ZONE NULL,
    CONSTRAINT fk_found_user FOREIGN KEY (found_by_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_found_collector FOREIGN KEY (collected_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

ALTER TABLE lost_items
    ADD CONSTRAINT fk_lost_match FOREIGN KEY (matched_found_id) REFERENCES found_items(found_id) ON DELETE SET NULL;


-- -------------------------------------------------------------------------
-- 7. VISITOR AND GATE MANAGEMENT (SRS Section 2.2.6)
-- -------------------------------------------------------------------------

CREATE TABLE visitors (
    visitor_id     SERIAL PRIMARY KEY,
    full_name      VARCHAR(100) NOT NULL,
    id_number      VARCHAR(50)  NOT NULL,
    phone          VARCHAR(20)  NOT NULL,
    purpose        TEXT NOT NULL,
    host_user_id   INT NOT NULL,         -- Staff/Lecturer being visited
    is_blacklisted BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_visitor_host FOREIGN KEY (host_user_id) REFERENCES users(user_id)
);

CREATE TABLE gate_logs (
    log_id          SERIAL PRIMARY KEY,
    visitor_id      INT NOT NULL,
    vehicle_number  VARCHAR(50) NULL,
    entry_time      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    exit_time       TIMESTAMP WITH TIME ZONE NULL,
    badge_number    VARCHAR(20),
    gate_officer_id INT NOT NULL,
    CONSTRAINT fk_gate_visitor FOREIGN KEY (visitor_id)      REFERENCES visitors(visitor_id) ON DELETE CASCADE,
    CONSTRAINT fk_gate_officer FOREIGN KEY (gate_officer_id) REFERENCES users(user_id)
);


-- -------------------------------------------------------------------------
-- 8. PATROL MANAGEMENT & ROSTERS (SRS Section 2.2.7)
-- -------------------------------------------------------------------------

CREATE TABLE patrol_routes (
    route_id    SERIAL PRIMARY KEY,
    route_name  VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE TABLE checkpoints (
    checkpoint_id      SERIAL PRIMARY KEY,
    route_id           INT NOT NULL,
    checkpoint_name    VARCHAR(100) NOT NULL,
    qr_code_identifier VARCHAR(100) UNIQUE NOT NULL,
    location_id        INT NOT NULL,
    CONSTRAINT fk_route               FOREIGN KEY (route_id)    REFERENCES patrol_routes(route_id) ON DELETE CASCADE,
    CONSTRAINT fk_checkpoint_location FOREIGN KEY (location_id) REFERENCES locations(location_id)
);

CREATE TABLE patrol_logs (
    log_id        SERIAL PRIMARY KEY,
    checkpoint_id INT NOT NULL,
    officer_id    INT NOT NULL,
    scanned_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status        patrol_log_status DEFAULT 'Checked',
    notes         TEXT,
    CONSTRAINT fk_patrol_checkpoint FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(checkpoint_id) ON DELETE CASCADE,
    CONSTRAINT fk_patrol_officer    FOREIGN KEY (officer_id)    REFERENCES users(user_id)
);

CREATE TABLE duty_rosters (
    roster_id        SERIAL PRIMARY KEY,
    officer_id       INT NOT NULL,
    shift_date       DATE NOT NULL,
    shift_start_time TIME NOT NULL,
    shift_end_time   TIME NOT NULL,
    shift_type       VARCHAR(50),         -- Morning, Afternoon, Night
    CONSTRAINT fk_roster_officer FOREIGN KEY (officer_id) REFERENCES users(user_id) ON DELETE CASCADE
);


-- -------------------------------------------------------------------------
-- 9. SYSTEM LOGS & NOTIFICATIONS (SRS Sections 2.2.8, 3.5)
-- -------------------------------------------------------------------------

CREATE TABLE notifications (
    notification_id SERIAL PRIMARY KEY,
    user_id         INT NOT NULL,
    title           VARCHAR(100) NOT NULL,
    message         TEXT NOT NULL,
    channel         notification_channel DEFAULT 'In-App',
    is_read         BOOLEAN DEFAULT FALSE,
    sent_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE audit_logs (
    audit_id     SERIAL PRIMARY KEY,
    user_id      INT NULL,
    action       VARCHAR(100) NOT NULL,  -- e.g., UPDATE INCIDENT STATUS
    target_table VARCHAR(50),
    record_id    INT,
    ip_address   VARCHAR(45),
    timestamp    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status       VARCHAR(20),            -- Successful, Failed
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);


-- -------------------------------------------------------------------------
-- 9b. SEQUENCES (human-readable reference numbers and badge numbers)
-- -------------------------------------------------------------------------
CREATE SEQUENCE incident_ref_seq START 1;
CREATE SEQUENCE visitor_badge_seq START 1;


-- -------------------------------------------------------------------------
-- 10. INDEXES (dashboards, hotspot analysis, lookups)
-- -------------------------------------------------------------------------
CREATE INDEX idx_incidents_status   ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_category ON incidents(category_id);
CREATE INDEX idx_incidents_location ON incidents(location_id);
CREATE INDEX idx_incidents_reported ON incidents(reported_datetime);
CREATE INDEX idx_alerts_status      ON emergency_alerts(status);
CREATE INDEX idx_gate_logs_entry    ON gate_logs(entry_time);
CREATE INDEX idx_patrol_logs_time   ON patrol_logs(scanned_at);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_audit_logs_time    ON audit_logs(timestamp);


-- -------------------------------------------------------------------------
-- 11. SEED DATA (roles and incident categories from the SRS)
-- -------------------------------------------------------------------------
INSERT INTO roles (role_name, description) VALUES
    ('Admin',             'System Administrator'),
    ('Head of Security',  'Head of Security / Security Supervisor'),
    ('Security Officer',  'Gate and patrol security officer'),
    ('College Management','Principal / Deputy Principal'),
    ('Dean of Students',  'Dean of Students / Discipline Committee'),
    ('Staff',             'Staff / Lecturer'),
    ('Student',           'Student');

INSERT INTO incident_categories (category_name, description) VALUES
    ('Theft',                    'Stolen laptop, phone, or personal belongings'),
    ('Violence / Assault',       'Fighting, threats, bullying'),
    ('Harassment',               'Sexual harassment, intimidation, discrimination'),
    ('Fire / Safety Hazard',     'Fire outbreak, faulty electrical wiring, blocked exits'),
    ('Medical Emergency',        'Accident, sudden illness, injury'),
    ('Vandalism / Property Damage','Damaged equipment, broken windows'),
    ('Suspicious Activity',      'Unknown persons, unauthorized entry'),
    ('Drug / Alcohol Abuse',     'Possession or use of prohibited substances on campus'),
    ('Cyber Incident',           'Account hacking, online harassment involving students or staff'),
    ('Other',                    'Any other security concern');


-- -------------------------------------------------------------------------
-- 12. AUDIT LOG PROTECTION (SRS FR-15: audit records cannot be changed or deleted)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_audit_changes() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_changes();
