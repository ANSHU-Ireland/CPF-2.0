-- CPF Enterprise Ecosystem — migration 0019
-- AI gateway invocation ledger + org-level kill switch (Delivery Plan Step 45,
-- ADR-0005). No AI provider is configured by default and no product feature
-- is enabled by default — this migration only adds the tables the gateway
-- and its kill switches need. Every invocation attempt is logged, including
-- ones blocked by a kill switch, an unpinned model, or an exhausted budget
-- (status column), so the kill switches themselves are auditable.

BEGIN;

CREATE TYPE ai_invocation_status AS ENUM ('success', 'error', 'budget_exhausted', 'killed');

CREATE TABLE model_invocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  actor_user_id       uuid REFERENCES users(id),
  use_case            text NOT NULL,
  status              ai_invocation_status NOT NULL,
  provider            text NOT NULL,
  model               text NOT NULL,
  model_version       text NOT NULL,
  prompt_version      text NOT NULL,
  region              text NOT NULL,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cost_usd_cents      numeric(12, 4) NOT NULL DEFAULT 0,
  latency_ms          integer NOT NULL DEFAULT 0,
  -- Categories only ("email", "name") — never the redacted values themselves.
  redactions_applied  jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_model_invocations_org_created ON model_invocations (organisation_id, created_at DESC);
CREATE INDEX idx_model_invocations_org_use_case_day ON model_invocations (organisation_id, use_case, created_at);

COMMENT ON TABLE model_invocations IS
  'Full AI-invocation ledger per ADR-0005: provider, model+version, prompt version, tokens, cost, latency, region, redaction categories. Retention target per the AI governance register (AIF-01) is <=90 days, EU region, no vendor training — automated purge is a tracked follow-up, not yet wired into the retention job (packages jobs/retention.ts covers session/evidence data only today).';

CREATE TABLE org_ai_settings (
  organisation_id     uuid PRIMARY KEY REFERENCES organisations(id),
  -- Org-level kill switch. Independent of the global platform switch — both
  -- must be on for any call to reach a provider (packages/ai-gateway kill-switch.ts).
  enabled             boolean NOT NULL DEFAULT false,
  enabled_by_user_id  uuid REFERENCES users(id),
  enabled_at          timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Row-level security: same deny-by-default tenant isolation as every other
-- tenant table (migrations 0002/0003/0016/0018).
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['model_invocations', 'org_ai_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id())',
      t, t
    );
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

COMMIT;
