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
| Frontend | HTML5 / CSS3 / JavaScript (installable PWA shell)   |

## Getting Started

Requirements: Node.js 18+ and a Neon PostgreSQL database.

```bash
# 1. Install backend dependencies
cd backend
npm install

# 2. Configure Neon and application secrets
cp .env.example .env          # then set DATABASE_URL and JWT_SECRET

# 3. Create tables, then the first admin account
npm run db:init
npm run db:migrate
npm run seed:admin

# 4. Start the server
npm run dev                   # http://localhost:3000
```

> `db:init` must run on an empty Neon database or temporary Neon branch. Use a
> temporary branch for testing instead of running it against production data.

For an existing Neon database, use `npm run db:migrate` instead. Migrations
are stored in [`backend/db/migrations/`](backend/db/migrations/) and are
transactional and tracked in the `schema_migrations` table. They preserve
existing application data.

## Free hosting layout

The project is separated into two deployable parts:

- **Backend:** the [`backend/`](backend/) folder, running `npm start`. It needs
  `DATABASE_URL`, `JWT_SECRET`, and `FRONTEND_ORIGINS`. Deploy this service to
  a Node-compatible host such as Render or Railway.
- **Frontend:** the [`frontend/`](frontend/) folder. It is static HTML, CSS, and
  JavaScript and can be deployed to Netlify, Vercel, or GitHub Pages.

Before deploying the frontend, edit [`frontend/config.js`](frontend/config.js) and
set `apiBaseUrl` to the public backend URL, for example:

```js
window.CSRS_CONFIG = Object.freeze({
  apiBaseUrl: "https://your-csrs-api.example.com"
});
```

Set the backend environment variable to the exact frontend origin:

```env
FRONTEND_ORIGINS=https://your-csrs-frontend.example.com
```

Keep the backend URL out of `DATABASE_URL`; the frontend only needs the API
URL, while the Neon connection string must remain a backend-only secret.
The backend `npm start` command applies pending, tracked database migrations
before starting the server. Redeploy the backend after pulling these changes
and check its startup logs if a migration fails.

For local development, leave `apiBaseUrl` empty and start the backend from its
folder:

```bash
cd backend
npm run dev
```

The backend continues to serve [`frontend/`](frontend/) at
`http://localhost:3000`.

## API

Send the token from login as `Authorization: Bearer <token>`. Every state-changing action is written to `audit_log`.
Roles: **Admin, Head of Security (HoS), Security Officer (SO), College Management (CM), Dean of Students, Staff, Student**.

| Module | Endpoint | Who |
|--------|----------|-----|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | public / any user |
| Users | `GET/POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-password`, `POST /api/users/import` (college records) | Admin |
| Backups | `GET /api/admin/backups/status` | Admin |
| | `GET /api/users/officers`, `GET /api/users/hosts?q=` | Admin, HoS (, SO for hosts) |
| Reference | `GET /api/categories`, `GET /api/locations` | public |
| | `POST /api/categories`, `POST/PUT /api/locations` | Admin, HoS |
| | `GET /api/emergency-contacts`, `POST/DELETE /api/emergency-contacts` | public / Admin |
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
| Patrol | `GET /api/patrol/current`, `POST /api/patrol/scan` | SO (active assigned route; next checkpoint order enforced) |
| | `GET /api/patrol/logs`, `GET /api/patrol/rosters`, `GET /api/patrol/routes` | SO (own), HoS, Admin |
| | `GET /api/patrol/checkpoints/:id/qr`, `PATCH /api/patrol/routes/:id/checkpoints/order`, `POST /api/patrol/routes`, `.../routes/:id/checkpoints`, `POST/DELETE /api/patrol/rosters`, `GET /api/patrol/performance` | Admin, HoS |
| Notifications | `GET /api/notifications`, `PATCH /:id/read`, `POST /read-all` | any user |
| | `POST /api/notifications/announcements` | Admin, HoS |
| Dashboard | `GET /api/dashboard?days=30` (totals, hotspots, trends, pending alerts, visitors on campus) | Admin, HoS, CM, Dean |
| Reports | `GET /api/reports/:type?from=&to=&format=json|csv|xlsx|pdf` (incident, summary, response-time, emergency, lost-found, gate, patrol, officer-performance, disciplinary, audit) | Admin, HoS, CM, Dean (audit restricted) |
| Audit | `GET /api/audit-logs` | Admin, HoS |

