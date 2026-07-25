-- CPF Enterprise Ecosystem — migration 0002
-- Assessment core: versioned template library, job profiles, candidates,
-- invitations, sessions, disclosure records, categorised evidence events,
-- reviews, criterion scores, evidence-ledger claims, data-rights requests,
-- retention policies.

BEGIN;

-- ---------------------------------------------------------------------------
-- Versioned assessment template library (platform-level content, non-personal)
-- ---------------------------------------------------------------------------

CREATE TYPE template_status AS ENUM ('draft', 'published', 'retired');

CREATE TABLE assessment_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                -- e.g. SE1
  role_family text NOT NULL,
  status      template_status NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Immutable frozen versions: sessions always reference a version, never the
-- mutable template head. "Freeze the brief, source pack, tool permissions and
-- rubric for each validation cohort." (workbook governance)
CREATE TABLE assessment_template_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id        uuid NOT NULL REFERENCES assessment_templates(id),
  framework_version  text NOT NULL,
  definition         jsonb NOT NULL,               -- validated against AssessmentTemplateSchema
  definition_sha256  text NOT NULL,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, framework_version)
);

-- ---------------------------------------------------------------------------
-- Employer-tenant hiring entities (RLS on every table below)
-- ---------------------------------------------------------------------------

CREATE TABLE job_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  title           text NOT NULL,
  role_family     text NOT NULL,
  description     text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','paused','closed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE candidate_status AS ENUM ('created', 'invited', 'active', 'withdrawn', 'archived', 'anonymised');

CREATE TABLE candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  email           citext NOT NULL,
  full_name       text NOT NULL,
  status          candidate_status NOT NULL DEFAULT 'created',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Duplicate management: one live record per e-mail per controller organisation.
  UNIQUE (organisation_id, email)
);

CREATE TYPE invitation_status AS ENUM ('draft', 'sent', 'opened', 'accepted', 'expired', 'revoked');

CREATE TABLE invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  candidate_id        uuid NOT NULL REFERENCES candidates(id),
  job_profile_id      uuid NOT NULL REFERENCES job_profiles(id),
  template_version_id uuid NOT NULL REFERENCES assessment_template_versions(id),
  status              invitation_status NOT NULL DEFAULT 'draft',
  -- Only a hash of the invitation token is stored; the token itself is shown once.
  token_hash          text NOT NULL UNIQUE,
  expires_at          timestamptz NOT NULL,
  sent_at             timestamptz,
  accepted_at         timestamptz,
  reissued_from_id    uuid REFERENCES invitations(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invitations_candidate ON invitations (candidate_id);

CREATE TYPE session_status AS ENUM (
  'created', 'disclosure_pending', 'ready', 'in_progress', 'paused',
  'submitted', 'under_review', 'review_finalised', 'report_issued',
  'withdrawn', 'expired', 'invalidated'
);

CREATE TABLE assessment_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  invitation_id       uuid NOT NULL UNIQUE REFERENCES invitations(id),
  template_version_id uuid NOT NULL REFERENCES assessment_template_versions(id),
  status              session_status NOT NULL DEFAULT 'created',
  started_at          timestamptz,
  submitted_at        timestamptz,
  accommodations_note text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Disclosure-first capture: exactly what the candidate saw and acknowledged,
-- recorded before any evidence event is accepted.
CREATE TABLE disclosure_records (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL REFERENCES organisations(id),
  session_id                uuid NOT NULL UNIQUE REFERENCES assessment_sessions(id),
  privacy_notice_version    text NOT NULL,
  ai_use_notice_version     text NOT NULL,
  telemetry_notice_version  text NOT NULL,
  assessment_rules_version  text NOT NULL,
  lawful_basis              text NOT NULL,
  acknowledged_at           timestamptz NOT NULL,
  user_agent                text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Categorised evidence events. Category separation is the data-minimisation
-- backbone: integrity signals never mix with capability evidence.
CREATE TYPE evidence_event_category AS ENUM (
  'workspace_evidence',   -- prompts, AI responses, edits, tests, verification notes
  'integrity_signal',     -- focus loss, clipboard metadata, session anomalies (metadata only)
  'system_audit',         -- logins, role changes, exports
  'reviewer_decision',    -- finalisation, overrides, confidence, limitations
  'employer_access'       -- report views, acknowledgements
);

CREATE TABLE evidence_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  session_id      uuid NOT NULL REFERENCES assessment_sessions(id),
  category        evidence_event_category NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  -- Ingestion guardrail (defence in depth; the API also rejects these):
  -- raw keystroke streams and full external clipboard content are forbidden.
  CONSTRAINT no_raw_keystrokes CHECK (event_type NOT IN ('raw_keystroke', 'external_clipboard_content'))
);
CREATE INDEX idx_evidence_events_session ON evidence_events (session_id, occurred_at);
CREATE INDEX idx_evidence_events_category ON evidence_events (session_id, category);

-- ---------------------------------------------------------------------------
-- Review, scoring, and the Evidence Ledger
-- ---------------------------------------------------------------------------

CREATE TYPE review_status AS ENUM ('assigned', 'in_review', 'adjudication_required', 'finalised', 'reopened', 'declined');

CREATE TABLE reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  session_id       uuid NOT NULL REFERENCES assessment_sessions(id),
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  status           review_status NOT NULL DEFAULT 'assigned',
  final_rationale  text,
  confidence       text CHECK (confidence IN ('high','medium-high','medium','low','insufficient')),
  limitations      text,
  finalised_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- GUARDRAIL: a finalised review must carry rationale, confidence, and limitations.
  CONSTRAINT finalised_review_is_complete CHECK (
    status <> 'finalised'
    OR (final_rationale IS NOT NULL AND confidence IS NOT NULL AND limitations IS NOT NULL AND finalised_at IS NOT NULL)
  )
);
CREATE INDEX idx_reviews_session ON reviews (session_id);
CREATE INDEX idx_reviews_reviewer ON reviews (reviewer_user_id, status);

