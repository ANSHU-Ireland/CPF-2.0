-- CPF Enterprise Ecosystem — migration 0017
-- Learning practice-mode attempts (Delivery Plan Step 41). A lesson may
-- optionally link to an existing, shared assessment template code so a
-- learner can practise against the real scoring engine — but this is a
-- learning-only artefact: NO foreign key here (or anywhere else in the
-- learning schema) ever points into candidates, invitations,
-- assessment_sessions, reviews, or criterion_scores, and no hiring endpoint
-- ever reads this table. The practice attempt stores the learner's own
-- self-assessment input and the resulting evidence-profile snapshot,
-- computed by the same stateless `evaluate()` engine used by
-- POST /v1/scoring/evaluate, for the learner's own reference only.

BEGIN;

CREATE TABLE learning_assessment_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES organisations(id),
  enrollment_id      uuid NOT NULL REFERENCES learning_enrollments(id),
  lesson_id          uuid NOT NULL REFERENCES lessons(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  template_code      text NOT NULL,
  input              jsonb NOT NULL,
  profile            jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_learning_attempts_enrollment ON learning_assessment_attempts (enrollment_id);
CREATE INDEX idx_learning_attempts_user ON learning_assessment_attempts (user_id);

ALTER TABLE learning_assessment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY learning_assessment_attempts_tenant_isolation ON learning_assessment_attempts
  USING (organisation_id = current_org_id())
  WITH CHECK (organisation_id = current_org_id());
ALTER TABLE learning_assessment_attempts FORCE ROW LEVEL SECURITY;

COMMIT;
