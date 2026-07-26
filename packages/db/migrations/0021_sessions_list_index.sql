-- CPF Enterprise Ecosystem — migration 0021
-- Performance hardening from Delivery Plan Step 48 (load-test verification).
-- GET /v1/orgs/:orgId/sessions (the employer portal's primary work-queue
-- read, ordered by created_at DESC) relies entirely on row-level security
-- (organisation_id = current_org_id()) to scope the scan — with no index on
-- assessment_sessions beyond its primary key, that RLS filter forces a
-- sequential scan. At the 1,000-row scale used in this local load test the
-- effect is invisible (~7ms), but it will not stay invisible as session
-- volume grows across many organisations in production. Add the composite
-- index the query actually needs.

BEGIN;

CREATE INDEX idx_assessment_sessions_org_created
  ON assessment_sessions (organisation_id, created_at DESC);

COMMIT;
