import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closePool } from "./db/pool.js";

const config = loadConfig();
const m = config.RATE_LIMIT_TEST_MULTIPLIER;
const app = buildApp({
  ...(config.DATABASE_URL !== undefined ? { databaseUrl: config.DATABASE_URL } : {}),
  rateLimit: {
    generalCapacity: Math.round(1000 * m),
    generalRefillPerSecond: (1000 / 60) * m,
    strictCapacity: Math.round(500 * m),
    strictRefillPerSecond: (500 / 60) * m,
  },
  aiGateway: {
    platformEnabled: config.AI_GATEWAY_ENABLED,
    isTestEnv: config.NODE_ENV === "test",
    ...(config.AI_PROVIDER_BASE_URL !== undefined && config.AI_PROVIDER_API_KEY !== undefined
      ? { provider: { baseUrl: config.AI_PROVIDER_BASE_URL, apiKey: config.AI_PROVIDER_API_KEY } }
      : {}),
    ...(config.AI_GATEWAY_TEST_STUB_RESPONSE !== undefined
      ? { testStubResponse: config.AI_GATEWAY_TEST_STUB_RESPONSE }
      : {}),
    allowedModel: config.AI_ALLOWED_MODEL,
    allowedModelVersion: config.AI_ALLOWED_MODEL_VERSION,
    region: config.AI_REGION,
    timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
    dailyTokenBudget: config.AI_DAILY_TOKEN_BUDGET,
    dailyCostBudgetUsdCents: config.AI_DAILY_COST_BUDGET_USD_CENTS,
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
