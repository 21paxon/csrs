# CSRS Functional Requirements Traceability Matrix

This matrix maps the supplied CSRS SRS functional requirements FR-01 through
FR-15 and the main non-functional requirements to the current implementation.
Status reflects the code currently in the repository, not only the intended
design.

## Status definitions

- **Implemented**: the requirement is represented by working backend and/or
  frontend behavior.
- **Partial**: important parts exist, but one or more stated behaviors are
  missing, incomplete, or not consistently wired.
- **Missing**: no implementation was found for the stated behavior.
- **Blocked**: the intended behavior exists in code or schema, but a known
  integration problem prevents reliable operation.

## Matrix

| Requirement | Status | Evidence in the project | Current gap / verification note |
|---|---|---|---|
| **FR-01 User Authentication** | **Partial** | Login and registration are implemented in [`backend/src/routes/auth.js`](../backend/src/routes/auth.js), with bcrypt password hashing, JWT sessions, username/email/registration-number login, IP rate limiting, and a five-failure/15-minute account lockout. The frontend is [`frontend/index.html`](../frontend/index.html), [`frontend/login.js`](../frontend/login.js), and [`frontend/change-password.html`](../frontend/change-password.html). | Self-service email/SMS password recovery and optional MFA are not implemented. |
| **FR-02 Role-Based Access Control** | **Partial** | JWT authentication and `requireRole()` are centralized in [`backend/src/middleware/auth.js`](../backend/src/middleware/auth.js). Route guards are applied throughout [`backend/src/routes/`](../backend/src/routes/). | The role model is present and [`backend/db/schema.sql`](../backend/db/schema.sql) now matches the `users.id`/role contract used by the routes. The SRS permission matrix should still be tested role by role. |
| **FR-03 Incident Reporting** | **Implemented** | Public/optional-auth submission, category/location selection, date/time, severity, anonymous reports, evidence uploads, reference numbers, and anonymous access codes are implemented in [`backend/src/routes/incidents.js`](../backend/src/routes/incidents.js) and [`frontend/incidents.html`](../frontend/incidents.html). | A disposable database initialization test should verify the complete submission flow. |
| **FR-04 Incident Assignment and Tracking** | **Partial** | Incident listing, role-scoped visibility, status updates, and assignment notifications are implemented in [`backend/src/routes/incidents.js`](../backend/src/routes/incidents.js). Assignment is exposed through `POST /api/incidents/:id/assign`. | Assignment currently targets one officer at a time. No explicit priority field, overdue calculation, escalation timer, or overdue monitoring was found. |
| **FR-05 Incident Processing and Closure** | **Partial** | Assigned officers can update incidents, add notes, and upload evidence. Incident history is stored through incident update records in [`backend/db/schema.sql`](../backend/db/schema.sql) and handled in [`backend/src/routes/incidents.js`](../backend/src/routes/incidents.js). | A distinct “request closure” workflow and required resolution summary were not found. |
| **FR-06 Emergency Alert** | **Partial** | Authenticated users can submit alerts with optional browser geolocation in [`src/routes/emergency.js`](../backend/src/routes/emergency.js), [`public/emergency.js`](../frontend/emergency.js), and [`public/student-dashboard.js`](../frontend/student-dashboard.js). Security roles can acknowledge, mark arrived, and resolve alerts. | No repeat-until-acknowledged mechanism or background delivery/retry worker was found. “Immediately” and the Section 3.8 response target require timing tests and an operational notification channel. |
| **FR-07 Notifications** | **Partial** | In-app notifications, read/read-all actions, assignment notifications, and role-targeted announcements are implemented in [`src/routes/notifications.js`](../backend/src/routes/notifications.js) and [`src/utils/notify.js`](../backend/src/utils/notify.js). | Email, SMS, and push delivery are not implemented. Critical/escalated incident notification rules should be verified for management recipients and status-change coverage. |
| **FR-08 Lost and Found** | **Partial** | Lost/found submission, photos, officer registration, matching, collection, and owner selection are implemented in [`src/routes/lostfound.js`](../backend/src/routes/lostfound.js) and [`public/lost-found.html`](../frontend/lost-found.html). | Search/filter support is limited compared with the SRS wording; a complete search by description, category, and date should be verified. Formal owner verification evidence/workflow is not clearly separated from collection. |
| **FR-09 Visitor and Gate Management** | **Partial** | Visitor check-in/out, host lookup, gate logs, on-campus visitors, and blacklist controls are implemented in [`src/routes/gate.js`](../backend/src/routes/gate.js) and [`public/gate.html`](../frontend/gate.html). | Host notification behavior was not found in the current implementation. Gate functionality is role-restricted and now has a matching initialization schema. |
| **FR-10 Patrol Management** | **Partial** | Patrol routes, checkpoints, scans, duty rosters, logs, and performance endpoints are implemented in [`src/routes/patrol.js`](../backend/src/routes/patrol.js) and represented in [`db/schema.sql`](../backend/db/schema.sql). | No missed-checkpoint detection, alert generation, or scheduled patrol monitoring was found. |
| **FR-11 Search and Filtering** | **Partial** | Incident filtering by status, severity, category, location, and date range is supported by [`src/routes/incidents.js`](../backend/src/routes/incidents.js). Reports also accept several filters in [`src/routes/reports.js`](../backend/src/routes/reports.js). | Reference-number and assigned-officer filtering should be verified or added to the incident list endpoint. Search behavior is not consistently exposed in the frontend. |
| **FR-12 Dashboard and Hotspot Analysis** | **Partial** | Dashboard totals, severity/status/category breakdowns, daily trends, emergency counts, visitor counts, and hotspot queries are implemented in [`src/routes/dashboard.js`](../backend/src/routes/dashboard.js) and [`public/dashboard.js`](../frontend/dashboard.js). | No campus map visualization was found. Hotspots are displayed as tabular data rather than map-based analysis, and “real-time” refresh is manual rather than push/live. |
| **FR-13 Report Generation** | **Partial** | Incident, lost/found, gate, patrol, and audit report endpoints are implemented in [`src/routes/reports.js`](../backend/src/routes/reports.js), including CSV output. | PDF and Excel export are not implemented. Officer/location and all requested filter combinations need endpoint-level verification. |
| **FR-14 User Management** | **Partial** | Admins can create, deactivate/reactivate, change roles, bulk-import users, and issue a temporary password requiring first-login change in [`backend/src/routes/users.js`](../backend/src/routes/users.js). | Temporary-password delivery is not integrated with email/SMS and there is no dedicated administrator UI yet. |
| **FR-15 Audit Logging** | **Partial** | Login, user changes, reports, assignments, announcements, and other actions call [`src/utils/audit.js`](../backend/src/utils/audit.js). [`db/schema.sql`](../backend/db/schema.sql) now creates the same immutable `audit_log` table used by the application. | Audit failures are caught and logged instead of failing the operation. Coverage should be expanded to every security-sensitive action and verified with integration tests. |

