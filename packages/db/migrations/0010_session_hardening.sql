-- CPF Enterprise Ecosystem — migration 0010
-- Session & authz hardening (CPF-27, Step 27): absolute session lifetime cap
-- for sliding renewal, and a step-up-authentication freshness marker.

BEGIN;

ALTER TABLE auth_sessions
  ADD COLUMN absolute_expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  ADD COLUMN stepped_up_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN auth_sessions.absolute_expires_at IS
  'Hard cap on session lifetime regardless of sliding renewal: a session can never outlive 24h from creation, set explicitly at login.';
COMMENT ON COLUMN auth_sessions.stepped_up_at IS
  'Timestamp of the most recent full re-authentication (login, or explicit re-verification via /v1/auth/step-up). Gates sensitive actions (e.g. org data export) behind a short freshness window.';

COMMIT;
