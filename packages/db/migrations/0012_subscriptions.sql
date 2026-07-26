-- CPF Enterprise Ecosystem — migration 0012
-- Subscriptions & entitlements (Delivery Plan Step 35): platform-owned
-- commercial model. plans/org_subscriptions are managed exclusively via the
-- platform_admin API — no tenant ever writes these directly, and no
-- row-level security applies (same treatment as `organisations` itself: the
-- platform needs cross-org visibility by design).
--
-- Note: migration 0011 is reserved for a separate, not-yet-merged change
-- (schema_migrations tracking, delivery-plan Step 32) developed in parallel
-- on another branch. This migration is deliberately numbered 0012 to match
-- the delivery plan's own numbering and avoid colliding with that file when
-- both eventually land on `main`.

BEGIN;

CREATE TYPE subscription_status AS ENUM ('active', 'suspended', 'cancelled');

CREATE TABLE plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  module_entitlements   jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN plans.module_entitlements IS
  'Module-key -> boolean map, e.g. {"assessments": true, "learning": false, "intelligence": false}. Consulted by the Step 36 module-gate middleware.';
COMMENT ON COLUMN plans.limits IS
  'Numeric plan limits, e.g. {"maxActiveAssessments": 50, "maxOrgUsers": 20}. Consulted by Step 36 usage enforcement.';

CREATE TABLE org_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        uuid NOT NULL UNIQUE REFERENCES organisations(id),
  plan_id                uuid NOT NULL REFERENCES plans(id),
  status                 subscription_status NOT NULL DEFAULT 'active',
  current_period_start   timestamptz NOT NULL DEFAULT now(),
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_subscriptions_plan ON org_subscriptions (plan_id);

-- Seed: internal-pilot plan (generous limits, assessments only — learning and
-- workforce-intelligence modules don't exist yet).
INSERT INTO plans (code, name, module_entitlements, limits)
VALUES (
  'internal-pilot',
  'Internal Pilot',
  '{"assessments": true, "learning": false, "intelligence": false}'::jsonb,
  '{"maxActiveAssessments": 1000, "maxOrgUsers": 100}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

COMMIT;
