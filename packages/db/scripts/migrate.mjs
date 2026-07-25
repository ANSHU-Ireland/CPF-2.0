#!/usr/bin/env node
/**
 * Idempotent migration-apply script (Delivery Plan Step 32).
 *
 * Usage: DATABASE_ADMIN_URL=postgresql://user:pass@host:port/db node packages/db/scripts/migrate.mjs
 *
 * Safe to re-run: migrations already recorded in `schema_migrations`
 * (migration 0011) are skipped. Environments that already had 0001-0010
 * applied before that tracking table existed are retrofitted automatically —
 * probed via the presence of `organisations` (the earliest foundational
 * table, created by 0001) — so this script never tries to re-apply SQL that
 * is already structurally present.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL is required.");
  process.exit(1);
}

function psqlScalar(sql) {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-tA", adminUrl, "-c", sql], {
    encoding: "utf-8",
  });
}

function psqlExec(sql) {
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", adminUrl, "-c", sql], { stdio: "inherit" });
}

function psqlFile(file) {
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", adminUrl, "-f", file], { stdio: "inherit" });
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const trackingTableExists =
  psqlScalar("SELECT to_regclass('public.schema_migrations') IS NOT NULL;").trim() === "t";

const applied = new Set();
if (trackingTableExists) {
  const rows = psqlScalar("SELECT filename FROM schema_migrations ORDER BY filename;");
  for (const line of rows.split("\n")) {
    const name = line.trim();
    if (name) applied.add(name);
  }
} else {
  const foundationExists =
    psqlScalar("SELECT to_regclass('public.organisations') IS NOT NULL;").trim() === "t";
  if (foundationExists) {
    console.log(
      "schema_migrations not found but an existing schema was detected — retrofitting: " +
        "treating every migration before 0011_schema_migrations.sql as already applied.",
    );
    for (const f of files) {
      if (f === "0011_schema_migrations.sql") break;
      applied.add(f);
    }
  }
}

// Tracked separately from `trackingTableExists` above: on a genuinely fresh
// database, the schema_migrations table doesn't exist until
// 0011_schema_migrations.sql itself creates it partway through this loop —
// recording an applied file is only possible once that table exists. 0011's
// own SQL already backfills rows for every file before it, so no explicit
// record call is needed (or possible) for 0001-0010 in that scenario.
let canRecord = trackingTableExists;

let appliedCount = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip (already applied): ${file}`);
    continue;
  }
  console.log(`applying: ${file}`);
  psqlFile(join(migrationsDir, file));
  if (file === "0011_schema_migrations.sql") canRecord = true;
  if (canRecord) {
    psqlExec(`INSERT INTO schema_migrations (filename) VALUES ('${file}') ON CONFLICT (filename) DO NOTHING;`);
  }
  appliedCount += 1;
}

console.log(`Done. ${appliedCount} migration(s) applied, ${files.length - appliedCount} already up to date.`);
