-- CPF Enterprise Ecosystem — migration 0007
-- Double-scoring & adjudication (Step 20): allow a second reviewer to be
-- assigned to an existing review row. reviewer1 writes reviewer1_score,
-- reviewer2 writes reviewer2_score (server-enforced by identity in the API
-- layer); adjudicated_score remains writable only by an org admin, and only
-- once both reviewer scores are present for that criterion.

BEGIN;

ALTER TABLE reviews ADD COLUMN second_reviewer_user_id uuid REFERENCES users(id);

COMMIT;
