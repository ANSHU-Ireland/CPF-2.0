/**
 * Backup/restore drill (Delivery Plan Step 34, MILESTONE).
 *
 * Honest scope: this is a LOCAL drill against whatever PostgreSQL instance
 * DATABASE_ADMIN_URL points at, proving the *mechanism* (pg_dump custom
 * format → pg_restore → schema/data/audit-chain assertions against the
 * restored copy) actually works end-to-end. It is NOT the production backup
 * mechanism — that's the managed provider's automated snapshots + WAL PITR
 * (see docs/operations/operations-and-runbooks.md, "Runbook: backup &
 * restore"), which must be drilled quarterly against a real managed-Postgres
 * restore-to-new-instance, not this script. This script is what's runnable
 * without any real cloud environment.
 *
 * Requires: `npm run build` first (imports this package's own compiled
 * db/audit.js — mirrors scripts/bootstrap.mjs's convention), and a
 * DATABASE_ADMIN_URL role with CREATEDB privilege on the target Postgres
 * server (the drill creates and drops its own throwaway restore-target
 * database; the regular migration-admin role does NOT need this privilege
 * in staging/production, only for running this specific drill locally).
 *
 * Usage:
 *   DATABASE_ADMIN_URL=postgresql://cpf@localhost:5544/cpf \
 *   node apps/api/scripts/backup-restore-drill.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { verifyAuditChain } from "../dist/db/audit.js";

const DRILL_DB = "cpf_backup_restore_drill";

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("Required env var: DATABASE_ADMIN_URL (must have CREATEDB privilege).");
  process.exit(1);
}

const source = new URL(adminUrl);
const sourceDbName = source.pathname.replace(/^\//, "");
if (!sourceDbName) {
  console.error("DATABASE_ADMIN_URL must include a database name.");
  process.exit(1);
}

function maintenanceUrl() {
  const u = new URL(adminUrl);
  u.pathname = "/postgres";
  return u.toString();
}

function drillUrl() {
  const u = new URL(adminUrl);
  u.pathname = `/${DRILL_DB}`;
  return u.toString();
}

const tmpDir = mkdtempSync(join(tmpdir(), "cpf-backup-drill-"));
const dumpFile = join(tmpDir, "source.dump");

let exitCode = 0;
try {
  console.log(`[1/6] Recording pre-drill counts from "${sourceDbName}"...`);
  const sourceClient = new pg.Client({ connectionString: adminUrl });
  await sourceClient.connect();
  const sourceTemplateCount = (
    await sourceClient.query("SELECT count(*)::int AS n FROM assessment_template_versions")
  ).rows[0].n;
  const sourceAuditChain = await verifyAuditChain(sourceClient);
  await sourceClient.end();
  console.log(
    `      source: ${sourceTemplateCount} template version(s), audit chain valid=${sourceAuditChain.valid} (${sourceAuditChain.entries} entries)`,
  );
  if (!sourceAuditChain.valid) {
    throw new Error(
      `Source database's own audit chain is already broken (first broken id ${sourceAuditChain.firstBrokenId}) — drill cannot proceed meaningfully.`,
    );
  }

  console.log(`[2/6] pg_dump (custom format) "${sourceDbName}" -> ${dumpFile}...`);
  execFileSync("pg_dump", ["-Fc", "-f", dumpFile, adminUrl], { stdio: "inherit" });

  console.log(`[3/6] Recreating throwaway restore-target database "${DRILL_DB}"...`);
  const maint = new pg.Client({ connectionString: maintenanceUrl() });
  await maint.connect();
  await maint.query(`DROP DATABASE IF EXISTS ${DRILL_DB}`);
  await maint.query(`CREATE DATABASE ${DRILL_DB}`);
  await maint.end();

  console.log(`[4/6] pg_restore into "${DRILL_DB}"...`);
  execFileSync("pg_restore", ["--no-owner", "--no-privileges", "-d", drillUrl(), dumpFile], {
    stdio: "inherit",
  });

  console.log("[5/6] Verifying restored copy: template count + audit chain integrity...");
  const restoredClient = new pg.Client({ connectionString: drillUrl() });
  await restoredClient.connect();
  const restoredTemplateCount = (
    await restoredClient.query("SELECT count(*)::int AS n FROM assessment_template_versions")
  ).rows[0].n;
  const restoredAuditChain = await verifyAuditChain(restoredClient);
  await restoredClient.end();

  if (restoredTemplateCount !== sourceTemplateCount) {
    throw new Error(
      `Template version count mismatch: source=${sourceTemplateCount} restored=${restoredTemplateCount}`,
    );
  }
  if (!restoredAuditChain.valid || restoredAuditChain.entries !== sourceAuditChain.entries) {
    throw new Error(
      `Audit chain assertion failed on restored copy: valid=${restoredAuditChain.valid} entries=${restoredAuditChain.entries} (expected ${sourceAuditChain.entries})`,
    );
  }
  console.log(
    `      restored: ${restoredTemplateCount} template version(s) match, audit chain valid (${restoredAuditChain.entries} entries) match.`,
  );

  console.log("[6/6] Drill passed. Cleaning up...");
} catch (error) {
  exitCode = 1;
  console.error("DRILL FAILED:", error instanceof Error ? error.message : error);
} finally {
  try {
    const maint = new pg.Client({ connectionString: maintenanceUrl() });
    await maint.connect();
    await maint.query(`DROP DATABASE IF EXISTS ${DRILL_DB}`);
    await maint.end();
  } catch {
    // best-effort cleanup only
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(exitCode);