CREATE TABLE criterion_scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  review_id        uuid NOT NULL REFERENCES reviews(id),
  criterion_id     text NOT NULL,                    -- e.g. SE1-06 (validated against frozen definition)
  reviewer1_score  smallint CHECK (reviewer1_score BETWEEN 1 AND 5),
  reviewer2_score  smallint CHECK (reviewer2_score BETWEEN 1 AND 5),
  adjudicated_score smallint CHECK (adjudicated_score BETWEEN 1 AND 5),
  evidence_note    text,
  confidence       text CHECK (confidence IN ('high','medium-high','medium','low','insufficient')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, criterion_id)
);

-- Evidence Ledger: every profile statement is a claim linked to evidence,
-- counter-evidence, confidence, and limitations.
CREATE TABLE evidence_ledger_claims (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  review_id           uuid NOT NULL REFERENCES reviews(id),
  dimension           text NOT NULL,
  claim               text NOT NULL,
  evidence_band       text NOT NULL,
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb, -- evidence_events ids + artefact refs
  counter_evidence    text,
  reviewer_confidence text NOT NULL,
  limitations         text,
  reviewer_rationale  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_claims_review ON evidence_ledger_claims (review_id);

-- ---------------------------------------------------------------------------
-- Data rights and retention
-- ---------------------------------------------------------------------------

CREATE TYPE data_rights_type AS ENUM (
  'access', 'rectification', 'erasure', 'restriction', 'objection', 'portability', 'challenge', 'human_review'
);
CREATE TYPE data_rights_status AS ENUM (
  'received', 'identity_verification', 'in_progress', 'awaiting_controller',
  'fulfilled', 'refused_documented', 'withdrawn_by_subject'
);

CREATE TABLE data_rights_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  candidate_id    uuid NOT NULL REFERENCES candidates(id),
  request_type    data_rights_type NOT NULL,
  status          data_rights_status NOT NULL DEFAULT 'received',
  received_at     timestamptz NOT NULL DEFAULT now(),
  due_at          timestamptz NOT NULL,
  resolved_at     timestamptz,
  resolution_note text
);
CREATE INDEX idx_drr_org_status ON data_rights_requests (organisation_id, status);

CREATE TABLE retention_policies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL UNIQUE REFERENCES organisations(id),
  evidence_retention_days  integer NOT NULL DEFAULT 180 CHECK (evidence_retention_days > 0),
  integrity_retention_days integer NOT NULL DEFAULT 90  CHECK (integrity_retention_days > 0),
  audit_retention_days     integer NOT NULL DEFAULT 730 CHECK (audit_retention_days > 0),
  deletion_mode            text NOT NULL DEFAULT 'anonymise_then_delete'
                             CHECK (deletion_mode IN ('hard_delete', 'anonymise_then_delete')),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  candidate_id    uuid REFERENCES candidates(id),
  reason          text NOT NULL,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- Row-level security: deny-by-default tenant isolation on all tenant tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_profiles', 'candidates', 'invitations', 'assessment_sessions',
    'disclosure_records', 'evidence_events', 'reviews', 'criterion_scores',
    'evidence_ledger_claims', 'data_rights_requests', 'retention_policies', 'legal_holds'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id())',
      t, t
    );
  END LOOP;
END $$;

COMMIT;
