-- CPF Enterprise Ecosystem — migration 0014
-- Platform analytics + reviewer-minutes telemetry (Step 39): capture when a
-- reviewer actually begins scoring (first score save) so reviewer-minutes
-- (finalised_at - started_at) can be measured. reviews.finalised_at already
-- exists (migration 0002).

BEGIN;

ALTER TABLE reviews ADD COLUMN started_at timestamptz;

COMMIT;
