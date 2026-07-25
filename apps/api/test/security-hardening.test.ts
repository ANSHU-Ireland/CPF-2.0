/**
 * Step 29 (delivery plan): threat-model refresh + security review checkpoint.
 * Two independent hardening checks:
 *
 *  1. Log redaction — the exact `redact` config the real server logger uses
 *     (LOG_REDACT_PATHS, shared with src/app.ts) never lets an Authorization
 *     header value reach log output, verified two ways: a direct unit test
 *     of the redact config against a raw pino instance, and an end-to-end
 *     capture of a real authenticated request's log output.
 *
 *  2. Evidence-ingestion fuzzing — malformed JSON, oversized bodies, unicode,
 *     and prototype-pollution-shaped keys sent to the one endpoint that
 *     accepts candidate-authored JSON payloads and stores them verbatim
 *     (POST /v1/candidate/:token/events). Every case must resolve to a safe,
 *     well-classified 4xx/2xx — never a 500 — and must never actually
 *     mutate the shared Object.prototype of the running process.
 */
import { PassThrough } from "node:stream";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { hashPassword } from "@cpf/identity";
import { buildApp } from "../src/app.js";
import { closePool, getPool } from "../src/db/pool.js";
import { LOG_REDACT_PATHS } from "../src/modules/constants.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = describe.runIf(Boolean(DATABASE_URL && DATABASE_ADMIN_URL));
const PW = "a-long-test-password-1234";

function collectStream(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return { stream, text: () => Buffer.concat(chunks).toString("utf8") };
}

describe("log redaction (Step 29)", () => {
  it("redacts the exact config the server logger uses, so a raw secret token is never emitted", () => {
    const { stream, text } = collectStream();
    const logger = pino({ redact: LOG_REDACT_PATHS }, stream);
    logger.info({ req: { headers: { authorization: "Bearer super-secret-token-value", cookie: "sid=abc123" } } }, "test log line");
    const out = text();
    expect(out).not.toContain("super-secret-token-value");
    expect(out).not.toContain("sid=abc123");
    expect(out).toContain("[Redacted]");
  });
});

run("evidence ingestion fuzz + end-to-end log capture (Step 29)", () => {
  let app: FastifyInstance;
  let admin: pg.Client;
  let candidateToken: string;

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
       ON CONFLICT (slug) DO UPDATE SET updated_at = now() RETURNING id`,
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

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_ADMIN_URL });
    await admin.connect();
    app = buildApp({ databaseUrl: DATABASE_URL! });
    await app.ready();

    // Idempotent re-run safety: clear any residual rows from a prior run of
    // this file (org/user rows are upserted, but candidates/invitations/
    // sessions/events are not).
    await admin.query(
      `TRUNCATE invitation_lookup, assessment_sessions, invitations, candidates, job_profiles,
         evidence_events, disclosure_records, org_memberships CASCADE`,
    );

    const orgId = await createOrg("it-fuzz-org");
    const hmId = await createActiveUser("fuzz-hm@it.cpf.test");
    await addMembership(orgId, hmId, "hiring_manager");
    const hmToken = await login("fuzz-hm@it.cpf.test");

    const job = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/job-profiles`,
      headers: { authorization: `Bearer ${hmToken}` },
      payload: { title: "Fuzz Target Engineer", roleFamily: "software-engineering" },
    });
    expect(job.statusCode, job.body).toBe(201);

    const candidate = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/candidates`,
      headers: { authorization: `Bearer ${hmToken}` },
      payload: { email: "fuzz-candidate@candidate.test", fullName: "Fuzz Candidate" },
    });
    expect(candidate.statusCode, candidate.body).toBe(201);

    const invitation = await app.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: { authorization: `Bearer ${hmToken}` },
      payload: { candidateId: candidate.json().id, jobProfileId: job.json().id, templateCode: "SE1" },
    });
    expect(invitation.statusCode, invitation.body).toBe(201);
    candidateToken = invitation.json().candidateAccessToken;

    expect((await app.inject({ method: "GET", url: `/v1/candidate/${candidateToken}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/accept` })).statusCode).toBe(201);
    expect(
      (await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/disclosure/acknowledge` })).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: "POST", url: `/v1/candidate/${candidateToken}/start` })).statusCode).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
    await admin?.end();
  });

  it("returns 400, not 500, for a malformed JSON body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: '{"category": "workspace_evidence", "eventType": "prompt_submitted", payload: not-json}',
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode, res.body).toBe(400);
    const body = res.json();
    expect(body.error.code).not.toBe("INTERNAL_ERROR");
    expect(res.body).not.toContain("SyntaxError");
    expect(res.body).not.toContain(".ts:");
    expect(res.body).not.toContain(".js:");
  });

  it("rejects an oversized body at the transport layer, not with a 500", async () => {
    const hugeText = "x".repeat(300_000); // exceeds the 256 KiB bodyLimit
    const res = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "workspace_evidence", eventType: "prompt_submitted", payload: { text: hugeText } },
    });
    expect(res.statusCode, res.body).toBe(413);
    expect(res.json().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects an oversized event payload under the application-level limit with 413", async () => {
    const bigText = "x".repeat(40_000); // under 256 KiB transport limit, over MAX_EVENT_PAYLOAD_BYTES (32 KiB)
    const res = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "workspace_evidence", eventType: "prompt_submitted", payload: { text: bigText } },
    });
    expect(res.statusCode, res.body).toBe(413);
    expect(res.json().error.code).toBe("EVENT_TOO_LARGE");
  });

  it("accepts and faithfully stores unicode content (emoji, CJK, RTL)", async () => {
    const unicodeText = "héllo 🎉🚀 世界 שלום مرحبا";
    const res = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "workspace_evidence", eventType: "prompt_submitted", payload: { text: unicodeText } },
    });
    expect(res.statusCode, res.body).toBe(201);
    const stored = await admin.query<{ payload: { text: string } }>(
      "SELECT payload FROM evidence_events WHERE event_type = 'prompt_submitted' ORDER BY id DESC LIMIT 1",
    );
    expect(stored.rows[0]?.payload.text).toBe(unicodeText);
  });

  it("stores prototype-pollution-shaped keys as inert data without ever polluting Object.prototype", async () => {
    const maliciousPayload = JSON.parse(
      '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted2": "yes"}}, "normalField": "kept"}',
    ) as Record<string, unknown>;

    const res = await app.inject({
      method: "POST",
      url: `/v1/candidate/${candidateToken}/events`,
      payload: { category: "workspace_evidence", eventType: "prompt_submitted", payload: maliciousPayload },
    });

    // Whatever the app decides (accept-as-data or reject), it must never crash…
    expect([201, 400, 422]).toContain(res.statusCode);
    // …and must never actually pollute the shared prototype of the running process.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);

    if (res.statusCode === 201) {
      const stored = await admin.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM evidence_events WHERE event_type = 'prompt_submitted' ORDER BY id DESC LIMIT 1",
      );
      // Stored purely as inert JSON data — the malicious keys are just strings in a jsonb column.
      expect(stored.rows[0]?.payload.normalField).toBe("kept");
    }
  });

  it("never lets a real bearer token reach log output for an authenticated request", async () => {
    const { stream, text } = collectStream();
    const loggedApp = buildApp({ databaseUrl: DATABASE_URL!, loggerStream: stream });
    await loggedApp.ready();
    const secretToken = "definitely-a-secret-bearer-value-12345";
    await loggedApp.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${secretToken}` },
    });
    await loggedApp.close();
    expect(text()).not.toContain(secretToken);
  });
});
