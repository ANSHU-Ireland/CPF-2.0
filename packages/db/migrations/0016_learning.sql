-- CPF Enterprise Ecosystem — migration 0016
-- Learning data model (Delivery Plan Step 40, Phase 4). Minimum viable
-- authoring: org-scoped courses (modules/lessons), pathways (ordered course
-- lists), enrollments, and per-lesson progress.
--
-- HARD RULE from the source workbook: learning data is kept fully separate
-- from hiring evidence — no foreign key here ever points into candidates,
-- invitations, assessment_sessions, reviews, or criterion_scores. A lesson
-- may *reference* an assessment template CODE for an optional practice mode
-- (Step 41), which is a pointer to shared, non-personal template content,
-- not a link to any candidate's hiring data.

BEGIN;

CREATE TYPE learning_content_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE courses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  status              learning_content_status NOT NULL DEFAULT 'draft',
  -- Set only on publish: sha256 of the module/lesson content at that moment,
  -- so a learner's completed record can always be traced to what they actually
  -- saw, even if the course is edited again afterwards (same freeze intent as
  -- assessment_template_versions.definition_sha256, without a full version table
  -- — deliberately minimal per this step's own risk note).
  published_checksum  text,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_org ON courses (organisation_id, status);

CREATE TABLE course_modules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  course_id       uuid NOT NULL REFERENCES courses(id),
  title           text NOT NULL,
  position        integer NOT NULL CHECK (position >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE TABLE lessons (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        uuid NOT NULL REFERENCES organisations(id),
  course_module_id       uuid NOT NULL REFERENCES course_modules(id),
  title                  text NOT NULL,
  content_markdown       text NOT NULL DEFAULT '',
  position               integer NOT NULL CHECK (position >= 0),
  -- Optional practice-mode link (Step 41): an existing, shared assessment
  -- template code — never a candidate, session, or review id.
  practice_template_code text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_module_id, position)
);

CREATE TABLE pathways (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  status          learning_content_status NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pathways_org ON pathways (organisation_id, status);

CREATE TABLE pathway_courses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  pathway_id      uuid NOT NULL REFERENCES pathways(id),
  course_id       uuid NOT NULL REFERENCES courses(id),
  position        integer NOT NULL CHECK (position >= 0),
  UNIQUE (pathway_id, position),
  UNIQUE (pathway_id, course_id)
);

CREATE TYPE learning_enrollment_status AS ENUM ('enrolled', 'in_progress', 'completed', 'withdrawn');

CREATE TABLE learning_enrollments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  user_id           uuid NOT NULL REFERENCES users(id),
  course_id         uuid REFERENCES courses(id),
  pathway_id        uuid REFERENCES pathways(id),
  status            learning_enrollment_status NOT NULL DEFAULT 'enrolled',
  -- Employee learning-consent flag per enrollment. Jurisdiction-aware note:
  -- whether learning participation requires explicit employee consent (vs.
  -- legitimate-interest/contractual) is controller-configured and varies by
  -- jurisdiction; this column records the fact and moment of consent when
  -- given, it does not itself determine the lawful basis.
  consent_given_at  timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Exactly one of course_id/pathway_id is set — an enrollment targets either
  -- a single course or a pathway, never both and never neither.
  CONSTRAINT enrollment_target_exactly_one CHECK (
    (course_id IS NOT NULL AND pathway_id IS NULL) OR (course_id IS NULL AND pathway_id IS NOT NULL)
  ),
  UNIQUE (user_id, course_id),
  UNIQUE (user_id, pathway_id)
);
CREATE INDEX idx_learning_enrollments_user ON learning_enrollments (user_id);
CREATE INDEX idx_learning_enrollments_org ON learning_enrollments (organisation_id, status);

CREATE TABLE lesson_progress (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  enrollment_id  uuid NOT NULL REFERENCES learning_enrollments(id),
  lesson_id      uuid NOT NULL REFERENCES lessons(id),
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, lesson_id)
);
CREATE INDEX idx_lesson_progress_enrollment ON lesson_progress (enrollment_id);

-- ---------------------------------------------------------------------------
-- Row-level security: same deny-by-default tenant isolation as every other
-- tenant table (migrations 0002/0003) — enabled, policy, and FORCE together.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'courses', 'course_modules', 'lessons', 'pathways', 'pathway_courses',
    'learning_enrollments', 'lesson_progress'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id())',
      t, t
    );
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

COMMIT;