### Background notifications and patrol checks

Run `npm run db:migrate` to install the numbered migrations before starting this version. The worker starts with the API process, retries configured provider deliveries with exponential back-off, repeats unacknowledged emergency alerts every minute, and creates one missed-checkpoint notification for each completed roster/checkpoint pair. Missed checkpoints are evaluated when the rostered shift ends because the current roster model has no per-checkpoint timing window.

In development, email and SMS deliveries use the console fake. In production, configure `EMAIL_API_URL` / `EMAIL_API_KEY` and `SMS_API_URL` / `SMS_API_KEY` as needed. Browser push can be delivered directly by the backend when `VAPID_PUBLIC_KEY` and its matching `VAPID_PRIVATE_KEY` are set; `VAPID_SUBJECT` should identify the college with a `mailto:` address or URL. Alternatively, configure `PUSH_API_URL` / `PUSH_API_KEY` for a gateway accepting JSON with `channel`, `to`, `title`, `message`, `type`, `link`, and browser subscription keys. The public and private VAPID keys must be a matching pair. Delivery state is visible at `GET /api/notifications/delivery-status` to Admin and Head of Security. Signed-in users can enable or disable browser push from the dashboard controls and register/remove subscriptions at `POST`/`DELETE /api/notifications/push-subscriptions`.

### Patrol route workflow

An Admin or Head of Security creates a route, adds checkpoints in walking order, and assigns the route to an officer for a dated shift. Campus locations need latitude and longitude for the route map preview. Each checkpoint has a unique code; use **Print QR label** in the route preview to print a sticker for that checkpoint. Checkpoint order can be adjusted with the route list controls.

During an active assigned shift, the officer sees the route and completion progress. They can scan a printed QR with a supported phone browser or enter its code manually. The API accepts only the next checkpoint on that officer's active route and attaches optional device coordinates to the scan. Camera scanning requires HTTPS (or localhost) and browser support for `BarcodeDetector`; manual code entry remains available as a fallback. The route preview connects checkpoint coordinates in sequence with straight lines; it does not provide turn-by-turn walking directions or continuously track the officer.

The migration `011-patrol-scan-coordinates.sql` adds optional GPS fields for checkpoint scans. The normal `npm start` command applies pending migrations before the API starts.

Generate a VAPID pair once with `cd backend && npm run push:keys`, then set both printed keys and `VAPID_SUBJECT` in the backend host's environment settings. Keep the private key secret and use the same pair in production; changing keys later requires users to renew their browser subscriptions.

For local offline-shell development, the service worker registers on the home and signed-in dashboard pages. It caches app files only; incident and account data are never stored for offline use. Production service-worker installation requires HTTPS.

The language switcher currently translates the main report, report-tracking, and emergency labels and guidance. The Kinyarwanda wording is an initial draft and should be approved by a fluent college reviewer before production use; untranslated content remains in English.

### Database and evidence backups

Install PostgreSQL client tools (`pg_dump`, `pg_restore`) on the backend host. Run `npm run db:backup` daily from `backend/`, or schedule it with the host's cron/Task Scheduler. Backups contain a custom-format database dump, the private `uploads/` evidence directory, and a manifest; they are written to `CSRS_BACKUP_DIR` or `backend/backups/` and pruned after `BACKUP_RETENTION_DAYS` (default 30). Keep the backup directory on encrypted storage with access limited to administrators.

