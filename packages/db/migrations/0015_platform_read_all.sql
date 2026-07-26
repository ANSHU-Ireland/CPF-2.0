-- CPF Enterprise Ecosystem — migration 0015
-- Platform-wide analytics (Step 39) needs to aggregate assessment_sessions
-- and reviews across every organisation, but both tables FORCE row-level
-- security scoped to `current_org_id()` (migration 0003) — with no org
-- context set, a platform-scoped query legitimately sees zero rows, by
-- design. This adds a narrow, explicit escape hatch: a session-local flag,
-- set ONLY by trusted backend code inside a platform_admin-gated route
-- (never derived from user input), that makes matching rows visible for
-- reads. It is added to USING only — WITH CHECK (which governs INSERT and
-- the post-image of UPDATE) is left untouched, so this can never be used to
-- write, move, or delete data across a tenant boundary, only to read/count
-- it for cross-org aggregates.

BEGIN;

CREATE OR REPLACE FUNCTION platform_read_all() RETURNS boolean AS $$
  SELECT COALESCE(NULLIF(current_setting('app.platform_read_all', true), ''), 'false')::boolean;
$$ LANGUAGE sql STABLE;

DROP POLICY assessment_sessions_tenant_isolation ON assessment_sessions;
CREATE POLICY assessment_sessions_tenant_isolation ON assessment_sessions
  USING (organisation_id = current_org_id() OR platform_read_all())
  WITH CHECK (organisation_id = current_org_id());

DROP POLICY reviews_tenant_isolation ON reviews;
CREATE POLICY reviews_tenant_isolation ON reviews
  USING (organisation_id = current_org_id() OR platform_read_all())
  WITH CHECK (organisation_id = current_org_id());

COMMIT;
