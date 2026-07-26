/**
 * Seeds fixture data for the Step 48 k6 load-test scripts in this directory.
 *
 * IMPORTANT / disclosed design choice: this script connects with the
 * superuser DB role (DATABASE_ADMIN_URL) and inserts rows directly via SQL,
 * bypassing the API and RLS. This is a deliberate, common load-test-fixture
 * practice (bulk-seeding 1,000+ rows through 1,000+ real HTTP round trips
 * would make "seed data" itself the bottleneck being measured) — it is NOT
 * how the application ever writes data at runtime. All rows are clearly
 * labelled as load-test fixtures (org slug `load-test-org`, e-mails under
 * `@loadtest.example`) and this script is destructive/idempotent: it deletes
 * any previous `load-test-org` before re-seeding, so it is always safe to
 * re-run.
 *
 * Usage:
 *   DATABASE_ADMIN_URL=postgresql://cpf@localhost:5544/cpf node tools/load/seed-load-test.mjs
 *
 * Requires `npm run build` first (imports the built @cpf/identity package).
 * Prints a JSON summary (org id, admin credentials, and the one real
 * candidate token used by the event-burst script) to stdout on the last line.
 */
import pg from "pg";
import { hashPassword, generateToken, hashToken } from "@cpf/identity";

const { DATABASE_ADMIN_URL } = process.env;
if (!DATABASE_ADMIN_URL) {
  console.error("Required env var: DATABASE_ADMIN_URL");
  process.exit(1);
}

const SESSION_COUNT = 1000;
const ADMIN_EMAIL = "load-admin@loadtest.example";
const ADMIN_PASSWORD = "Load-Test-Password-1!";

const client = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
await client.connect();