Restore only to the intended database after verifying `DATABASE_URL` and placing the backup's evidence into an empty uploads directory. The restore command requires the explicit `RESTORE_CONFIRM=I_UNDERSTAND_THIS_REPLACES_DATABASE` environment value because `pg_restore --clean` replaces database objects:

```bash
RESTORE_CONFIRM=I_UNDERSTAND_THIS_REPLACES_DATABASE npm run db:restore -- /secure/backups/csrs-YYYY-MM-DDTHH-MM-SS-sssZ
```

On PowerShell, set `$env:RESTORE_CONFIRM` to the same value before running the command. A restore drill against a disposable database has not yet been run; verify the recovered database and evidence before relying on a backup.

**Who sees which incidents:** Admin, HoS, CM and Dean see all; a Security Officer sees cases assigned to them; everyone else sees only their own reports. Anonymous reports store no reporter, and the access code is stored only as a hash.

## Checking that everything works

With the backend running (`cd backend && npm run dev`), run this in a second
terminal:

```bash
cd backend
npm run smoke
```

It creates test users and walks through every module (about 60 checks) and prints `ok` or `FAIL` for each. If something fails, send that output to the team.

### Remaining implementation and deployment work

- Native Web Push can use VAPID keys; email and SMS delivery use retryable provider adapters. Configure the college's real provider endpoints and VAPID keys before production; development uses a console fake.
- Password reset links use a hashed, one-hour token and invalidate existing sessions. The development email fake prints reset links to the backend console; production needs `EMAIL_API_URL` and `PUBLIC_APP_URL` configured.
- The PWA caches its app shell only. Offline incident submission and background data sync are intentionally not enabled.
- The language switcher translates the main reporting and emergency flows; other screens still contain English text. Kinyarwanda strings need fluent review.
- The original SRS document, a real PostgreSQL migration/restore run, cross-browser acceptance, accessibility review, performance/load results and security test results remain outstanding.
- Optional TOTP MFA, Admin system settings, and `.xlsx`/`.csv` user import are implemented. Apply database migrations with `npm run db:migrate` before use. Configure and preserve `MFA_ENCRYPTION_KEY` before enabling MFA; changing it makes existing authenticator secrets unreadable.
- `npm install` reported two moderate dependency advisories after adding the spreadsheet and PDF export packages; review them before production deployment.

## Project Structure

```
.
├── backend/
│   ├── db/schema.sql      # Neon/PostgreSQL schema, indexes, seed data
│   ├── scripts/           # init-db.js, seed-admin.js, smoke-test.js
│   ├── src/
│   ├── package.json
│   └── .env.example
├── frontend/              # Static HTML, CSS, JavaScript, and images
│   ├── config.js
│   ├── index.html
│   └── ...
└── README.md
```

Login accepts a username, email address, or college registration number.
After five failed password attempts, an active account is locked for 15
minutes. Administrator-issued resets return a temporary password once and set
`must_change_password`; the user is redirected to the password-change page
after signing in.

The public registration form lets applicants submit their own information for
student, staff, security officer, head of security, college management, or dean
accounts. Student accounts require a college registration number and are active
immediately. Staff and privileged-role accounts are created as inactive access
requests and must be approved by an administrator in User Management.
Administrator accounts remain administrator-managed.

To test each role locally:

1. Open `/home.html`, choose **Register**, select a role, and submit the form.
2. For a non-student role, sign in as an administrator and open **User
   Management**. The new account appears as **Pending approval**.
3. Select **Approve account**, then sign out and sign in with the test
   account.
4. The account is routed to its role dashboard. Students can sign in
   immediately after registration; other roles must be approved first.

The backend source layout is:

```
backend/
├── src/
│   ├── server.js, app.js  # entry point and Express setup
│   ├── config.js, db.js   # environment and database connection
│   ├── middleware/        # auth.js (JWT + role guard), error.js
│   ├── routes/            # one file per module
│   └── utils/             # audit, notify, csv, helpers
├── db/schema.sql
├── scripts/
├── uploads/               # evidence files created at runtime
├── package.json
└── .env.example
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
