-- CPF Enterprise Ecosystem — migration 0013
-- Support console / JIT access (Delivery Plan Step 37): platform staff get
-- NO standing access to any organisation's data. Access is a time-boxed,
-- audited grant: normally requested by a platform_admin and approved by that
-- organisation's own org_admin; a break-glass path allows a platform_admin
-- to self-approve for genuine emergencies, at the cost of an extra,
-- unmissable audit trail (see appendAudit calls in support-access.ts).
--
-- This table is platform-owned (no tenant ever writes it directly), same
-- treatment as plans/org_subscriptions from migration 0012 — no row-level
-- security applies.

BEGIN;

CREATE TYPE support_access_scope AS ENUM ('read_metadata', 'read_evidence');
CREATE TYPE support_access_status AS ENUM ('pending', 'approved', 'denied', 'revoked');

CREATE TABLE support_access_grants (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid NOT NULL REFERENCES organisations(id),
  platform_user_id        uuid NOT NULL REFERENCES users(id),
  scope                   support_access_scope NOT NULL,
  reason                  text NOT NULL,
  status                  support_access_status NOT NULL DEFAULT 'pending',
  break_glass             boolean NOT NULL DEFAULT false,
  approved_by_org_admin   uuid REFERENCES users(id),
  approved_at             timestamptz,
  requested_at            timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  revoked_at              timestamptz,
  CONSTRAINT support_access_grants_expiry_bounded
    CHECK (expires_at <= requested_at + interval '4 hours')
);

COMMENT ON COLUMN support_access_grants.scope IS
  'read_metadata: counts/statuses only. read_evidence: reserved for a future endpoint that would expose evidence content — no such endpoint exists yet, so in practice every grant today is metadata-only regardless of scope.';
COMMENT ON COLUMN support_access_grants.break_glass IS
  'true = a platform_admin self-approved without an org_admin (emergency access). Always dual-logged distinctly from the normal request/approve flow.';

-- The requireSupportAccess guard runs this lookup on every gated request.
CREATE INDEX idx_support_access_grants_active_lookup
  ON support_access_grants (organisation_id, platform_user_id, status, expires_at);

COMMIT;
