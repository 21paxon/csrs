# CSRS implementation decisions

## Source material

- The supplied build prompt is available in the conversation attachment.
- The SRS DOCX and the original `schema.sql` named by that prompt were not present in the project workspace. The repository's current `backend/db/schema.sql` was reviewed, but cannot be assumed to be the original source schema. Verify this checklist against the SRS before declaring traceability complete.

## Decisions made during repository review

- Keep the existing JWT bearer-token design and current database naming to avoid breaking the deployed frontend/API contract.
- Enforce incident status transitions in the API. A case must be `Resolved` with a resolution summary before a Head of Security or Admin can set it to `Closed`.
- Anonymous incident audit events retain the action and incident record reference, but omit actor username and IP. The report row itself does not retain reporter identity for anonymous submissions.
- The current roster schema has no expected time per checkpoint. A checkpoint is marked missed after its roster's shift end, then notified once per roster/checkpoint pair.
- Email, SMS and browser-push delivery are implemented behind configurable HTTP provider adapters; production credentials and a gateway implementing the documented JSON contract are deployment requirements. Local development logs simulated sends.
- The initial Kinyarwanda translations are limited to core flows and need fluent review. Untranslated screens stay in English.
- Requirements remain unchecked until they have been verified. No application, database or browser tests were run during this review.

## Known open choices

- Select an institutional email, SMS and web-push provider and provision credentials.
- Confirm approved retention periods, backup retention and the restore-test environment with the college.
- Confirm whether the deployed frontend/API origins in configuration belong to the current production deployment.
- Have a fluent Kinyarwanda reviewer approve translated safety and emergency wording.
