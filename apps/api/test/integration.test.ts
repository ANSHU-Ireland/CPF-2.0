/**
 * End-to-end integration suite — requires two connection strings:
 *   DATABASE_ADMIN_URL — privileged role for provisioning (migrations, seed, cleanup)
 *   DATABASE_URL       — the restricted cpf_api role the application runs as
 * Skipped when either is absent; CI provides both against PostgreSQL 16.
 *
 * Covers the directive's critical flows: full hiring journey, disclosure and
 * report gates, evidence ingestion guardrails, tenant isolation (API + RLS
 * backstop), audit-chain integrity, erasure with legal holds, login lockout,
 * and TOTP MFA.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { hashPassword, totp } from "@cpf/identity";
import { buildApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/pool.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = describe.runIf(Boolean(DATABASE_URL && DATABASE_ADMIN_URL));

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const SEED_FILE = join(import.meta.dirname, "..", "..", "..", "packages", "db", "seed", "generated", "seed.sql");

let app: FastifyInstance;
let admin: pg.Client;

interface Session {
  token: string;
  orgId: string;
}

async function provisionDatabase(): Promise<void> {
  admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT to_regclass('public.organisations') AS t");
  if (!exists.rows[0].t) {
    for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
      await admin.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
  }
  // The application role under test: LOGIN member of cpf_app (idempotent).
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cpf_api') THEN
        CREATE ROLE cpf_api LOGIN PASSWORD 'cpf_local_dev' IN ROLE cpf_app;
      END IF;
    END $$;`);
  const seeded = await admin.query("SELECT count(*)::int AS n FROM assessment_template_versions");
  if (seeded.rows[0].n === 0) {
    await admin.query(readFileSync(SEED_FILE, "utf8"));
  }
  // Guard: the app pool must NOT be a superuser, or RLS assertions are meaningless.
  const appProbe = new pg.Client({ connectionString: DATABASE_URL });
  await appProbe.connect();
  const su = await appProbe.query("SELECT usesuper FROM pg_user WHERE usename = current_user");
  await appProbe.end();
  if (su.rows[0]?.usesuper) {
    throw new Error(
      "DATABASE_URL must use the restricted cpf_api role — superusers bypass row-level security and would mask isolation defects.",
    );
  }
}

/** Test fixture: create an ACTIVE user directly (activation flow tested separately). */
async function createActiveUser(email: string, password: string): Promise<string> {
  const hash = await hashPassword(password);
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, password_hash)
     VALUES ($1, $2, 'active', $3)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, status = 'active',
       mfa_enrolled = false, totp_secret = NULL
     RETURNING id`,
    [email, `Test ${email}`, hash],
  );
  return result.rows[0]!.id;
}

async function createOrg(slug: string, type = "employer"): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO organisations (slug, name, type) VALUES ($1, $2, $3::organisation_type)
     ON CONFLICT (slug) DO UPDATE SET updated_at = now() RETURNING id`,
    [slug, `Org ${slug}`, type],
  );
  return result.rows[0]!.id;
}