## Non-functional and supporting requirements

| Requirement area | Status | Already present | Gap / next verification |
|---|---|---|---|
| Reliability and recovery | **Partial** | PostgreSQL transactions are used for important operations; submitted reports and alerts are stored independently of in-app notification delivery. | No scheduled database/evidence backup, retention policy, restore procedure, or restoration test is included in the project. Notification retry handling also needs to be added and tested. |
| Availability | **Not verified** | The application can run as a Node.js service with Neon PostgreSQL. | The SRS target is 99% monthly availability. Hosting monitoring, health checks, planned-maintenance handling, and an availability measurement process are not configured in the repository. |
| Security and privacy | **Partial** | bcrypt password hashing, JWT authentication, role guards, Helmet, CORS, IP rate limiting, account lockout, administrator-issued password reset with forced change, parameterized queries, anonymous access-code hashing, and audit logging are present. | Self-service recovery, optional MFA for privileged users, evidence/report confidentiality controls, secure backups, HTTPS deployment enforcement, and privacy/retention procedures remain incomplete or unverified. |
| Scalability | **Not verified** | Database indexes and a separately deployable backend/frontend are present. | The target of at least 500 concurrent users has not been load-tested. Attachment storage, connection-pool sizing, and multi-campus scalability have not been validated. |
| Browser and mobile compatibility | **Partial** | Responsive HTML/CSS pages are available without a native app. | Cross-browser/mobile acceptance testing and PWA installation behavior are not complete. |
| Email, SMS, and web push | **Missing** | In-app notifications are stored; notification records include a channel field. | SMTP/email, SMS gateway delivery, web push subscriptions, delivery retries, and delivery-status monitoring are not implemented. |
| Maps and location | **Partial** | Browser geolocation can be captured for emergency alerts. | A map service, incident/alert map display, hotspot visualization, and location permission/error UX are not implemented. |
| User interface and accessibility | **Partial** | Institutional styling, responsive layouts, confirmation/status messages, role-specific dashboard navigation, and consistent logos are present. | Kinyarwanda translation, accessibility audit, keyboard/screen-reader checks, and complete emergency/report access from every main screen remain outstanding. |
| Database and data protection | **Partial** | Neon PostgreSQL schema, constraints, indexes, migrations, and parameterized queries are present. | Encryption-at-rest choices, evidence protection, backup retention, incident retention policy, and recovery testing must be documented and verified. |
| Documentation and training | **Partial** | README, API overview, deployment instructions, schema documentation, and this traceability matrix exist. | A student/staff user manual, administrator manual, technical operations/runbook, and role-specific training materials are not yet present. |
| Testing and acceptance | **Partial** | JavaScript syntax checks, database migration checks, smoke checks, and manual browser verification have been used. | Unit, integration, system, security, load, mobile/accessibility, and user-acceptance tests mapped to TC-01 through TC-15 are not complete. |
| Performance targets | **Not verified** | Some database indexes and upload limits exist. | The SRS targets require measurement for login (3s), submission (5s), emergency delivery (10s), search (3s), reports (10s), 20 MB attachments, 500 concurrent users, and daily backups. |
| Maintainability | **Implemented / partial** | Frontend/backend separation, modular Express routes, migrations, environment configuration, and documented scripts are present. | Operational monitoring, dependency/security update procedures, backup monitoring, support procedures, and configuration-management documentation remain to be established. |

