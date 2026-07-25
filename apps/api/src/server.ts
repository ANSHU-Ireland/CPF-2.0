import { startTracingIfConfigured } from "./observability/tracing.js";

// Started before any other local module is imported (dynamic imports below)
// so OpenTelemetry's HTTP/pg instrumentation — when OTEL_EXPORTER_OTLP_ENDPOINT
// is configured — patches those modules before this process's first real use
// of them. A no-op when unset (see tracing.ts).
await startTracingIfConfigured();

const { buildApp } = await import("./app.js");
const { loadConfig } = await import("./config.js");
const { closePool } = await import("./db/pool.js");

const config = loadConfig();
const m = config.RATE_LIMIT_TEST_MULTIPLIER;
const app = buildApp({
  ...(config.DATABASE_URL !== undefined ? { databaseUrl: config.DATABASE_URL } : {}),
  metricsEnabled: config.METRICS_ENABLED,
  rateLimit: {
    generalCapacity: Math.round(1000 * m),
    generalRefillPerSecond: (1000 / 60) * m,
    strictCapacity: Math.round(500 * m),
    strictRefillPerSecond: (500 / 60) * m,
  },
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await closePool().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

app
  .listen({ host: config.API_HOST, port: config.API_PORT })
  .then((address) => app.log.info(`CPF API listening at ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
