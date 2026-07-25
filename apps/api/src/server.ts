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
