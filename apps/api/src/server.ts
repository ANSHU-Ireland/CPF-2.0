import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
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