async function addMembership(orgId: string, userId: string, role: string): Promise<void> {
  // org_memberships is FORCE RLS-protected: writes require tenant context.
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    await client.query(
      `INSERT INTO org_memberships (organisation_id, user_id, role)
       VALUES ($1, $2, $3::org_role)
       ON CONFLICT (organisation_id, user_id, role) DO NOTHING`,
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

async function login(email: string, password: string, totpCode?: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password, ...(totpCode ? { totpCode } : {}) },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token;
}

const authed = (token: string) => ({ authorization: `Bearer ${token}` });
const PW = "a-long-test-password-1234";

run("CPF platform end-to-end", () => {
  let orgA: Session;
  let orgB: Session;
  let hmToken: string;
  let reviewerToken: string;
  let reviewerUserId: string;
  let hmUserId: string;

  beforeAll(async () => {
    await provisionDatabase();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();
    // Clean slate for repeat runs — via the ADMIN connection (the application
    // role deliberately has no TRUNCATE privilege). users/organisations are
    // upserted; audit_log is append-only by design and kept.
    await admin.query(
      `TRUNCATE invitation_lookup, account_activation_tokens, auth_sessions,
         login_attempts, data_rights_requests, legal_holds, evidence_ledger_claims,
         criterion_scores, reviews, evidence_events, disclosure_records,
         assessment_sessions, invitations, candidates, job_profiles,
         retention_policies, org_memberships CASCADE`,
    );

    const orgAId = await createOrg("it-employer-a");
    const orgBId = await createOrg("it-employer-b");
    const adminA = await createActiveUser("admin-a@it.cpf.test", PW);
    const adminB = await createActiveUser("admin-b@it.cpf.test", PW);
    hmUserId = await createActiveUser("hm-a@it.cpf.test", PW);
    reviewerUserId = await createActiveUser("reviewer-a@it.cpf.test", PW);
    await addMembership(orgAId, adminA, "org_admin");
    await addMembership(orgBId, adminB, "org_admin");
    await addMembership(orgAId, hmUserId, "hiring_manager");
    await addMembership(orgAId, reviewerUserId, "reviewer");

    orgA = { token: await login("admin-a@it.cpf.test", PW), orgId: orgAId };
    orgB = { token: await login("admin-b@it.cpf.test", PW), orgId: orgBId };
    hmToken = await login("hm-a@it.cpf.test", PW);
    reviewerToken = await login("reviewer-a@it.cpf.test", PW);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  let candidateId: string;
  let candidateToken: string;
  let sessionId: string;
  let reviewId: string;

  it("runs the full hiring journey with every governance gate enforced", async () => {
    // Job profile + candidate.
    const job = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/job-profiles`,
      headers: authed(hmToken),
      payload: { title: "Backend Engineer", roleFamily: "software-engineering" },
    });
    expect(job.statusCode, job.body).toBe(201);
    const jobId = job.json().id;

    const candidate = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/candidates`,
      headers: authed(hmToken),
      payload: { email: "priya@candidate.test", fullName: "Priya Example" },
    });
    expect(candidate.statusCode, candidate.body).toBe(201);
    candidateId = candidate.json().id;

    // Duplicate candidate → 409 (BR-07).
    const dup = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/candidates`,
      headers: authed(hmToken),
      payload: { email: "priya@candidate.test", fullName: "Priya Duplicate" },
    });
    expect(dup.statusCode).toBe(409);

    // Invitation against the frozen SE1 template version.
    const invitation = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/invitations`,
      headers: authed(hmToken),
      payload: { candidateId, jobProfileId: jobId, templateCode: "SE1" },
    });
    expect(invitation.statusCode, invitation.body).toBe(201);
    candidateToken = invitation.json().candidateAccessToken;

    // Candidate portal: landing view.
    const landing = await app.inject({ method: "GET", url: `/v1/candidate/${candidateToken}` });
    expect(landing.statusCode).toBe(200);
    expect(landing.json().assessment.code).toBe("SE1");
    expect(landing.json().assessment.stages).toHaveLength(5);

    // Accept → session exists in disclosure_pending; starting now must fail (BR-01).
    const accept = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/accept` });
    expect(accept.statusCode, accept.body).toBe(201);
    sessionId = accept.json().sessionId;
    expect(accept.json().status).toBe("disclosure_pending");

    const prematureStart = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/start` });
    expect(prematureStart.statusCode).toBe(409);

    // Events before an active session are rejected by design.
    const prematureEvent = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "workspace_evidence", eventType: "prompt_submitted", payload: { text: "hello" } },
    });
    expect(prematureEvent.statusCode).toBe(409);

    // Disclosure acknowledgement → ready → start.
    const ack = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/disclosure/acknowledge` });
    expect(ack.statusCode, ack.body).toBe(200);
    expect(ack.json().status).toBe("ready");
    const start = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/start` });
    expect(start.json().status).toBe("in_progress");

    // Accommodation recorded (BR-09).
    const accommodation = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/accommodations`,
      payload: { note: "Extended time approved: +25% per documented need." },
    });
    expect(accommodation.statusCode).toBe(200);

    // Evidence ingestion: workspace event accepted; forbidden types & categories rejected (BR-06).
    const good = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "workspace_evidence", eventType: "prompt_submitted", payload: { text: "Plan the change" } },
    });
    expect(good.statusCode, good.body).toBe(201);
    const integrity = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "integrity_signal", eventType: "focus_lost", payload: { durationMs: 4200 } },
    });
    expect(integrity.statusCode).toBe(201);
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "workspace_evidence", eventType: "raw_keystroke", payload: { key: "a" } },
    });
    expect(forbidden.statusCode).toBe(422);
    expect(forbidden.json().error.code).toBe("EVENT_TYPE_FORBIDDEN");
    const wrongCategory = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "reviewer_decision", eventType: "sneaky", payload: {} },
    });
    expect(wrongCategory.statusCode).toBe(422);

    // Pause / resume (technical recovery), then submit.
    expect((await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/pause` })).json().status).toBe("paused");
    expect((await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/resume` })).json().status).toBe("in_progress");
    const submit = await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/submit` });
    expect(submit.json().status).toBe("submitted");

    // Report cannot be issued before review (BR-02, machine-enforced).
    const prematureReport = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/sessions/${sessionId}/issue-report`,
      headers: authed(orgA.token),
    });
    expect(prematureReport.statusCode).toBe(409);

    // Assign review: a hiring manager is not a reviewer → 422.
    const badAssign = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/sessions/${sessionId}/reviews`,
      headers: authed(orgA.token),
      payload: { reviewerUserId: hmUserId },
    });
    expect(badAssign.statusCode).toBe(422);
    const assign = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/sessions/${sessionId}/reviews`,
      headers: authed(orgA.token),
      payload: { reviewerUserId },
    });
    expect(assign.statusCode, assign.body).toBe(201);
    reviewId = assign.json().reviewId;

    // Reviewer sees evidence with integrity signals separated.
    const evidence = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgA.orgId}/reviews/${reviewId}/evidence`,
      headers: authed(reviewerToken),
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().workspaceEvidence).toHaveLength(1);
    expect(evidence.json().integrityContext.signals).toHaveLength(1);
    expect(evidence.json().integrityContext.guidance).toContain("never determine an outcome");

    // Unknown criterion rejected against the frozen version.
    const badScore = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgA.orgId}/reviews/${reviewId}/scores`,
      headers: authed(reviewerToken),
      payload: { scores: [{ criterionId: "DM1-01", reviewer1Score: 3 }] },
    });
    expect(badScore.statusCode).toBe(422);

    // Variance ≥ 2 forces adjudication before finalisation.
    const template = (await app.inject({ method: "GET", url: "/v1/framework/templates/SE1" })).json();
    const varianceScores = template.criteria.map((c: { id: string }, i: number) => ({
      criterionId: c.id,
      reviewer1Score: 4,
      ...(i === 0 ? { reviewer2Score: 2 } : {}),
      evidenceNote: `Observed evidence for ${c.id}.`,
      confidence: "medium",
    }));
    const saveVariance = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgA.orgId}/reviews/${reviewId}/scores`,
      headers: authed(reviewerToken),
      payload: { scores: varianceScores },
    });
    expect(saveVariance.statusCode, saveVariance.body).toBe(200);
    const blockedFinalise = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/reviews/${reviewId}/finalise`,
      headers: authed(reviewerToken),
      payload: {
        rationale: "Strong verification behaviour across two independent sources.",
        confidence: "medium-high",
        limitations: "Task did not test multi-service integration.",
      },
    });
    expect(blockedFinalise.statusCode).toBe(422);
    expect(blockedFinalise.json().error.code).toBe("ADJUDICATION_REQUIRED");

    // Adjudicate, preview, finalise.
    const adjudicated = await app.inject({
      method: "PUT",
      url: `/v1/orgs/${orgA.orgId}/reviews/${reviewId}/scores`,
      headers: authed(reviewerToken),
      payload: {
        scores: [{ criterionId: template.criteria[0].id, reviewer1Score: 4, reviewer2Score: 2, adjudicatedScore: 3, evidenceNote: "Adjudicated after discussion.", confidence: "medium" }],
      },
    });
    expect(adjudicated.statusCode).toBe(200);
    const preview = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgA.orgId}/reviews/${reviewId}/preview`,
      headers: authed(reviewerToken),
    });
    expect(preview.json().decisionSupportRoute).toBe("evidence_profile_ready_for_human_review");

    const finalise = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/reviews/${reviewId}/finalise`,
      headers: authed(reviewerToken),
      payload: {
        rationale: "Strong verification behaviour across two independent sources.",
        confidence: "medium-high",
        limitations: "Task did not test multi-service integration.",
      },
    });
    expect(finalise.statusCode, finalise.body).toBe(200);

    // Profile is gated until the report is issued.
    const early = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgA.orgId}/sessions/${sessionId}/evidence-profile`,
      headers: authed(hmToken),
    });
    expect(early.statusCode).toBe(409);
    const issue = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/sessions/${sessionId}/issue-report`,
      headers: authed(hmToken),
    });
    expect(issue.json().status).toBe("report_issued");

    const profile = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgA.orgId}/sessions/${sessionId}/evidence-profile`,
      headers: authed(hmToken),
    });
    expect(profile.statusCode).toBe(200);
    const body = profile.json();
    expect(body.dimensions).toHaveLength(10);
    expect(body.interviewProbes).toHaveLength(18);
    expect(body.accommodationsNote).toContain("Extended time");
    expect(body.governanceNote).toContain("No automated hiring or placement outcome");
    // The profile never contains outcome vocabulary or raw evidence.
    const raw = profile.body.toLowerCase();
    for (const forbiddenKey of ['"hire"', '"reject"', '"pass"', '"fail"', '"ranking"', "workspaceevidence"]) {
      expect(raw).not.toContain(forbiddenKey);
    }
  }, 120_000);

  it("enforces tenant isolation at API and RLS layers", async () => {
    // Org B sees nothing of org A.
    const listB = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgB.orgId}/candidates`,
      headers: authed(orgB.token),
    });
    expect(listB.json().items).toHaveLength(0);
    // Direct object reference across tenants → 404.
    const cross = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgB.orgId}/candidates/${candidateId}`,
      headers: authed(orgB.token),
    });
    expect(cross.statusCode).toBe(404);
    // Path-level role check → 403.
    const wrongOrg = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgA.orgId}/candidates`,
      headers: authed(orgB.token),
    });
    expect(wrongOrg.statusCode).toBe(403);
    // RLS backstop: no tenant context ⇒ zero rows even for the table owner.
    const bare = await getPool().query("SELECT count(*)::int AS n FROM candidates");
    expect(bare.rows[0].n).toBe(0);
  });

  it("maintains a verifiable, append-only audit chain", async () => {
    const verify = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgA.orgId}/audit/verify-chain`,
      headers: authed(orgA.token),
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().valid).toBe(true);
    expect(verify.json().entries).toBeGreaterThan(10);
    // Tampering is blocked twice over: no UPDATE grant for the application
    // role, and an append-only trigger as the backstop for privileged roles.
    await expect(
      getPool().query("UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT min(id) FROM audit_log)"),
    ).rejects.toThrow(/append-only|permission denied/);
    await expect(
      admin.query("UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT min(id) FROM audit_log)"),
    ).rejects.toThrow(/append-only/);
  });

  it("executes erasure through the data-rights workflow and respects legal holds", async () => {
    // Candidate raises an erasure request from the portal.
    const dsr = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/data-rights`,
      payload: { requestType: "erasure", detail: "Please delete my assessment data." },
    });
    expect(dsr.statusCode, dsr.body).toBe(201);
    const requestId = dsr.json().requestId;

    // A legal hold blocks fulfilment.
    const hold = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/legal-holds`,
      headers: authed(orgA.token),
      payload: { candidateId, reason: "Ongoing discrimination claim litigation." },
    });
    expect(hold.statusCode).toBe(201);
    for (const event of ["verify_identity", "begin"]) {
      const step = await app.inject({
        method: "POST",
        url: `/v1/orgs/${orgA.orgId}/data-rights/${requestId}/transition`,
        headers: authed(orgA.token),
        payload: { event },
      });
      expect(step.statusCode, step.body).toBe(200);
    }
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/data-rights/${requestId}/transition`,
      headers: authed(orgA.token),
      payload: { event: "fulfil" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("LEGAL_HOLD_ACTIVE");

    // Release the hold → erasure executes and verifies clean.
    const release = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/legal-holds/${hold.json().id}/release`,
      headers: authed(orgA.token),
    });
    expect(release.statusCode).toBe(200);
    const fulfil = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/data-rights/${requestId}/transition`,
      headers: authed(orgA.token),
      payload: { event: "fulfil" },
    });
    expect(fulfil.statusCode, fulfil.body).toBe(200);
    expect(fulfil.json().erasure.evidenceEvents).toBeGreaterThan(0);

    // Candidate token can no longer resolve; identity is anonymised.
    const dead = await app.inject({ method: "GET", url: `/v1/candidate/${candidateToken}` });
    expect(dead.statusCode).toBe(404);
    const anonymised = await app.inject({
      method: "GET",
      url: `/v1/orgs/${orgA.orgId}/candidates/${candidateId}`,
      headers: authed(orgA.token),
    });
    expect(anonymised.statusCode).toBe(200);
    expect(anonymised.json().status).toBe("anonymised");
    expect(anonymised.json().email).toContain("@anonymised.invalid");
    expect(anonymised.json().full_name).toBe("Erased on data-subject request");
  });

  it("activates invited users via single-use tokens and enforces password policy", async () => {
    const invite = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgA.orgId}/users`,
      headers: authed(orgA.token),
      payload: { email: "new-hm@it.cpf.test", displayName: "New HM", role: "hiring_manager" },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    const activationToken = invite.json().activationToken;

    const weak = await app.inject({
      method: "POST",
      url: "/v1/auth/activate",
      payload: { token: activationToken, password: "short" },
    });
    expect(weak.statusCode).toBe(422);
    expect(weak.json().error.code).toBe("PASSWORD_POLICY");

    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/activate",
      payload: { token: activationToken, password: PW },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    // Single-use: second attempt fails.
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/activate",
      payload: { token: activationToken, password: PW },
    });
    expect(reuse.statusCode).toBe(422);
    await login("new-hm@it.cpf.test", PW);
  }, 60_000);

  it("locks an account after repeated failed logins", async () => {
    await createActiveUser("lockout@it.cpf.test", PW);
    for (let i = 0; i < 5; i += 1) {
      const bad = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "lockout@it.cpf.test", password: "wrong-password-123" },
      });
      expect(bad.statusCode).toBe(401);
      expect(bad.json().error.code).toBe("INVALID_CREDENTIALS");
    }
    const locked = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "lockout@it.cpf.test", password: PW },
    });
    expect(locked.statusCode).toBe(423);
  }, 60_000);

  it("enrolls TOTP MFA and requires the code at login", async () => {
    await createActiveUser("mfa@it.cpf.test", PW);
    const token = await login("mfa@it.cpf.test", PW);
    const enroll = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/totp/enroll",
      headers: authed(token),
    });
    expect(enroll.statusCode).toBe(200);
    const secret = enroll.json().secret;
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/totp/verify",
      headers: authed(token),
      payload: { totpCode: totp(secret, Math.floor(Date.now() / 1000)) },
    });
    expect(verify.statusCode, verify.body).toBe(200);

    const withoutCode = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "mfa@it.cpf.test", password: PW },
    });
    expect(withoutCode.statusCode).toBe(401);
    expect(withoutCode.json().error.code).toBe("MFA_REQUIRED");
    await login("mfa@it.cpf.test", PW, totp(secret, Math.floor(Date.now() / 1000)));

    // Session revocation invalidates the bearer immediately.
    const logout = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: authed(token) });
    expect(logout.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: authed(token) });
    expect(me.statusCode).toBe(401);
  }, 60_000);
});

describe.runIf(!DATABASE_URL || !DATABASE_ADMIN_URL)("integration suite", () => {
  it.skip("skipped — DATABASE_URL / DATABASE_ADMIN_URL not set (runs in CI against PostgreSQL 16)", () => {});
});
