/**
 * Platform analytics + reviewer-minutes telemetry (Delivery Plan Step 39):
 * org-level (own data) and platform-level (cross-org, k-anonymised) analytics
 * built on reviews.started_at (migration 0014) + reviews.finalised_at.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "@cpf/identity";
import { buildApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/pool.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = describe.runIf(Boolean(DATABASE_URL && DATABASE_ADMIN_URL));

const PW = "a-long-test-password-1234";
const RUN_ID = randomUUID().slice(0, 8);

let app: FastifyInstance;
let admin: pg.Client;

async function createActiveUser(email: string): Promise<string> {
  const hash = await hashPassword(PW);
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, password_hash)
     VALUES ($1, $2, 'active', $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
     RETURNING id`,
    [email, `Test ${email}`, hash],
  );
  return result.rows[0]!.id;
}

async function createOrg(slug: string): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO organisations (slug, name, type) VALUES ($1, $2, 'employer'::organisation_type)
     ON CONFLICT (slug) DO UPDATE SET updated_at = now(), status = 'active' RETURNING id`,
    [slug, `Org ${slug}`],
  );
  return result.rows[0]!.id;
}

async function addMembership(orgId: string, userId: string, role: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    await client.query(
      `INSERT INTO org_memberships (organisation_id, user_id, role)
       VALUES ($1, $2, $3::org_role) ON CONFLICT (organisation_id, user_id, role) DO NOTHING`,
      [orgId, userId, role],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PW } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token;
}

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

interface FinalisedFixture {
  orgId: string;
  adminToken: string;
}

/** End-to-end: org + one finalised, report-issued session against `templateCode`. */
async function setupOrgWithFinalisedSession(slug: string, templateCode: string): Promise<FinalisedFixture> {
  const orgId = await createOrg(slug);
  const adminId = await createActiveUser(`${slug}-admin@it.cpf.test`);
  const hmId = await createActiveUser(`${slug}-hm@it.cpf.test`);
  const reviewerId = await createActiveUser(`${slug}-reviewer@it.cpf.test`);
  await addMembership(orgId, adminId, "org_admin");
  await addMembership(orgId, hmId, "hiring_manager");
  await addMembership(orgId, reviewerId, "reviewer");

  const adminToken = await login(`${slug}-admin@it.cpf.test`);
  const hmToken = await login(`${slug}-hm@it.cpf.test`);
  const reviewerToken = await login(`${slug}-reviewer@it.cpf.test`);

  const calibrate = await app.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/reviewer-calibrations`,
    headers: authed(adminToken),
    payload: { reviewerUserId: reviewerId, frameworkVersion: "0.1.0" },
  });
  expect(calibrate.statusCode, calibrate.body).toBe(201);

  const job = await app.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/job-profiles`,
    headers: authed(hmToken),
    payload: { title: "Engineer", roleFamily: "software-engineering" },
  });
  expect(job.statusCode, job.body).toBe(201);

  const candidate = await app.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/candidates`,
    headers: authed(hmToken),
    payload: { email: `candidate@${slug}.cpf.test`, fullName: "Test Candidate" },
  });
  expect(candidate.statusCode, candidate.body).toBe(201);

  const invitation = await app.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/invitations`,
    headers: authed(hmToken),
    payload: { candidateId: candidate.json().id, jobProfileId: job.json().id, templateCode },
  });
  expect(invitation.statusCode, invitation.body).toBe(201);
  const candidateToken = invitation.json().candidateAccessToken as string;

  const landing = await app.inject({ method: "GET", url: `/v1/candidate/${candidateToken}` });
  expect(landing.statusCode, landing.body).toBe(200);

  const accept = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/accept` });
  expect(accept.statusCode, accept.body).toBe(201);
  const sessionId = accept.json().sessionId as string;

  const ack = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/disclosure/acknowledge` });
  expect(ack.statusCode, ack.body).toBe(200);
  const start = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/start` });
  expect(start.statusCode, start.body).toBe(200);
  const submit = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/submit` });
  expect(submit.statusCode, submit.body).toBe(200);

  const assign = await app.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/sessions/${sessionId}/reviews`,
    headers: authed(adminToken),
    payload: { reviewerUserId: reviewerId },
  });
  expect(assign.statusCode, assign.body).toBe(201);
  const reviewId = assign.json().reviewId as string;

  const template = (await app.inject({ method: "GET", url: `/v1/framework/templates/${templateCode}` })).json();
  const scores = template.criteria.map((c: { id: string }) => ({
    criterionId: c.id,
    reviewer1Score: 4,
    evidenceNote: `Evidence for ${c.id}.`,
    confidence: "medium",
  }));
  const saveScores = await app.inject({
    method: "PUT",
    url: `/v1/orgs/${orgId}/reviews/${reviewId}/scores`,
    headers: authed(reviewerToken),
    payload: { scores },
  });
  expect(saveScores.statusCode, saveScores.body).toBe(200);

  const finalise = await app.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/reviews/${reviewId}/finalise`,
    headers: authed(reviewerToken),
    payload: {
      rationale: "Consistent, well-verified evidence across every criterion observed in the transcript.",
      confidence: "high",
      limitations: "Single-reviewer pass only.",
    },
  });
  expect(finalise.statusCode, finalise.body).toBe(200);

  const issueReport = await app.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/sessions/${sessionId}/issue-report`,
    headers: authed(adminToken),
  });
  expect(issueReport.statusCode, issueReport.body).toBe(200);

  return { orgId, adminToken };
}

run("CPF platform analytics + reviewer-minutes telemetry (Step 39)", () => {
  let orgFixture: FinalisedFixture;
  let hmToken: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    // Idempotent re-run safety: platform-level k-anonymity assertions below
    // count DISTINCT organisations per template, so leftover orgs from a
    // prior run of this file would silently push a template past the
    // suppression threshold. This file runs first alphabetically, so it's
    // always safe to start from a clean slate (see cpf-repo-notes.md).
    await admin.query(
      `TRUNCATE invitation_lookup, data_rights_requests, legal_holds, evidence_ledger_claims,
         criterion_scores, reviews, evidence_events, disclosure_records,
         assessment_sessions, invitations, candidates, job_profiles, org_memberships CASCADE`,
    );

    orgFixture = await setupOrgWithFinalisedSession(`it-analytics-org-${RUN_ID}`, "SE1");

    // A second, uninvolved org member to assert the 403 boundary.
    const hmId = await createActiveUser(`analytics-hm-${RUN_ID}@it.cpf.test`);
    await addMembership(orgFixture.orgId, hmId, "hiring_manager");
    hmToken = await login(`analytics-hm-${RUN_ID}@it.cpf.test`);

    // Candidate files a data-rights "challenge" against the report — feeds challengeRate.
    const candidateRow = await admin.query<{ id: string }>(
      `SELECT c.id FROM candidates c
         JOIN invitations i ON i.candidate_id = c.id
         JOIN assessment_sessions s ON s.invitation_id = i.id
        WHERE s.organisation_id = $1 AND s.status = 'report_issued' LIMIT 1`,
      [orgFixture.orgId],
    );
    await admin.query(
      `INSERT INTO data_rights_requests (organisation_id, candidate_id, request_type, due_at)
       VALUES ($1, $2, 'challenge'::data_rights_type, now() + interval '30 days')`,
      [orgFixture.orgId, candidateRow.rows[0]!.id],
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("org_admin sees own-org analytics: assessments by status/template, reviewer minutes, completion + challenge rate", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgFixture.orgId}/analytics`,
      headers: authed(orgFixture.adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();

    expect(body.assessmentsByStatus.some((r: { status: string; count: number }) => r.status === "report_issued" && r.count >= 1)).toBe(true);

    const se1 = body.byTemplate.find((r: { templateCode: string }) => r.templateCode === "SE1");
    expect(se1).toBeDefined();
    expect(se1.sessionCount).toBeGreaterThanOrEqual(1);
    expect(typeof se1.medianReviewerMinutes).toBe("number");
    expect(se1.medianReviewerMinutes).toBeGreaterThanOrEqual(0);

    expect(body.completionRate.startedCount).toBeGreaterThanOrEqual(1);
    expect(body.completionRate.completedCount).toBeGreaterThanOrEqual(1);
    expect(body.completionRate.rate).toBeGreaterThan(0);
    expect(body.completionRate.rate).toBeLessThanOrEqual(1);
    expect(typeof body.completionRate.definition).toBe("string");

    expect(body.challengeRate.reportedCount).toBeGreaterThanOrEqual(1);
    expect(body.challengeRate.challengedCount).toBeGreaterThanOrEqual(1);
    expect(body.challengeRate.rate).toBeGreaterThan(0);
  });

  it("a non-admin org member is denied (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgFixture.orgId}/analytics`,
      headers: authed(hmToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("analytics never leaks another organisation's data (tenant isolation)", async () => {
    const otherOrgId = await createOrg(`it-analytics-other-${RUN_ID}`);
    const otherAdminId = await createActiveUser(`analytics-other-admin-${RUN_ID}@it.cpf.test`);
    await addMembership(otherOrgId, otherAdminId, "org_admin");
    const otherAdminToken = await login(`analytics-other-admin-${RUN_ID}@it.cpf.test`);

    const res = await app.inject({
      method: "GET",
      url: `/v1/orgs/${otherOrgId}/analytics`,
      headers: authed(otherAdminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().assessmentsByStatus).toEqual([]);
    expect(res.json().byTemplate).toEqual([]);
  });

  it("platform_admin sees cross-org analytics with k-anonymity suppression per template", async () => {
    // DM2 used by only 2 orgs (< 5) → suppressed. SE3 used by 5 distinct orgs → not suppressed.
    await setupOrgWithFinalisedSession(`it-plat-dm2-a-${RUN_ID}`, "DM2");
    await setupOrgWithFinalisedSession(`it-plat-dm2-b-${RUN_ID}`, "DM2");
    for (let i = 0; i < 5; i++) {
      await setupOrgWithFinalisedSession(`it-plat-se3-${i}-${RUN_ID}`, "SE3");
    }

    const platformAdminId = await createActiveUser(`analytics-platform-admin-${RUN_ID}@it.cpf.test`);
    // platform_admin membership has no organisation scope in this schema's
    // sense of org-scoped roles, but the existing convention (subscriptions.ts,
    // support-access.ts) grants it against any one real org row.
    const anchorOrgId = await createOrg(`it-plat-anchor-${RUN_ID}`);
    await addMembership(anchorOrgId, platformAdminId, "platform_admin");
    const platformToken = await login(`analytics-platform-admin-${RUN_ID}@it.cpf.test`);

    const res = await app.inject({
      method: "GET",
      url: "/v1/platform/analytics",
      headers: authed(platformToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();

    const dm2 = body.byTemplate.find((r: { templateCode: string }) => r.templateCode === "DM2");
    expect(dm2.suppressed).toBe(true);
    expect(dm2.sessionCount).toBeNull();
    expect(dm2.medianReviewerMinutes).toBeNull();

    const se3 = body.byTemplate.find((r: { templateCode: string }) => r.templateCode === "SE3");
    expect(se3.suppressed).toBe(false);
    expect(se3.sessionCount).toBeGreaterThanOrEqual(5);
    expect(typeof se3.medianReviewerMinutes).toBe("number");

    expect(typeof body.suppressionNote).toBe("string");
    expect(
      body.totalAssessmentsByStatus.some((r: { status: string; count: number }) => r.status === "report_issued" && r.count >= 1),
    ).toBe(true);
  }, 120_000);

  it("a non-platform-admin is denied (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/platform/analytics",
      headers: authed(orgFixture.adminToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
