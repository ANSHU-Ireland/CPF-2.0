-- CPF Enterprise Ecosystem — migration 0005
-- Employer responsible-use acknowledgement (CPF-34): before any employer-side
-- user may view an issued Evidence Profile, they must acknowledge the current
-- version of the responsible-use document (decision-support-only duties, no
-- automated hiring outcomes). Re-versioning the document requires re-ack.

BEGIN;

CREATE TABLE employer_acknowledgements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  user_id           uuid NOT NULL REFERENCES users(id),
  document_version  text NOT NULL,
  acknowledged_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id, document_version)
);
CREATE INDEX idx_employer_ack_org_user ON employer_acknowledgements (organisation_id, user_id);

ALTER TABLE employer_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY employer_acknowledgements_tenant_isolation ON employer_acknowledgements
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
ALTER TABLE employer_acknowledgements FORCE ROW LEVEL SECURITY;

COMMIT;
