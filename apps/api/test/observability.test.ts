/**
 * Observability wiring (Delivery Plan Step 33).
 *
 * Covers: /metrics is off by default and only registered when explicitly
 * enabled; the enabled endpoint exposes the request-duration histogram in
 * Prometheus text format after real traffic; and trace context — when a
 * span is active — propagates all the way into a stored audit-log entry's
 * metadata (appendAudit is the single chokepoint every module writes
 * through, so this one flow proves the wiring for all of them).
 *
 * `currentTraceId` is mocked directly here rather than exercised through a
 * real OpenTelemetry context manager: with no SDK started (the default,
 * no-op-by-design state — see tracing.ts), `@opentelemetry/api`'s built-in
 * NoopContextManager doesn't actually track active spans at all, so there is
 * nothing realistic to propagate without also starting a real SDK. Mocking
 * the read exercises appendAudit's actual merge/hash/store logic (the part
 * this project owns) without depending on OTel SDK internals.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const FAKE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

vi.mock("../src/observability/tracing.js", () => ({
  currentTraceId: () => FAKE_TRACE_ID,
  startTracingIfConfigured: async () => undefined,
}));

const { appendAudit } = await import("../src/db/audit.js");
const { currentTraceId } = await import("../src/observability/tracing.js");

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /metrics", () => {
  it("is not registered by default", async () => {
    app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(404);
  });

  it("exposes the request-duration histogram in Prometheus text format when enabled", async () => {
    app = buildApp({ metricsEnabled: true });
    await app.ready();
    await app.inject({ method: "GET", url: "/health" });
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("http_request_duration_seconds");
    // /metrics itself is exempt from rate limiting, like /health.
    expect(res.body).toContain('route="/health"');
  });
});

describe("trace context in audit metadata", () => {
  it("currentTraceId() is mocked here to simulate an active span (real default is undefined — see security-hardening/unit coverage of the no-op path)", () => {
    expect(currentTraceId()).toBe(FAKE_TRACE_ID);
  });

  it("propagates the active span's trace id into the stored, hash-chained audit entry", async () => {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const fakeClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes("SELECT entry_hash FROM audit_log")) return { rows: [] };
        return { rows: [], rowCount: 0 };
      }),
    };

    await appendAudit(fakeClient as unknown as Parameters<typeof appendAudit>[0], {
      action: "test.instrumented_flow",
      entityType: "test",
    });

    const insert = calls.find((c) => c.sql.includes("INSERT INTO audit_log"));
    expect(insert).toBeDefined();
    const storedMetadata = JSON.parse(insert!.params![5] as string);
    expect(storedMetadata).toMatchObject({ traceId: FAKE_TRACE_ID });
  });
});

