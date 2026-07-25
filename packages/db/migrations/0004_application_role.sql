-- CPF Enterprise Ecosystem — migration 0004
-- Dedicated application role. The API must NEVER connect as a superuser or as
-- the table owner: PostgreSQL exempts superusers from row-level security, and
-- owners bypass it unless FORCEd. cpf_app is NOLOGIN; each environment creates
-- its own LOGIN member (e.g. CREATE ROLE cpf_api LOGIN PASSWORD '…' IN ROLE cpf_app).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cpf_app') THEN
    CREATE ROLE cpf_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO cpf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cpf_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cpf_app;

-- Append-only audit: the application role cannot UPDATE/DELETE even before the
-- trigger fires, and can never TRUNCATE (TRUNCATE is deliberately not granted
-- on any table).
REVOKE UPDATE, DELETE ON audit_log FROM cpf_app;

-- Future tables created by the migration role inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cpf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cpf_app;

COMMIT;
