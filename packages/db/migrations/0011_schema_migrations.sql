-- Delivery Plan Step 32: migration-apply tracking so scripts/migrate.mjs can
-- safely re-run against an already-migrated database (a no-op for files
-- already recorded here) instead of erroring on re-application.
--
-- Not RLS-protected: platform-level operational metadata, not tenant
-- content — same category as `organisations`/`idempotency_keys`.
CREATE TABLE schema_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- Retrofit: mark every migration that existed BEFORE this tracking table did
-- (0001-0010) as already applied, so running scripts/migrate.mjs against an
-- existing environment does not try to re-apply them. This file (0011)
-- deliberately does NOT insert its own filename — scripts/migrate.mjs
-- records that itself immediately after running each file (via an
-- `ON CONFLICT (filename) DO NOTHING` insert, so it is safe either way).
INSERT INTO schema_migrations (filename) VALUES
  ('0001_foundation.sql'),
  ('0002_assessment_core.sql'),
  ('0003_identity_runtime.sql'),
  ('0004_application_role.sql'),
  ('0005_employer_acknowledgements.sql'),
  ('0006_reviewer_calibration.sql'),
  ('0007_second_reviewer.sql'),
  ('0008_outbound_messages.sql'),
  ('0009_idempotency_keys.sql'),
  ('0010_session_hardening.sql')
ON CONFLICT (filename) DO NOTHING;

