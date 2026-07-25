-- CPF Enterprise Ecosystem — migration 0006
-- Reviewer calibration gating (CPF-33): a reviewer may only be assigned to a
-- session whose template's frameworkVersion they hold a valid (non-expired,
-- non-revoked) calibration record for. Records are managed by org admins.

BEGIN;

CREATE TABLE reviewer_calibration_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  reviewer_user_id  uuid NOT NULL REFERENCES users(id),
  framework_version text NOT NULL,
  status            text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'expired', 'revoked')),
  calibrated_at     timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_calibration_org_reviewer ON reviewer_calibration_records (organisation_id, reviewer_user_id, framework_version);

ALTER TABLE reviewer_calibration_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviewer_calibration_records_tenant_isolation ON reviewer_calibration_records
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
ALTER TABLE reviewer_calibration_records FORCE ROW LEVEL SECURITY;

COMMIT;
