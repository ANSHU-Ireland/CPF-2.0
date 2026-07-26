/**
 * AI gateway (Delivery Plan Step 45, ADR-0005): org-level kill switch,
 * platform-level kill switch, budget exhaustion, PII redaction, and full
 * invocation logging for the reviewer-assist endpoint (AIF-01).
 *
 * HARD GATE this file asserts: with no `aiGateway` build option supplied at
 * all (the real production default), the endpoint returns
 * AI_PROVIDER_NOT_CONFIGURED — Phase 1 ships zero AI product features by
 * default, even for an org that is both plan-entitled and has opted in.
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

let appDefault: FastifyInstance; // no aiGateway option at all — the real production default
let appEnabled: FastifyInstance; // platform+stub configured, generous budget
let appPlatformKilled: FastifyInstance; // stub configured but platformEnabled: false
let appTinyBudget: FastifyInstance; // platform+stub configured, 1-token daily budget
let appEcho: FastifyInstance; // stub echoes back the (redacted) text it received — for redaction/exclusion assertions
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

async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PW } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token;
}

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

const CANDIDATE_NAME = "Priya Sharma";
const CANDIDATE_EMAIL_MARKER = "priya.sharma.marker@candidate.test";
const INTEGRITY_ONLY_MARKER = "SECRET_INTEGRITY_ONLY_MARKER_9f21";

interface Fixture {
  orgId: string;
  adminToken: string;
  reviewerToken: string;
  reviewId: string;
}

/** Org + entitled + opted-in + one assigned review with workspace evidence containing PII, and a separate integrity-signal event. */
async function setupFixture(slug: string): Promise<Fixture> {
  const orgId = await createOrg(slug);
  const adminId = await createActiveUser(`${slug}-admin@it.cpf.test`);
  const hmId = await createActiveUser(`${slug}-hm@it.cpf.test`);
  const reviewerId = await createActiveUser(`${slug}-reviewer@it.cpf.test`);
  await addMembership(orgId, adminId, "org_admin");
  await addMembership(orgId, hmId, "hiring_manager");
  await addMembership(orgId, reviewerId, "reviewer");

  const adminToken = await login(appEnabled, `${slug}-admin@it.cpf.test`);
  const hmToken = await login(appEnabled, `${slug}-hm@it.cpf.test`);
  const reviewerToken = await login(appEnabled, `${slug}-reviewer@it.cpf.test`);

  await admin.query(
    `INSERT INTO plans (code, name, module_entitlements, limits)
     VALUES ($1, $1, '{"assessments":true,"ai_gateway":true}'::jsonb, '{}'::jsonb)
     ON CONFLICT (code) DO NOTHING`,
    [`it-ai-gateway-${slug}`],
  );
  await admin.query(
    `INSERT INTO org_subscriptions (organisation_id, plan_id)
     SELECT $1, id FROM plans WHERE code = $2
     ON CONFLICT (organisation_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = now()`,
    [orgId, `it-ai-gateway-${slug}`],
  );

  const enableSettings = await appEnabled.inject({
    method: "PUT",
    url: `/v1/orgs/${orgId}/ai/settings`,
    headers: authed(adminToken),
    payload: { enabled: true },
  });
  expect(enableSettings.statusCode, enableSettings.body).toBe(200);

  const job = await appEnabled.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/job-profiles`,
    headers: authed(hmToken),
    payload: { title: "Engineer", roleFamily: "software-engineering" },
  });
  expect(job.statusCode, job.body).toBe(201);

  const candidate = await appEnabled.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/candidates`,
    headers: authed(hmToken),
    payload: { email: `candidate@${slug}.cpf.test`, fullName: CANDIDATE_NAME },
  });
  expect(candidate.statusCode, candidate.body).toBe(201);

  const invitation = await appEnabled.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/invitations`,
    headers: authed(hmToken),
    payload: { candidateId: candidate.json().id, jobProfileId: job.json().id, templateCode: "SE1" },
  });
  expect(invitation.statusCode, invitation.body).toBe(201);
  const candidateToken = invitation.json().candidateAccessToken as string;

  const landing = await appEnabled.inject({ method: "GET", url: `/v1/candidate/${candidateToken}` });
  expect(landing.statusCode, landing.body).toBe(200);
  const accept = await appEnabled.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/accept` });
  expect(accept.statusCode, accept.body).toBe(201);
  const sessionId = accept.json().sessionId as string;
  const ack = await appEnabled.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/disclosure/acknowledge` });
  expect(ack.statusCode, ack.body).toBe(200);
  const start = await appEnabled.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/start` });
  expect(start.statusCode, start.body).toBe(200);

  // Workspace evidence containing the candidate's name and an e-mail marker (both should be redacted).
  await admin.query(
    `INSERT INTO evidence_events (organisation_id, session_id, category, event_type, payload)
     VALUES
       ($1, $2, 'workspace_evidence', 'prompt', $3::jsonb),
       ($1, $2, 'integrity_signal', 'focus_loss', $4::jsonb)`,
    [
      orgId,
      sessionId,
      JSON.stringify({ note: `${CANDIDATE_NAME} (${CANDIDATE_EMAIL_MARKER}) wrote three unit tests before implementing the function.` }),
      JSON.stringify({ note: INTEGRITY_ONLY_MARKER }),
    ],
  );

  const submit = await appEnabled.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/submit` });
  expect(submit.statusCode, submit.body).toBe(200);

  const calibrate = await appEnabled.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/reviewer-calibrations`,
    headers: authed(adminToken),
    payload: { reviewerUserId: reviewerId, frameworkVersion: "0.1.0" },
  });
  expect(calibrate.statusCode, calibrate.body).toBe(201);

  const assign = await appEnabled.inject({
    method: "POST",
    url: `/v1/orgs/${orgId}/sessions/${sessionId}/reviews`,
    headers: authed(adminToken),
    payload: { reviewerUserId: reviewerId },
  });
  expect(assign.statusCode, assign.body).toBe(201);
  const reviewId = assign.json().reviewId as string;

  return { orgId, adminToken, reviewerToken, reviewId };
}