## SRS items intentionally outside application code

The supplied SRS also includes project planning material such as budget,
schedule, training, hosting, domain, SMS, backup, and maintenance costs. These
are project-management or deployment decisions rather than features that can
be safely implemented in the application without institutional choices.

## Cross-cutting blockers

### 1. Database contract alignment

The initialization schema in [`db/schema.sql`](../backend/db/schema.sql) has been
aligned with the application contract used by the routes. It now uses the
same live table names and columns, including `users.id`, `incident_categories.id`,
`locations.name`, `items`, and the immutable `audit_log` table. A disposable
database initialization and smoke test should still be run before deploying
schema changes to another environment.

### 2. SRS acceptance testing

The existing [`scripts/smoke-test.js`](../scripts/smoke-test.js) covers many
happy paths, but a complete acceptance suite should add:

- all seven roles against the FR-02 permission matrix;
- login by username, email, and registration number;
- repeated failed-login lockout;
- emergency repeat/acknowledgement timing;
- missed-patrol detection;
- report export formats;
- audit immutability and failure behavior;
- redirect behavior for protected frontend pages.

## Recommended implementation order

1. Complete authentication hardening: registration-number login and account
   lockout.
2. Complete incident workflow controls: priority, overdue monitoring, closure
   requests, and full search filters.
3. Add emergency retry/repeat behavior and missed-patrol alerts.
4. Add map visualization and PDF/Excel exports.
5. Add administrator password reset and formal owner verification.
6. Expand automated acceptance tests to cover every role and requirement.

### 3. Implementation order recommended from the supplied SRS

1. Complete security-critical workflows: account lockout, password reset,
   privileged-user MFA decision, incident closure approval, and audit coverage.
2. Complete operational response: critical notifications, emergency retry and
   acknowledgement behavior, missed-patrol detection, and visitor host alerts.
3. Add search/report completeness: reference and officer filters, then PDF and
   Excel exports.
4. Add maps, web push, and bilingual UI after the operational workflows are
   stable.
5. Establish backups, restore testing, load testing, accessibility testing,
   acceptance testing, and the user/administrator manuals before deployment.
