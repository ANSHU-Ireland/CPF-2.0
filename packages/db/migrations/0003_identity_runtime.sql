-- CPF Enterprise Ecosystem — migration 0003
-- Identity runtime: auth sessions, login throttling, TOTP enrollment,
-- candidate-portal routing table, RLS hardening (FORCE + self-scoped
-- membership reads for authentication flows).

BEGIN;

-- ---------------------------------------------------------------------------
-- User authentication state
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN totp_secret text; -- base32; KMS envelope encryption is a deployment task (see security docs)

CREATE TABLE auth_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  token_hash    text NOT NULL UNIQUE,               -- sha256 of the bearer token; token never stored
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  user_agent    text
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id) WHERE revoked_at IS NULL;

-- Append-only record of authentication attempts, used for lockout windows.
CREATE TABLE login_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        citext NOT NULL,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, attempted_at DESC);

-- Single-use account activation tokens (user invited → sets own password).
CREATE TABLE account_activation_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_activation_tokens_user ON account_activation_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Candidate-portal routing (deliberately WITHOUT row-level security)
-- ---------------------------------------------------------------------------
-- A candidate presenting an invitation token has no organisation context yet.
-- This narrow table maps a token hash to its organisation and invitation so the
-- API can establish tenant context, then perform all real reads under RLS.
-- It contains no personal data: hashes, ids, and an expiry only.

CREATE TABLE invitation_lookup (
  token_hash      text PRIMARY KEY,
  invitation_id   uuid NOT NULL UNIQUE REFERENCES invitations(id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  expires_at      timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- RLS hardening
-- ---------------------------------------------------------------------------

-- Self-scoped context for authentication flows (list my memberships).
CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DROP POLICY org_memberships_tenant_isolation ON org_memberships;
CREATE POLICY org_memberships_access ON org_memberships
  USING (organisation_id = current_org_id() OR user_id = current_user_id())
  WITH CHECK (organisation_id = current_org_id());

-- FORCE row-level security so policies bind even the table owner: the
-- application role cannot accidentally bypass tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_memberships', 'job_profiles', 'candidates', 'invitations',
    'assessment_sessions', 'disclosure_records', 'evidence_events', 'reviews',
    'criterion_scores', 'evidence_ledger_claims', 'data_rights_requests',
    'retention_policies', 'legal_holds'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

COMMIT;
