# CSRS – Campus Security and Reporting System (RP Musanze College)

Node.js + Express API, Neon PostgreSQL, and a dependency-free web frontend (PWA-ready), built from the SRS.

## Run it
1. Create a free project at https://neon.tech and copy the **connection string** (keep `?sslmode=require`).
2. `Copy-Item .env.example .env` and set `DATABASE_URL` and a long random `JWT_SECRET`.
3. `npm install`
4. `npm run migrate`  (creates all tables)
5. `npm run seed`     (categories, locations, demo users, patrol route)
6. `npm start` → http://localhost:3000

Demo logins (password `ChangeMe@123`, change immediately): `admin`, `head_security`, `officer1`, `officer2`, `principal`, `dean`, `lecturer`, `student` (use the username or the email in `scripts/seed.js`).
**Delete or change the demo users before real use.**

## SRS coverage
| SRS | Where |
|---|---|
| FR-01 login, lockout after 5 fails (15 min) | `routes/auth.js` |
| FR-02 RBAC (7 roles) | `lib/auth.js`, per-route `requireRole` |
| FR-03 incident + evidence + anonymous (ref no + secret code, hashed) | `routes/incidents.js` |
| FR-04/05 classify, assign, status flow, notes, closure approval, escalation, discipline referral | `routes/incidents.js` |
| FR-06 panic alert, SSE push, SMS stub, re-alert every 30 s until acknowledged | `routes/alerts.js`, `lib/notify.js` |
| FR-07 notifications + announcements | `lib/notify.js`, `routes/misc.js` |
| FR-08 lost & found, match, collection | `routes/lostfound.js` |
| FR-09 visitors, gate log, blacklist | `routes/gate.js` |
| FR-10 rosters, routes, QR check-in, missed-checkpoint alerts | `routes/patrol.js` |
| FR-11 search/filter | `GET /api/incidents` |
| FR-12 dashboard, hotspots, map | `GET /api/dashboard` |
| FR-13 reports (CSV, opens in Excel) | `GET /api/reports/:type` |
| FR-14 users, bulk import, reset | `routes/admin.js` |
| FR-15 append-only audit log (DB trigger blocks UPDATE/DELETE) | `schema.sql`, `lib/audit.js` |

## Not done yet (honest list)
- PDF export (CSV only), push notifications to closed PWA (needs VAPID keys + service worker), real SMS gateway (stub logs to console; set `SMS_API_URL`), MFA, scheduled DB backups (use Neon's point-in-time restore), automated tests, Kinyarwanda is only partly translated (nav/buttons) and needs a native-speaker review.
- Evidence is stored on local disk (`uploads/`). On hosts with ephemeral disks (Render/Railway free tiers) move it to object storage (e.g. S3/Cloudinary).
- Run behind HTTPS in production (the host usually does this).
