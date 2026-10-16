# Campus Security and Reporting System (CSRS)

Database design for the **Campus Security and Reporting System**, a project for **Rwanda Polytechnic (RP) Musanze College** by **Group Two**.

CSRS helps the college manage campus safety in one place: incident reporting (including anonymous reports), emergency panic alerts, lost and found, visitor and gate control, security patrols, and full audit logging.

## Tech Stack

| Layer    | Choice                                              |
|----------|-----------------------------------------------------|
| Backend  | Node.js + Express                                   |
| Database | Neon PostgreSQL                                    |
| Auth     | JWT + bcrypt, role-based access (7 roles)           |
| Security | helmet, rate-limited login, parameterized queries, immutable audit log |
| Frontend | HTML5 / CSS3 / JavaScript (PWA planned)             |

## Getting Started

Requirements: Node.js 18+ and a Neon PostgreSQL database.

```bash
# 1. Install dependencies
npm install

# 2. Configure Neon and application secrets
cp .env.example .env          # then set DATABASE_URL and JWT_SECRET

# 3. Create tables, then the first admin account
npm run db:init
npm run seed:admin

# 4. Start the server
npm run dev                   # http://localhost:3000
```

> `db:init` must run on an empty Neon database or temporary Neon branch. Use a
> temporary branch for testing instead of running it against production data.

## API

Send the token from login as `Authorization: Bearer <token>`. Every state-changing action is written to `audit_log`.
Roles: **Admin, Head of Security (HoS), Security Officer (SO), College Management (CM), Dean of Students, Staff, Student**.

