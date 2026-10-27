ALTER TABLE incident_assignments
  ADD COLUMN IF NOT EXISTS unassigned_at TIMESTAMPTZ;

WITH ranked_assignments AS (
  SELECT incident_id, officer_id,
         ROW_NUMBER() OVER (
           PARTITION BY incident_id
           ORDER BY assigned_at DESC, officer_id DESC
         ) AS assignment_rank
    FROM incident_assignments
   WHERE unassigned_at IS NULL
)
UPDATE incident_assignments ia
   SET unassigned_at = ia.assigned_at
  FROM ranked_assignments ranked
 WHERE ranked.incident_id = ia.incident_id
   AND ranked.officer_id = ia.officer_id
   AND ranked.assignment_rank > 1;

CREATE INDEX IF NOT EXISTS idx_incident_assignments_current
  ON incident_assignments(incident_id, assigned_at DESC)
  WHERE unassigned_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_assignments_one_current
  ON incident_assignments(incident_id)
  WHERE unassigned_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('012-incident-reassignment-history')
ON CONFLICT (version) DO NOTHING;
