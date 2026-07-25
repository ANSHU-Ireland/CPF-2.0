/**
 * OpenTelemetry tracing (Delivery Plan Step 33).
 *
 * No-op by default: the SDK is only started when `OTEL_EXPORTER_OTLP_ENDPOINT`
 * is set. This keeps the dependency entirely inert for every environment that
 * hasn't opted in (local dev, CI, and any deployment that doesn't yet have an
 * OTLP collector), while still letting the trace-id-into-logs wiring in
 * app.ts work unconditionally (it's a no-op read of "no active span" when the
 * SDK never started).
 *
 * Deliberately narrow instrumentation set (HTTP + pg only, not the full
 * `@opentelemetry/auto-instrumentations-node` meta-package) to keep the
 * dependency footprint and version-churn risk small — see the Step 33 risk
 * note in the delivery plan.
 */
import { trace } from "@opentelemetry/api";

let started = false;

export async function startTracingIfConfigured(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || started) return;

  const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }, { PgInstrumentation }] =
    await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/instrumentation-http"),
      import("@opentelemetry/instrumentation-pg"),
    ]);

  const sdk = new NodeSDK({
    serviceName: "cpf-api",
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
  });
  sdk.start();
  started = true;
}

/** The active span's trace id, or undefined when tracing isn't configured/active. */
export function currentTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}
