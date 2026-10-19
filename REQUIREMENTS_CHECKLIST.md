# CSRS requirements checklist

Source: supplied CSRS Codex build prompt (the SRS and its original `schema.sql` were not present in the workspace). A box is checked only after the requirement has been implemented and verified. This review did not run tests, so implementation already in the repository is not marked complete here.

## Functional requirements

- [ ] **FR-01 — Authentication (SRS 3.9, 3.3.1):** login identifiers, generic failures, lockout, logged attempts, password recovery, session revocation, optional MFA, and response target.
- [ ] **FR-02 — Roles and permissions (SRS 2.3, 3.9):** central policy, server enforcement on every endpoint, seven roles, anonymous access, Dean and Management scopes, reporter identity privacy.
- [ ] **FR-03 — Incident reporting (SRS 2.2.1, 3.3.4, 3.8, 3.10):** short form, categories, map/configured locations, optional GPS, evidence validation/storage, severity proposal, reference number, notifications, clear errors and performance target.
- [ ] **FR-04 — Assignment and tracking (SRS 2.2.3, 3.8):** triage, multi-officer assignment, status workflow, escalation, complete history, severity targets, overdue flags, filters, pagination, reporter updates.
- [ ] **FR-05 — Processing and closure (SRS 2.2.3):** officer investigation, internal notes, added evidence, resolution summary, closure request and Head of Security approval.
- [ ] **FR-06 — Emergency alerts (SRS 2.2.2, 3.3, 3.8, 3.10):** prominent safe trigger, sender/GPS, unknown-location fallback, responder acknowledgement/arrival/resolution, repeated alert until acknowledgement, contacts and history.
- [ ] **FR-07 — Notifications and announcements (SRS 2.2.8, 3.3):** durable queue, retries, in-app/push/email/SMS adapters, automatic events, targeted announcements, editable English/Kinyarwanda templates.
- [ ] **FR-08 — Lost and found (SRS 2.2.5):** public lost reports, staff found intake, search, match, owner notification, verified collection and configurable unclaimed period.
- [ ] **FR-09 — Visitor and gate management (SRS 2.2.6):** visitor check-in/out, vehicle/badge, host notification, blacklist refusal and alert, current visitors and daily log.
- [ ] **FR-10 — Patrol management (SRS 2.2.7):** rosters/shifts/routes/checkpoints, QR and typed check-in, background missed-checkpoint alerts, handover, patrol history and performance.
- [ ] **FR-11 — Search and filtering (SRS 2.2.3, 3.8):** reference, category, severity, status, location, date range and officer filters; pagination and response target.
- [ ] **FR-12 — Dashboard and hotspots (SRS 2.2.9):** counts, distributions, map/hotspots, time trends, response/resolution averages, active alerts, on-duty officers and visitors; read-only management views.
- [ ] **FR-13 — Reports (SRS 2.2.10, 3.8):** requested report types and filters, PDF/XLSX export with formula-injection protection, audit entry and response target.
- [ ] **FR-14 — User and access management (SRS 2.2.11, 3.3.5):** account lifecycle, role assignment, safe password reset, import preview/errors, categories/severity/locations/contacts/templates, backup visibility.
- [ ] **FR-15 — Audit logging (SRS 2.2.11, 3.9):** security-sensitive event coverage, actor/action/target/IP/time/outcome, immutable storage, filterable Admin screen and read-only Head of Security access.

## Non-functional and supporting requirements

- [ ] **SRS 2.2.1–2.2.11:** incident reports, emergency, case management, anonymous reporting, lost and found, gate, patrol, notifications, dashboards, reports and configuration are complete.
- [ ] **SRS 2.3:** role-specific workflows for Admin, Head of Security, Security Officer, College Management, Dean, Staff/Lecturer and Student.
- [ ] **SRS 3.2.1–3.2.5:** transactional persistence, notification retry, availability operations, security/privacy controls, scale design and PWA behavior.
- [ ] **SRS 3.3:** email, SMS, web push, map/location and college-record interfaces.
- [ ] **SRS 3.4:** accessible, responsive, mobile-first UI with keyboard support and visible focus.
- [ ] **SRS 3.5:** database entities, constraints, indexes, migrations and seed data align with the supplied schema and SRS.
- [ ] **SRS 3.6:** setup, user, technical, admin and training documentation.
- [ ] **SRS 3.7:** unit, PostgreSQL integration, browser system, security, load and acceptance tests; test outputs recorded.
- [ ] **SRS 3.8:** login, submission, alert delivery, search, report, concurrency, attachment and backup targets measured.
- [ ] **SRS 3.9:** Rwanda data-protection requirements, anonymity, retention, private evidence, immutable audit, backup/recovery and privacy notice.
- [ ] **SRS 3.10:** short main flows, confirmations, accessible actions and actionable error messages.
- [ ] **SRS 3.11:** modularity, lint/format, maintainable configuration and independent module changes.

## Changes made in this review

- Incident status changes now follow an explicit server-side transition map. Resolving or closing requires a resolution summary; only Admin or Head of Security can approve `Closed`, and only after `Resolved`.
- Audit rows for anonymous incident submissions no longer record the authenticated username or request IP.
- Failed login responses use the same generic message; anonymous tracking lookups/replies are rate limited.
- Added a notification outbox with retry/back-off, provider adapters, development console fake, push-subscription storage, and delivery status for Admin/Head of Security.
- Added scheduled repeat notifications for unacknowledged emergencies, scoped to on-duty officers and security leadership, plus deduplicated missed-checkpoint alerts after roster end.
- Added PDF/XLSX export and report types for individual incidents, summaries, emergency alerts, response time, disciplinary referrals, and officer performance. Spreadsheet strings are protected from formula execution.
- Added a service-worker app shell, manifest, and an initial English/Kinyarwanda switch for core reporting/emergency flows.
- Added database/evidence backup and guarded restore scripts, retention pruning, backup status records and an Admin status view.
- Added public password-reset request and completion pages; reset tokens are hashed, one-hour/one-use, email payloads are encrypted in the outbox, and reset/admin password changes revoke prior JWT sessions.
- Added Leaflet map-point selection for reports, coordinate-aware hotspot maps and server-side filters limiting Dean data to student reports and Security Officer dashboard data to assigned cases.
- Added configurable emergency contact records and a dialable contact list in the emergency screen.

These changes have not been test-run against PostgreSQL or in a browser; the corresponding requirement boxes remain unchecked. JavaScript syntax checks and `git diff --check` passed. `npm install` added the export libraries and reported two moderate dependency advisories.
