-- CPF Enterprise Ecosystem — migration 0008
-- Outbound notification queue (CPF-37): every notification (invitation
-- courier note, activation token delivery, DSR clock reminders) is enqueued
-- here rather than sent inline, so delivery failures are retried with
-- backoff instead of silently lost, and every send attempt is auditable.

BEGIN;

CREATE TABLE outbound_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  message_type    text NOT NULL,
  to_address      text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'dead_letter')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbound_messages_due ON outbound_messages (status, next_attempt_at);

ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbound_messages_tenant_isolation ON outbound_messages
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
ALTER TABLE outbound_messages FORCE ROW LEVEL SECURITY;

COMMIT;