try {
  await client.query("BEGIN");

  // Clean slate: delete any previous load-test org (cascades via FKs are not
  // universal here, so delete children first, deepest tables first).
  const prior = await client.query("SELECT id FROM organisations WHERE slug = 'load-test-org'");
  if (prior.rows[0]) {
    const orgId = prior.rows[0].id;
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    await client.query("DELETE FROM disclosure_records WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM assessment_sessions WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM invitation_lookup WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM invitations WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM candidates WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM job_profiles WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM org_subscriptions WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM org_memberships WHERE organisation_id = $1", [orgId]);
    await client.query("DELETE FROM organisations WHERE id = $1", [orgId]);
    // Note: the admin user row is deliberately NOT deleted here — audit_log
    // rows from prior runs' logins reference it by FK. Reused below instead.
  }

  const org = await client.query(
    `INSERT INTO organisations (slug, name, type, status) VALUES ('load-test-org', 'Load Test Employer', 'employer', 'active') RETURNING id`,
  );
  const orgId = org.rows[0].id;
  await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const existingAdmin = await client.query("SELECT id FROM users WHERE email = $1", [ADMIN_EMAIL]);
  const adminId = existingAdmin.rows[0]
    ? existingAdmin.rows[0].id
    : (
        await client.query(
          `INSERT INTO users (email, display_name, status, password_hash) VALUES ($1, 'Load Test Admin', 'active', $2) RETURNING id`,
          [ADMIN_EMAIL, passwordHash],
        )
      ).rows[0].id;
  await client.query(`INSERT INTO org_memberships (organisation_id, user_id, role) VALUES ($1, $2, 'org_admin')`, [orgId, adminId]);

  // Pre-acknowledge the responsible-use gate for the profile-read k6 script
  // (mirrors POST .../acknowledgements/responsible-use — a real precondition
  // this admin would otherwise have to click through once, manually).
  await client.query(
    `INSERT INTO employer_acknowledgements (organisation_id, user_id, document_version, acknowledged_at)
     VALUES ($1, $2, '2026-07-25', now())
     ON CONFLICT (organisation_id, user_id, document_version) DO NOTHING`,
    [orgId, adminId],
  );

  const plan = await client.query(`SELECT id FROM plans WHERE code = 'internal-pilot'`);
  await client.query(
    `INSERT INTO org_subscriptions (organisation_id, plan_id, status) VALUES ($1, $2, 'active')`,
    [orgId, plan.rows[0].id],
  );

  const templateVersion = await client.query(
    `SELECT id FROM assessment_template_versions WHERE template_id = (SELECT id FROM assessment_templates WHERE code = 'SE1') ORDER BY published_at DESC LIMIT 1`,
  );
  if (!templateVersion.rows[0]) {
    throw new Error("SE1 template version not found — run `npm run seed:generate` and apply packages/db/seed/generated/seed.sql first.");
  }
  const templateVersionId = templateVersion.rows[0].id;

  const jobProfile = await client.query(
    `INSERT INTO job_profiles (organisation_id, title, role_family, status) VALUES ($1, 'Load Test Role', 'Engineering', 'open') RETURNING id`,
    [orgId],
  );
  const jobProfileId = jobProfile.rows[0].id;

  // Bulk-seed SESSION_COUNT candidates/invitations/sessions with a realistic
  // status distribution, via set-based INSERT ... generate_series (fast).
  await client.query(
    `INSERT INTO candidates (organisation_id, email, full_name, status)
     SELECT $1, 'loadcand' || g || '@loadtest.example', 'Load Candidate ' || g, 'active'
     FROM generate_series(1, $2) AS g`,
    [orgId, SESSION_COUNT],
  );

  await client.query(
    `INSERT INTO invitations (organisation_id, candidate_id, job_profile_id, template_version_id, status, token_hash, expires_at)
     SELECT $1, c.id, $2, $3, 'accepted', encode(gen_random_bytes(32), 'hex'), now() + interval '30 days'
     FROM candidates c
     WHERE c.organisation_id = $1 AND c.email LIKE 'loadcand%@loadtest.example'`,
    [orgId, jobProfileId, templateVersionId],
  );

  // Status distribution across the seeded sessions, roughly mirroring a
  // mature org: mostly finished, some in flight, a few just started.
  await client.query(
    `INSERT INTO assessment_sessions (organisation_id, invitation_id, template_version_id, status, started_at, submitted_at)
     SELECT
       $1,
       i.id,
       $2,
       (ARRAY['report_issued','report_issued','report_issued','report_issued','report_issued','report_issued',
              'under_review','review_finalised','submitted','in_progress','in_progress','created']::session_status[])[1 + (row_number() OVER () % 12)],
       now() - (random() * interval '90 days'),
       CASE WHEN (row_number() OVER ()) % 12 < 6 THEN now() - (random() * interval '60 days') ELSE NULL END
     FROM invitations i
     WHERE i.organisation_id = $1`,
    [orgId, templateVersionId],
  );

  // One dedicated, real-token candidate + invitation + in_progress session +
  // disclosure record, for the candidate-event-burst k6 script.
  const eventCandidate = await client.query(
    `INSERT INTO candidates (organisation_id, email, full_name, status) VALUES ($1, 'load-event-candidate@loadtest.example', 'Load Event Candidate', 'active') RETURNING id`,
    [orgId],
  );
  const rawToken = generateToken();
  const eventInvitation = await client.query(
    `INSERT INTO invitations (organisation_id, candidate_id, job_profile_id, template_version_id, status, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, 'accepted', $5, now() + interval '30 days') RETURNING id`,
    [orgId, eventCandidate.rows[0].id, jobProfileId, templateVersionId, hashToken(rawToken)],
  );
  await client.query(
    `INSERT INTO invitation_lookup (token_hash, invitation_id, organisation_id, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')`,
    [hashToken(rawToken), eventInvitation.rows[0].id, orgId],
  );
  const eventSession = await client.query(
    `INSERT INTO assessment_sessions (organisation_id, invitation_id, template_version_id, status, started_at) VALUES ($1, $2, $3, 'in_progress', now()) RETURNING id`,
    [orgId, eventInvitation.rows[0].id, templateVersionId],
  );
  await client.query(
    `INSERT INTO disclosure_records (organisation_id, session_id, privacy_notice_version, ai_use_notice_version, telemetry_notice_version, assessment_rules_version, lawful_basis, acknowledged_at)
     VALUES ($1, $2, '2026-07-25.draft-1', '2026-07-25.draft-1', '2026-07-25.draft-1', '2026-07-25.draft-1', 'contract', now())`,
    [orgId, eventSession.rows[0].id],
  );

  // One report_issued session with a fully finalised review + scores +
  // ledger claims, for the profile-read k6 script (GET .../evidence-profile).
  const profileCandidate = await client.query(
    `INSERT INTO candidates (organisation_id, email, full_name, status) VALUES ($1, 'load-profile-candidate@loadtest.example', 'Load Profile Candidate', 'active') RETURNING id`,
    [orgId],
  );
  const profileInvitation = await client.query(
    `INSERT INTO invitations (organisation_id, candidate_id, job_profile_id, template_version_id, status, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, 'accepted', encode(gen_random_bytes(32), 'hex'), now() + interval '30 days') RETURNING id`,
    [orgId, profileCandidate.rows[0].id, jobProfileId, templateVersionId],
  );
  const profileSession = await client.query(
    `INSERT INTO assessment_sessions (organisation_id, invitation_id, template_version_id, status, started_at, submitted_at)
     VALUES ($1, $2, $3, 'report_issued', now() - interval '3 days', now() - interval '2 days') RETURNING id`,
    [orgId, profileInvitation.rows[0].id, templateVersionId],
  );
  const profileReview = await client.query(
    `INSERT INTO reviews (organisation_id, session_id, reviewer_user_id, status, final_rationale, confidence, limitations, finalised_at)
     VALUES ($1, $2, $3, 'finalised', 'Consistent evidence across all workspace artefacts.', 'high', 'Single-session sample; no live-collaboration observation.', now() - interval '1 day')
     RETURNING id`,
    [orgId, profileSession.rows[0].id, adminId],
  );
  const reviewId = profileReview.rows[0].id;
  await client.query(
    `INSERT INTO criterion_scores (organisation_id, review_id, criterion_id, reviewer1_score, evidence_note, confidence)
     SELECT $1, $2, 'SE1-' || lpad(g::text, 2, '0'), 4, 'Solid evidence in workspace artefacts.', 'high'
     FROM generate_series(1, 18) AS g`,
    [orgId, reviewId],
  );
  await client.query(
    `INSERT INTO evidence_ledger_claims (organisation_id, review_id, dimension, claim, evidence_band, evidence_references, counter_evidence, limitations, reviewer_confidence, reviewer_rationale)
     VALUES ($1, $2, 'Verification & scepticism', 'Consistently verified AI suggestions before applying them.', 'Strong', '[]'::jsonb, NULL, NULL, 'high', 'Repeated verification behaviour observed across workspace evidence.')`,
    [orgId, reviewId],
  );

  await client.query("COMMIT");

  console.log(
    JSON.stringify({
      organisationId: orgId,
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
      candidateEventToken: rawToken,
      profileSessionId: profileSession.rows[0].id,
      seededSessions: SESSION_COUNT,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
