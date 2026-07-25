/**
 * Regenerates docs/api/openapi.json from the live Fastify route table
 * (CPF-44). Boots the app in full platform mode (a DB connection is
 * constructed but never queried — `pg.Pool` connects lazily) so every
 * platform route is registered, not just the framework-only subset.
 *
 * Usage (after `npm run build` in apps/api):
 *   node apps/api/scripts/generate-openapi.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildApp } from "../dist/app.js";

const app = buildApp({ databaseUrl: process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder" });
await app.ready();
const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
const spec = JSON.parse(response.body);

const outPath = join(import.meta.dirname, "..", "..", "..", "docs", "api", "openapi.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n");
console.log(`Wrote ${outPath}`);

await app.close();
