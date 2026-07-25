-- CPF-43: Idempotency-Key replay-safety for mutating endpoints.
--
-- Not RLS-protected: this table is a duplicate-suppression cache, not tenant
-- content. Every lookup/insert is explicitly scoped by (scope, actor_key) in
-- application code (apps/api/src/modules/idempotency.ts), the same pattern
-- already used for the platform-level `organisations` table.
CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            text NOT NULL,
  actor_key        text NOT NULL,
  idempotency_key  text NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer NOT NULL,
  response_body    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, actor_key, idempotency_key)
);

CREATE INDEX idx_idempotency_keys_created_at ON idempotency_keys (created_at);
