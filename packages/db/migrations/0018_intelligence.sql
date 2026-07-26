-- CPF Enterprise Ecosystem — migration 0018
-- Workforce Intelligence data model (Delivery Plan Step 43, Phase 5).
--
-- HARD ANTI-SURVEILLANCE RULE (workbook + plan risk note): this module NEVER
-- exposes per-employee rows to anyone. pain_point_reports.submitted_by is
-- NULLABLE BY DESIGN so a caller can submit anonymously; every read endpoint
-- built on top of these tables (Step 43 API layer) returns aggregate counts
-- only, gated by a k-anonymity floor, never a per-user drilldown.

BEGIN;

CREATE TYPE pain_point_category AS ENUM ('workload', 'tooling', 'process', 'management', 'other');

CREATE TABLE pain_point_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  -- Nullable by design: an anonymous submission stores NULL here, never a
  -- placeholder/system user id that could be reverse-engineered.
  submitted_by    uuid REFERENCES users(id),
  category        pain_point_category NOT NULL,
  report_text     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pain_point_reports_org_category ON pain_point_reports (organisation_id, category);

CREATE TABLE org_intelligence_settings (
  organisation_id                 uuid PRIMARY KEY REFERENCES organisations(id),
  enabled                         boolean NOT NULL DEFAULT false,
  -- Works-council / employee-representative acknowledgement, required before
  -- an org may enable this module (jurisdiction-aware employee-voice
  -- requirement, per the source workbook). Recorded fresh on every
  -- enable transition, not merely retained from a prior enable.
  works_council_acknowledged_by   text,
  works_council_acknowledged_at   timestamptz,
  enabled_by_user_id              uuid REFERENCES users(id),
  enabled_at                      timestamptz,
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Row-level security: same deny-by-default tenant isolation as every other
-- tenant table (migrations 0002/0003/0016).
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pain_point_reports', 'org_intelligence_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id())',
      t, t
    );
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

COMMIT;
