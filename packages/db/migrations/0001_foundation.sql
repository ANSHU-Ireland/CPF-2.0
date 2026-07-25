-- CPF Enterprise Ecosystem — migration 0001
-- Foundation: extensions, tenancy, identity scaffolding, audit log.
-- Conventions: snake_case, UUID primary keys, timestamptz, explicit enums,
-- row-level security keyed on app.current_org_id (set per transaction by the API).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TYPE organisation_type AS ENUM ('platform', 'employer');
CREATE TYPE organisation_status AS ENUM ('active', 'suspended', 'offboarding', 'closed');

CREATE TABLE organisations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          citext NOT NULL UNIQUE,
  name          text NOT NULL,
  type          organisation_type NOT NULL DEFAULT 'employer',
  status        organisation_status NOT NULL DEFAULT 'active',
  country_code  char(2),
  parent_id     uuid REFERENCES organisations(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Identity (schema only; authentication service lands in a later phase)
-- ---------------------------------------------------------------------------

CREATE TYPE user_status AS ENUM ('invited', 'active', 'suspended', 'deactivated');
CREATE TYPE org_role AS ENUM (
  'platform_admin',
  'org_admin',
  'hiring_manager',
  'reviewer',
  'support_agent',
  'learning_admin'
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  display_name   text NOT NULL,
  status         user_status NOT NULL DEFAULT 'invited',
  -- Argon2id hash; NULL until the user completes activation. Never a plain password.
  password_hash  text,
  mfa_enrolled   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  role            org_role NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id, role)
);
CREATE INDEX idx_org_memberships_user ON org_memberships (user_id);
CREATE INDEX idx_org_memberships_org ON org_memberships (organisation_id);

-- ---------------------------------------------------------------------------
-- Tamper-evident audit log (hash-chained, append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id uuid REFERENCES organisations(id),
  actor_user_id   uuid REFERENCES users(id),
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  prev_hash       text,
  entry_hash      text NOT NULL
);
CREATE INDEX idx_audit_log_org_time ON audit_log (organisation_id, occurred_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);

-- Append-only enforcement: no UPDATE or DELETE, ever.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security helper
-- ---------------------------------------------------------------------------

-- The API sets:  SET LOCAL app.current_org_id = '<uuid>';
-- Tables carrying tenant data enable RLS with this predicate. A missing setting
-- yields NULL and therefore denies access (deny-by-default).
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_memberships_tenant_isolation ON org_memberships
  USING (organisation_id = current_org_id());

COMMIT;
