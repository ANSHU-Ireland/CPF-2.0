import { describe, expect, it } from "vitest";
import { AiGateway } from "../src/gateway.js";
import { AiBudgetExhaustedError } from "../src/budget.js";
import { AiModelNotAllowedError } from "../src/allow-list.js";
import { AiGatewayKilledError } from "../src/kill-switch.js";
import { StubFixtureAdapter } from "../src/adapters/stub-fixture.js";

const MODEL_PIN = { provider: "stub-fixture", model: "fixture-model", version: "v1" };

function buildGateway(overrides: Partial<{ maxAttempts: number }> = {}) {
  const adapter = new StubFixtureAdapter((userContent) => `Suggestion based on: ${userContent}`);
  return new AiGateway({
    adapter,
    allowList: [MODEL_PIN],
    costPerInputTokenUsdCents: 0.01,
    costPerOutputTokenUsdCents: 0.02,
    timeoutMs: 1000,
    retry: { maxAttempts: overrides.maxAttempts ?? 1, baseDelayMs: 1 },
  });
}

const baseParams = {
  useCase: "reviewer_assist",
  promptVersion: "v1",
  model: MODEL_PIN.model,
  version: MODEL_PIN.version,
  systemPrompt: "You are a careful reviewer assistant.",
  region: "eu" as const,
  killSwitch: { platformEnabled: true, orgEnabled: true },
  budget: { limits: { tokensPerDay: 100_000, costCapUsdCents: 100_000 }, usage: { tokensUsedToday: 0, costUsedUsdCentsToday: 0 } },
};

describe("AiGateway.complete", () => {
  it("completes successfully and returns a full invocation record", async () => {
    const gateway = buildGateway();
    const { text, invocation } = await gateway.complete({ ...baseParams, userContent: "candidate ran three tests" });

    expect(text).toContain("Suggestion based on");
    expect(invocation.status).toBe("success");
    expect(invocation.provider).toBe("stub-fixture");
    expect(invocation.model).toBe(MODEL_PIN.model);
    expect(invocation.modelVersion).toBe(MODEL_PIN.version);
    expect(invocation.region).toBe("eu");
    expect(invocation.inputTokens).toBeGreaterThan(0);
    expect(invocation.outputTokens).toBeGreaterThan(0);
    expect(invocation.redactionsApplied).toEqual([]);
  });

  it("redacts PII before the adapter ever sees it, and records the redaction categories", async () => {
    const gateway = buildGateway();
    const { text, invocation } = await gateway.complete({
      ...baseParams,
      userContent: "Jane Doe (jane@example.com) wrote this code.",
      knownNames: ["Jane Doe"],
    });

    expect(text).not.toContain("Jane Doe");
    expect(text).not.toContain("jane@example.com");
    expect(text).toContain("[REDACTED_NAME]");
    expect(text).toContain("[REDACTED_EMAIL]");
    expect(invocation.redactionsApplied).toEqual(["email", "name"]);
  });

  it("throws AI_GATEWAY_KILLED and never calls the adapter when the org switch is off", async () => {
    const gateway = buildGateway();
    await expect(
      gateway.complete({ ...baseParams, userContent: "x", killSwitch: { platformEnabled: true, orgEnabled: false } }),
    ).rejects.toBeInstanceOf(AiGatewayKilledError);
  });

  it("throws AI_GATEWAY_KILLED when the platform switch is off, regardless of the org switch", async () => {
    const gateway = buildGateway();
    await expect(
      gateway.complete({ ...baseParams, userContent: "x", killSwitch: { platformEnabled: false, orgEnabled: true } }),
    ).rejects.toBeInstanceOf(AiGatewayKilledError);
  });

  it("throws AI_MODEL_NOT_ALLOWED for a model outside the allow-list", async () => {
    const gateway = buildGateway();
    await expect(
      gateway.complete({ ...baseParams, userContent: "x", version: "unpinned-version" }),
    ).rejects.toBeInstanceOf(AiModelNotAllowedError);
  });

  it("throws AI_BUDGET_EXHAUSTED when the estimated call would exceed the token budget", async () => {
    const gateway = buildGateway();
    await expect(
      gateway.complete({
        ...baseParams,
        userContent: "x",
        budget: { limits: { tokensPerDay: 1, costCapUsdCents: 100_000 }, usage: { tokensUsedToday: 0, costUsedUsdCentsToday: 0 } },
      }),
    ).rejects.toBeInstanceOf(AiBudgetExhaustedError);
  });

  it("retries a transient adapter failure and still logs a successful invocation", async () => {
    let calls = 0;
    const flakyAdapter = new StubFixtureAdapter(() => {
      calls += 1;
      if (calls < 2) throw new Error("transient network error");
      return "recovered suggestion";
    });
    const gateway = new AiGateway({
      adapter: flakyAdapter,
      allowList: [MODEL_PIN],
      costPerInputTokenUsdCents: 0.01,
      costPerOutputTokenUsdCents: 0.02,
      timeoutMs: 1000,
      retry: { maxAttempts: 3, baseDelayMs: 1 },
    });

    const { text, invocation } = await gateway.complete({ ...baseParams, userContent: "x" });
    expect(text).toBe("recovered suggestion");
    expect(invocation.status).toBe("success");
    expect(calls).toBe(2);
  });
});
