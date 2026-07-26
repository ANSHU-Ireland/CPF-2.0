-- CPF Enterprise Ecosystem — migration 0020
-- Workflow Insights: the first module mounted through the plugin/module
-- registry (Delivery Plan Step 46). Proposal-only recommendations derived
-- from workforce-intelligence pain-point themes and learning completion
-- gaps — autonomy level 2 (propose only): a human approves or dismisses
-- each proposal; approving/dismissing never triggers any automated action
-- (no execution capability is wired to any status transition in this build).

BEGIN;

CREATE TYPE workflow_insight_source_type AS ENUM ('pain_point_theme', 'learning_gap');
CREATE TYPE workflow_insight_status AS ENUM ('proposed', 'approved', 'dismissed');

CREATE TABLE workflow_insight_proposals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  source_type         workflow_insight_source_type NOT NULL,
  -- Free-text identifier of the underlying signal (a pain-point category, or
  -- a course id) — lets `generate` skip re-proposing the same still-open
  -- signal on a later run without depending on title text matching.
  source_key          text NOT NULL,
  title               text NOT NULL,
  rationale           text NOT NULL,
  status              workflow_insight_status NOT NULL DEFAULT 'proposed',
  decided_by_user_id  uuid REFERENCES users(id),
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_insight_proposals_org_status ON workflow_insight_proposals (organisation_id, status, created_at DESC);

COMMENT ON TABLE workflow_insight_proposals IS
  'Proposal-only recommendations (Delivery Plan Step 46, autonomy level 2). No column or trigger in this table ever causes an automated action — approve/dismiss only record a human decision for audit purposes.';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_insight_proposals']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id())',
      t, t
    );
  END LOOP;
END $$;

COMMIT;
