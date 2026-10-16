# CSRS Functional Requirements Traceability Matrix

This matrix maps SRS functional requirements FR-01 through FR-15 to the
current implementation. Status reflects the code currently in the repository,
not only the intended design.

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
| **FR-01 User Authentication** | **Partial** | Login and registration are implemented in [`src/routes/auth.js`](../src/routes/auth.js), with bcrypt password hashing, JWT sessions, and login rate limiting. The frontend is [`public/index.html`](../public/index.html) and [`public/login.js`](../public/login.js). | Login accepts username or email, but not registration number. Rate limiting is IP/request based; there is no temporary per-account lockout after repeated failures. |
| **FR-02 Role-Based Access Control** | **Partial** | JWT authentication and `requireRole()` are centralized in [`src/middleware/auth.js`](../src/middleware/auth.js). Route guards are applied throughout [`src/routes/`](../src/routes/). | The role model is present and [`db/schema.sql`](../db/schema.sql) now matches the `users.id`/role contract used by the routes. The SRS permission matrix should still be tested role by role. |
| **FR-03 Incident Reporting** | **Implemented** | Public/optional-auth submission, category/location selection, date/time, severity, anonymous reports, evidence uploads, reference numbers, and anonymous access codes are implemented in [`src/routes/incidents.js`](../src/routes/incidents.js) and [`public/incidents.html`](../public/incidents.html). | A disposable database initialization test should verify the complete submission flow. |
| **FR-04 Incident Assignment and Tracking** | **Partial** | Incident listing, role-scoped visibility, status updates, and assignment notifications are implemented in [`src/routes/incidents.js`](../src/routes/incidents.js). Assignment is exposed through `POST /api/incidents/:id/assign`. | Assignment currently targets one officer at a time. No explicit priority field, overdue calculation, escalation timer, or overdue monitoring was found. |
| **FR-05 Incident Processing and Closure** | **Partial** | Assigned officers can update incidents, add notes, and upload evidence. Incident history is stored through incident update records in [`db/schema.sql`](../db/schema.sql) and handled in [`src/routes/incidents.js`](../src/routes/incidents.js). | A distinct “request closure” workflow and required resolution summary were not found. |
| **FR-06 Emergency Alert** | **Partial** | Authenticated users can submit alerts with optional browser geolocation in [`src/routes/emergency.js`](../src/routes/emergency.js), [`public/emergency.js`](../public/emergency.js), and [`public/student-dashboard.js`](../public/student-dashboard.js). Security roles can acknowledge, mark arrived, and resolve alerts. | No repeat-until-acknowledged mechanism or background delivery/retry worker was found. “Immediately” and the Section 3.8 response target require timing tests and an operational notification channel. |
| **FR-07 Notifications** | **Partial** | In-app notifications, read/read-all actions, assignment notifications, and role-targeted announcements are implemented in [`src/routes/notifications.js`](../src/routes/notifications.js) and [`src/utils/notify.js`](../src/utils/notify.js). | Email, SMS, and push delivery are not implemented. Critical/escalated incident notification rules should be verified for management recipients and status-change coverage. |
| **FR-08 Lost and Found** | **Partial** | Lost/found submission, photos, officer registration, matching, collection, and owner selection are implemented in [`src/routes/lostfound.js`](../src/routes/lostfound.js) and [`public/lost-found.html`](../public/lost-found.html). | Search/filter support is limited compared with the SRS wording; a complete search by description, category, and date should be verified. Formal owner verification evidence/workflow is not clearly separated from collection. |
| **FR-09 Visitor and Gate Management** | **Partial** | Visitor check-in/out, host lookup, gate logs, on-campus visitors, and blacklist controls are implemented in [`src/routes/gate.js`](../src/routes/gate.js) and [`public/gate.html`](../public/gate.html). | Host notification behavior was not found in the current implementation. Gate functionality is role-restricted and now has a matching initialization schema. |
| **FR-10 Patrol Management** | **Partial** | Patrol routes, checkpoints, scans, duty rosters, logs, and performance endpoints are implemented in [`src/routes/patrol.js`](../src/routes/patrol.js) and represented in [`db/schema.sql`](../db/schema.sql). | No missed-checkpoint detection, alert generation, or scheduled patrol monitoring was found. |
| **FR-11 Search and Filtering** | **Partial** | Incident filtering by status, severity, category, location, and date range is supported by [`src/routes/incidents.js`](../src/routes/incidents.js). Reports also accept several filters in [`src/routes/reports.js`](../src/routes/reports.js). | Reference-number and assigned-officer filtering should be verified or added to the incident list endpoint. Search behavior is not consistently exposed in the frontend. |
| **FR-12 Dashboard and Hotspot Analysis** | **Partial** | Dashboard totals, severity/status/category breakdowns, daily trends, emergency counts, visitor counts, and hotspot queries are implemented in [`src/routes/dashboard.js`](../src/routes/dashboard.js) and [`public/dashboard.js`](../public/dashboard.js). | No campus map visualization was found. Hotspots are displayed as tabular data rather than map-based analysis, and “real-time” refresh is manual rather than push/live. |
| **FR-13 Report Generation** | **Partial** | Incident, lost/found, gate, patrol, and audit report endpoints are implemented in [`src/routes/reports.js`](../src/routes/reports.js), including CSV output. | PDF and Excel export are not implemented. Officer/location and all requested filter combinations need endpoint-level verification. |
| **FR-14 User Management** | **Partial** | Admins can create, deactivate/reactivate, change roles, and bulk-import users in [`src/routes/users.js`](../src/routes/users.js). | No administrator password-reset endpoint or UI was found. Temporary passwords from bulk import require an explicit secure delivery/first-login process. |
| **FR-15 Audit Logging** | **Partial** | Login, user changes, reports, assignments, announcements, and other actions call [`src/utils/audit.js`](../src/utils/audit.js). [`db/schema.sql`](../db/schema.sql) now creates the same immutable `audit_log` table used by the application. | Audit failures are caught and logged instead of failing the operation. Coverage should be expanded to every security-sensitive action and verified with integration tests. |

## Cross-cutting blockers

### 1. Database contract alignment

The initialization schema in [`db/schema.sql`](../db/schema.sql) has been
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