async function latestInvocation(orgId: string): Promise<{ status: string; error_code: string | null; redactions_applied: string[] } | undefined> {
  const result = await admin.query<{ status: string; error_code: string | null; redactions_applied: string[] }>(
    `SELECT status, error_code, redactions_applied FROM model_invocations
      WHERE organisation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orgId],
  );
  return result.rows[0];
}

run("AI gateway (Delivery Plan Step 45)", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();

    appDefault = buildApp({ databaseUrl: DATABASE_URL! });
    appEnabled = buildApp({
      databaseUrl: DATABASE_URL!,
      aiGateway: {
        platformEnabled: true,
        isTestEnv: true,
        testStubResponse: "Consider highlighting the candidate's testing discipline.",
        allowedModel: "fixture-model",
        allowedModelVersion: "v1",
        region: "eu",
        timeoutMs: 5_000,
        dailyTokenBudget: 50_000,
        dailyCostBudgetUsdCents: 500,
      },
    });
    appPlatformKilled = buildApp({
      databaseUrl: DATABASE_URL!,
      aiGateway: {
        platformEnabled: false,
        isTestEnv: true,
        testStubResponse: "should never be returned",
        allowedModel: "fixture-model",
        allowedModelVersion: "v1",
        region: "eu",
        timeoutMs: 5_000,
        dailyTokenBudget: 50_000,
        dailyCostBudgetUsdCents: 500,
      },
    });
    appTinyBudget = buildApp({
      databaseUrl: DATABASE_URL!,
      aiGateway: {
        platformEnabled: true,
        isTestEnv: true,
        testStubResponse: "should never be returned",
        allowedModel: "fixture-model",
        allowedModelVersion: "v1",
        region: "eu",
        timeoutMs: 5_000,
        dailyTokenBudget: 1,
        dailyCostBudgetUsdCents: 500,
      },
    });
    appEcho = buildApp({
      databaseUrl: DATABASE_URL!,
      aiGateway: {
        platformEnabled: true,
        isTestEnv: true,
        testStubEcho: true,
        allowedModel: "fixture-model",
        allowedModelVersion: "v1",
        region: "eu",
        timeoutMs: 5_000,
        dailyTokenBudget: 50_000,
        dailyCostBudgetUsdCents: 500,
      },
    });
    await Promise.all([
      appDefault.ready(),
      appEnabled.ready(),
      appPlatformKilled.ready(),
      appTinyBudget.ready(),
      appEcho.ready(),
    ]);
  }, 120_000);

  afterAll(async () => {
    await appDefault?.close();
    await appEnabled?.close();
    await appPlatformKilled?.close();
    await appTinyBudget?.close();
    await appEcho?.close();
    await admin?.end();
    await closePool();
  });

  it("is disabled by default (no aiGateway option supplied — the real production default): AI_PROVIDER_NOT_CONFIGURED, and the block is logged", async () => {
    const fixture = await setupFixture(`default-${RUN_ID}`);
    const res = await appDefault.inject({
      method: "POST",
      url: `/v1/orgs/${fixture.orgId}/reviews/${fixture.reviewId}/ai-assist`,
      headers: authed(fixture.reviewerToken),
    });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json().error.code).toBe("AI_PROVIDER_NOT_CONFIGURED");

    const invocation = await latestInvocation(fixture.orgId);
    expect(invocation?.status).toBe("error");
    expect(invocation?.error_code).toBe("AI_PROVIDER_NOT_CONFIGURED");
  });

  it("blocks on the org-level kill switch (org_ai_settings.enabled=false) before ever reaching the gateway", async () => {
    const fixture = await setupFixture(`orgkill-${RUN_ID}`);
    const disable = await appEnabled.inject({
      method: "PUT",
      url: `/v1/orgs/${fixture.orgId}/ai/settings`,
      headers: authed(fixture.adminToken),
      payload: { enabled: false },
    });
    expect(disable.statusCode, disable.body).toBe(200);

    const res = await appEnabled.inject({
      method: "POST",
      url: `/v1/orgs/${fixture.orgId}/reviews/${fixture.reviewId}/ai-assist`,
      headers: authed(fixture.reviewerToken),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("AI_NOT_ENABLED");
  });

  it("blocks on the platform-level kill switch even though the org has opted in, and the block is logged", async () => {
    const fixture = await setupFixture(`platkill-${RUN_ID}`);
    const res = await appPlatformKilled.inject({
      method: "POST",
      url: `/v1/orgs/${fixture.orgId}/reviews/${fixture.reviewId}/ai-assist`,
      headers: authed(fixture.reviewerToken),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe("AI_GATEWAY_KILLED");

    const invocation = await latestInvocation(fixture.orgId);
    expect(invocation?.status).toBe("killed");
    expect(invocation?.error_code).toBe("AI_GATEWAY_KILLED");
  });

  it("returns AI_BUDGET_EXHAUSTED once the daily token budget is exceeded, and the block is logged", async () => {
    const fixture = await setupFixture(`budget-${RUN_ID}`);
    const res = await appTinyBudget.inject({
      method: "POST",
      url: `/v1/orgs/${fixture.orgId}/reviews/${fixture.reviewId}/ai-assist`,
      headers: authed(fixture.reviewerToken),
    });
    expect(res.statusCode, res.body).toBe(429);
    expect(res.json().error.code).toBe("AI_BUDGET_EXHAUSTED");

    const invocation = await latestInvocation(fixture.orgId);
    expect(invocation?.status).toBe("budget_exhausted");
  });

  it("succeeds end to end: redacts the candidate's name+e-mail, excludes integrity signals, and logs a full invocation", async () => {
    const fixture = await setupFixture(`success-${RUN_ID}`);
    const res = await appEnabled.inject({
      method: "POST",
      url: `/v1/orgs/${fixture.orgId}/reviews/${fixture.reviewId}/ai-assist`,
      headers: authed(fixture.reviewerToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.label).toBe("AI suggestion — requires your judgement");
    expect(typeof body.suggestion).toBe("string");
    // Never applied automatically — the response is advisory text only, no session/review mutation field.
    expect(body).not.toHaveProperty("applied");

    const invocation = await latestInvocation(fixture.orgId);
    expect(invocation?.status).toBe("success");
    expect(invocation?.redactions_applied).toEqual(expect.arrayContaining(["email", "name"]));
  });

  it("never surfaces integrity-only content through the endpoint, and redacts the candidate's name+e-mail from the echoed prompt", async () => {
    const fixture = await setupFixture(`echo-${RUN_ID}`);
    const res = await appEcho.inject({
      method: "POST",
      url: `/v1/orgs/${fixture.orgId}/reviews/${fixture.reviewId}/ai-assist`,
      headers: authed(fixture.reviewerToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const suggestion = res.json().suggestion as string;

    // The candidate's name and e-mail were redacted before ever reaching the adapter.
    expect(suggestion).not.toContain(CANDIDATE_NAME);
    expect(suggestion).not.toContain(CANDIDATE_EMAIL_MARKER);
    expect(suggestion).toContain("[REDACTED_NAME]");
    expect(suggestion).toContain("[REDACTED_EMAIL]");
    // Integrity signals never entered the prompt at all (structural exclusion, not just redaction).
    expect(suggestion).not.toContain(INTEGRITY_ONLY_MARKER);
  });
});