| Module | Endpoint | Who |
|--------|----------|-----|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password` | public / any user |
| Users | `GET/POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/import` (college records) | Admin |
| | `GET /api/users/officers`, `GET /api/users/hosts?q=` | Admin, HoS (, SO for hosts) |
| Reference | `GET /api/categories`, `GET /api/locations` | public |
| | `POST /api/categories`, `POST/PUT /api/locations` | Admin, HoS |
| Incidents | `POST /api/incidents` (multipart `evidence` files; anonymous if not logged in or `is_anonymous=true`) | public / any user |
| | `GET /api/incidents/track/:ref` + header `x-access-code`; `POST .../track/:ref/reply` | anonymous reporter |
| | `GET /api/incidents` (filters: status, severity, category_id, location_id, from, to), `GET /api/incidents/:id` | by role (see below) |
| | `PATCH /api/incidents/:id` (status/notes), `POST /api/incidents/:id/assign` | HoS, Admin, assigned SO / HoS, Admin |
| | `POST /api/incidents/:id/evidence`, `GET /api/incidents/:id/evidence/:evidenceId` | people who can view the incident |
| Emergency | `POST /api/emergency` (panic alert + GPS) | any user |
| | `GET /api/emergency`, `PATCH /api/emergency/:id/acknowledge`, `.../resolve` | Admin, HoS, SO |
| Lost & found | `POST/GET /api/lost-found/lost`, `GET /api/lost-found/found?q=` | any user |
| | `POST /api/lost-found/found`, `/match`, `/found/:id/collect`, `GET /unclaimed` | Admin, HoS, SO |
| Gate | `POST /api/gate/check-in`, `POST /api/gate/:id/check-out`, `GET /api/gate/logs`, `GET /api/gate/on-campus` | Admin, HoS, SO |
| | `PATCH /api/gate/visitors/:id/blacklist` | Admin, HoS |
| Patrol | `POST /api/patrol/scan`, `GET /api/patrol/logs`, `GET /api/patrol/rosters` | SO (own), HoS, Admin |
| | `POST /api/patrol/routes`, `.../routes/:id/checkpoints`, `POST/DELETE /api/patrol/rosters`, `GET /api/patrol/performance` | Admin, HoS |
| Notifications | `GET /api/notifications`, `PATCH /:id/read`, `POST /read-all` | any user |
| | `POST /api/notifications/announcements` | Admin, HoS |
| Dashboard | `GET /api/dashboard?days=30` (totals, hotspots, trends, pending alerts, visitors on campus) | Admin, HoS, CM, Dean |
| Reports | `GET /api/reports/:type?from=&to=&format=csv` (incidents, lost-found, gate, patrol, audit) | Admin, HoS, CM, Dean |
| Audit | `GET /api/audit-logs` | Admin, HoS |

**Who sees which incidents:** Admin, HoS, CM and Dean see all; a Security Officer sees cases assigned to them; everyone else sees only their own reports. Anonymous reports store no reporter, and the access code is stored only as a hash.

## Checking that everything works

With the server running (`npm run dev`), run this in a second terminal:

```bash
npm run smoke
```

It creates test users and walks through every module (about 60 checks) and prints `ok` or `FAIL` for each. If something fails, send that output to the team.

### Not built yet
Push/SMS/email delivery (notifications are stored in-app; the `channel` column is ready), PDF/Excel export (CSV opens in Excel), and the frontend screens.

## Project Structure

```
.
├── db/schema.sql          # Neon/PostgreSQL schema, indexes, seed data
├── scripts/               # init-db.js, seed-admin.js, smoke-test.js
├── src/
│   ├── server.js, app.js  # entry point and Express setup
│   ├── config.js, db.js   # environment and database connection
│   ├── middleware/        # auth.js (JWT + role guard), error.js
│   ├── middleware/upload.js  # evidence/photo uploads (type and size limits)
│   ├── routes/            # one file per module (incidents, emergency, lostfound, gate, patrol, ...)
│   └── utils/             # audit, notify, csv, helpers
├── public/                # login page (index.html, login.js)
├── uploads/               # evidence files (created at runtime, not in git)
├── .env.example
└── README.md
```

## Next steps

Build the frontend (PWA) on top of this API: login, report form with map, officer dashboard, gate screen, patrol QR scanner.

## Database Overview

The schema contains the application tables, foreign keys, indexes, and seed
incident categories used by the current API. It is written for PostgreSQL and
can be initialized safely on a disposable Neon branch before production use.

### 1. Users and Roles (SRS 2.3, 3.1, 3.3.5)
| Table            | Purpose                                                         |
|------------------|-----------------------------------------------------------------|
| `users`          | Login accounts, roles, registration numbers, and lockout state |

### 2. Configuration (SRS 2.1, 2.2.1, 3.5)
| Table                 | Purpose                                        |
|-----------------------|------------------------------------------------|
| `incident_categories` | Theft, Assault, Fire, Medical, Vandalism, etc. |
| `locations`           | Campus places (Library, Block A, Main Gate) with GPS coordinates |

### 3. Incident Management (SRS 2.2.1, 2.2.3, 2.2.4)
| Table              | Purpose                                                       |
|--------------------|---------------------------------------------------------------|
| `incidents`        | Reports with severity and status; `reporter_id` is `NULL` for anonymous reports; `access_code_hash` lets anonymous reporters check status |
| `evidence`         | Photos, videos and documents attached to an incident          |
| `incident_updates` | Audit trail of status changes and notes                       |
| `incident_assignments` | Supervisors assigning cases to security officers          |

### 4. Emergency Alerts (SRS 2.2.2)
| Table              | Purpose                                              |
|--------------------|------------------------------------------------------|
| `emergency_alerts` | Panic alerts with GPS location and response timestamps |

### 5. Lost and Found (SRS 2.2.5)
| Table         | Purpose                         |
|---------------|---------------------------------|
| `items`       | Unified lost and found records, matching, and collection data |

### 6. Visitors and Gate (SRS 2.2.6)
| Table       | Purpose                                                 |
|-------------|---------------------------------------------------------|
| `visitors`  | Visitor details, host, entry/exit, and badge information |
| `blacklist`  | Restricted visitor identity records                     |

### 7. Patrols and Rosters (SRS 2.2.7)
| Table           | Purpose                                         |
|-----------------|-------------------------------------------------|
| `patrol_routes` | Named patrol routes                             |
| `checkpoints`   | QR-coded checkpoints along each route           |
| `patrol_logs`   | Checkpoint scans by officers                  |
| `duty_rosters`  | Officer shifts and assigned routes             |

### 8. System (SRS 2.2.8, 3.5)
| Table           | Purpose                                         |
|-----------------|-------------------------------------------------|
| `notifications` | In-app messages to users                       |
| `audit_log`     | Who did what, on which table, from which IP     |

## Seed Data

`schema.sql` inserts the 10 incident categories listed in the SRS. The first
administrator is created separately with `npm run seed:admin`.

## Key Relationships

- Every account in `users` has a role from the application role constraint.
- `incidents` link to a category, a location, an optional reporter, and an optional assigned officer.
- `evidence`, `incident_updates` and `incident_assignments` belong to an incident and are deleted with it.
- `visitors` are tied to a host user and record each visit.
- `patrol_routes` have many `checkpoints`; each scan is saved in `patrol_logs`.

## Team

**Group Two**, Rwanda Polytechnic, Musanze College


| Name                  | Registration No. |
|-----------------------|------------------|
| Murenzi Elvis         | 26RP01872        |
| Uwizeyimana Claudine  | 26RP00414        |
| Niyogushimwa Pacifique| 26RP00079        |
| Patience Igihozo      | 26RP00886        |
| Gilbert Niyomuremyi   | 26RP00766        |

Source document: *SRS for Group Two – Campus Security and Reporting System* (October 2026).
