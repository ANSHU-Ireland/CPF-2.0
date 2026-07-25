import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("reports service health with security headers", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "cpf-api" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});

describe("framework catalogue", () => {
  it("lists all 10 templates as summaries", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/framework/templates" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(10);
    expect(body[0]).toMatchObject({ criteriaCount: 18, criticalCriteriaCount: 6 });
    // Summaries never embed the full rubric.
    expect(body[0].criteria).toBeUndefined();
  });

  it("serves a full template definition by code, case-insensitively", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/framework/templates/se1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe("SE1");
    expect(body.criteria).toHaveLength(18);
    expect(body.criteria[0].interviewProbe.length).toBeGreaterThan(0);
  });

  it("returns a machine-readable 404 for unknown templates", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/framework/templates/zz9" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("serves the scoring model", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/framework/scoring-model" });
    expect(res.statusCode).toBe(200);
    expect(res.json().dimensions).toHaveLength(10);
  });
});

describe("POST /v1/scoring/evaluate", () => {
  it("computes a decision-support evidence profile without any hiring outcome", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/scoring/evaluate",
      payload: {
        templateCode: "SE1",
        assessments: [
          {
            criterionId: "SE1-06",
            reviewer1Score: 4,
            evidenceNote: "Criterion-to-test mapping present; permission denial verified.",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decisionSupportRoute).toBe("incomplete_evidence_do_not_decide");
    expect(body.governanceNote).toContain("No automated hiring or placement outcome");
    expect(JSON.stringify(body).toLowerCase()).not.toContain('"recommendation"');
  });

  it("rejects malformed input with a validation error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/scoring/evaluate",
      payload: { templateCode: "SE1", assessments: [{ criterionId: "SE1-01", reviewer1Score: 9 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("returns 422 for scoring-domain input errors", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/scoring/evaluate",
      payload: {
        templateCode: "SE1",
        assessments: [{ criterionId: "DM1-01", reviewer1Score: 3 }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SCORING_INPUT_INVALID");
  });
});

describe("notification templates (CPF-37)", () => {
  it("HTML-escapes interpolated content so markup cannot be injected", async () => {
    const { invitationIssuedTemplate, activationTokenIssuedTemplate, dataRightsReceivedTemplate } = await import(
      "../src/modules/notifications/templates.js"
    );
    const malicious = '<script>alert("x")</script>';
    const invitation = invitationIssuedTemplate({ candidateName: malicious, jobTitle: malicious, orgName: malicious });
    expect(invitation.body).not.toContain("<script>");
    expect(invitation.body).toContain("&lt;script&gt;");

    const activation = activationTokenIssuedTemplate({ displayName: malicious });
    expect(activation.body).not.toContain("<script>");

    const dsr = dataRightsReceivedTemplate({ requestType: malicious, dueAt: malicious });
    expect(dsr.subject).not.toContain("<script>");
    expect(dsr.body).not.toContain("<script>");
  });

  it("never includes access/activation tokens in rendered bodies", async () => {
    const { invitationIssuedTemplate } = await import("../src/modules/notifications/templates.js");
    const rendered = invitationIssuedTemplate({ candidateName: "Priya", jobTitle: "Engineer", orgName: "Acme" });
    expect(rendered.body).not.toMatch(/[A-Za-z0-9_-]{32,}/);
  });

  it("console mail adapter never logs the message body", async () => {
    const { consoleAdapter } = await import("../src/modules/notifications/mail.js");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      await consoleAdapter().send({ to: "a@b.test", subject: "Subject only", body: "SECRET_BODY_CONTENT" });
    } finally {
      console.log = originalLog;
    }
    expect(logs.join("\n")).not.toContain("SECRET_BODY_CONTENT");
    expect(logs.join("\n")).toContain("Subject only");
  });
});
