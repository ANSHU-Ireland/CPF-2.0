/**
 * Retention sweep (CPF-26).
 *
 * For each organisation, deletes evidence events past that org's configured
 * retention window (measured from the owning session's terminal transition,
 * not the event's own timestamp) and anonymises candidates whose sessions are
 * all terminal and past the evidence-retention window. An active legal hold
 * on a candidate suppresses ALL deletion/anonymisation for that candidate.
 *
 * Defaults to a dry run (counts only, nothing written) — pass `execute: true`
 * (or `--execute` on the CLI) to apply. A per-category, per-org deletion cap
 * guards against a runaway/misconfigured policy causing a mass deletion in a
 * single run; an org that would exceed the cap is skipped (counts still
 * reported) rather than partially applied.
 *
 * Audit log and criterion_scores/evidence_ledger_claims are intentionally
 * untouched here — they are retained for accountability per the retention
 * matrix and are only removed via the explicit data-rights erasure workflow
 * (see modules/org/data-rights.ts), which is subject-request-driven rather
 * than a scheduled sweep.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { appendAudit } from "../db/audit.js";
import { withTx, withOrgTx, createPool, closePool, type Queryable } from "../db/pool.js";

const TERMINAL_SESSION_STATUSES = ["report_issued", "withdrawn", "expired", "invalidated"] as const;

type EvidenceCategory = "workspace_evidence" | "integrity_signal";

export interface RetentionOrgReport {
  organisationId: string;
  workspaceEvidenceDeleted: number;
  integritySignalDeleted: number;
  candidatesAnonymised: number;
  skippedCapExceeded: boolean;
  note?: string;
}

export interface RetentionRunReport {
  executedAt: string;
  dryRun: boolean;
  orgs: RetentionOrgReport[];
}

export interface RetentionSweepOptions {
  /** When false (default), counts are computed but nothing is deleted or written. */
  execute?: boolean;
  /** An org whose eligible deletions in any one category exceed this count is skipped entirely (counts still reported), requiring manual review. */
  maxDeletionsPerOrgPerCategory?: number;
}

async function countEligibleEvents(
  client: Queryable,
  category: EvidenceCategory,
  retentionDays: number,
): Promise<number> {
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::bigint AS n
       FROM evidence_events e
       JOIN assessment_sessions s ON s.id = e.session_id
       JOIN invitations i ON i.id = s.invitation_id
      WHERE e.category = $1::evidence_event_category
        AND s.status = ANY($2::session_status[])
        AND s.updated_at < now() - ($3 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM legal_holds h WHERE h.candidate_id = i.candidate_id AND h.released_at IS NULL)`,
    [category, TERMINAL_SESSION_STATUSES, retentionDays],
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function deleteEligibleEvents(
  client: Queryable,
  category: EvidenceCategory,
  retentionDays: number,
): Promise<number> {
  const result = await client.query(
    `DELETE FROM evidence_events e
      USING assessment_sessions s, invitations i
      WHERE e.session_id = s.id
        AND s.invitation_id = i.id
        AND e.category = $1::evidence_event_category
        AND s.status = ANY($2::session_status[])
        AND s.updated_at < now() - ($3 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM legal_holds h WHERE h.candidate_id = i.candidate_id AND h.released_at IS NULL)`,
    [category, TERMINAL_SESSION_STATUSES, retentionDays],
  );
  return result.rowCount ?? 0;
}

async function countEligibleCandidates(client: Queryable, evidenceRetentionDays: number): Promise<number> {
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::bigint AS n
       FROM candidates c
      WHERE c.status <> 'anonymised'
        AND NOT EXISTS (SELECT 1 FROM legal_holds h WHERE h.candidate_id = c.id AND h.released_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM assessment_sessions s JOIN invitations i ON i.id = s.invitation_id
           WHERE i.candidate_id = c.id AND s.status <> ALL($1::session_status[])
        )
        AND EXISTS (
          SELECT 1 FROM assessment_sessions s JOIN invitations i ON i.id = s.invitation_id
           WHERE i.candidate_id = c.id AND s.status = ANY($1::session_status[])
             AND s.updated_at < now() - ($2 || ' days')::interval
        )`,
    [TERMINAL_SESSION_STATUSES, evidenceRetentionDays],
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function anonymiseEligibleCandidates(client: Queryable, evidenceRetentionDays: number): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `UPDATE candidates c
        SET email = 'erased+' || c.id || '@anonymised.invalid',
            full_name = 'Erased under retention policy',
            status = 'anonymised',
            updated_at = now()
      WHERE c.status <> 'anonymised'
        AND NOT EXISTS (SELECT 1 FROM legal_holds h WHERE h.candidate_id = c.id AND h.released_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM assessment_sessions s JOIN invitations i ON i.id = s.invitation_id
           WHERE i.candidate_id = c.id AND s.status <> ALL($1::session_status[])
        )
        AND EXISTS (
          SELECT 1 FROM assessment_sessions s JOIN invitations i ON i.id = s.invitation_id
           WHERE i.candidate_id = c.id AND s.status = ANY($1::session_status[])
             AND s.updated_at < now() - ($2 || ' days')::interval
        )
      RETURNING c.id`,
    [TERMINAL_SESSION_STATUSES, evidenceRetentionDays],
  );
  return result.rows.map((r) => r.id);
}

export async function runRetentionSweep(options: RetentionSweepOptions = {}): Promise<RetentionRunReport> {
  const execute = options.execute ?? false;
  const cap = options.maxDeletionsPerOrgPerCategory ?? 5_000;

  const orgs = await withTx((client) =>
    client.query<{ id: string }>("SELECT id FROM organisations ORDER BY created_at"),
  );

  const orgReports: RetentionOrgReport[] = [];
  for (const org of orgs.rows) {
    const report = await withOrgTx(org.id, async (client): Promise<RetentionOrgReport> => {
      const policy = await client.query<{
        evidence_retention_days: number;
        integrity_retention_days: number;
      }>(
        "SELECT evidence_retention_days, integrity_retention_days FROM retention_policies WHERE organisation_id = $1",
        [org.id],
      );
      const p = policy.rows[0];
      if (!p) {
        return {
          organisationId: org.id,
          workspaceEvidenceDeleted: 0,
          integritySignalDeleted: 0,
          candidatesAnonymised: 0,
          skippedCapExceeded: false,
          note: "no retention policy configured for this organisation",
        };
      }

      const workspaceCount = await countEligibleEvents(client, "workspace_evidence", p.evidence_retention_days);
      const integrityCount = await countEligibleEvents(client, "integrity_signal", p.integrity_retention_days);
      const candidateCount = await countEligibleCandidates(client, p.evidence_retention_days);
      const capExceeded = workspaceCount > cap || integrityCount > cap || candidateCount > cap;

      if (!execute || capExceeded) {
        return {
          organisationId: org.id,
          workspaceEvidenceDeleted: workspaceCount,
          integritySignalDeleted: integrityCount,
          candidatesAnonymised: candidateCount,
          skippedCapExceeded: capExceeded,
          ...(capExceeded
            ? { note: `skipped: eligible count exceeds the per-run cap of ${cap} — review manually before executing` }
            : {}),
        };
      }

      const workspaceDeleted = await deleteEligibleEvents(client, "workspace_evidence", p.evidence_retention_days);
      const integrityDeleted = await deleteEligibleEvents(client, "integrity_signal", p.integrity_retention_days);
      const anonymisedIds = await anonymiseEligibleCandidates(client, p.evidence_retention_days);

      await appendAudit(client, {
        organisationId: org.id,
        action: "retention.sweep_executed",
        entityType: "organisation",
        entityId: org.id,
        metadata: {
          workspaceEvidenceDeleted: workspaceDeleted,
          integritySignalDeleted: integrityDeleted,
          candidatesAnonymised: anonymisedIds.length,
        },
      });

      return {
        organisationId: org.id,
        workspaceEvidenceDeleted: workspaceDeleted,
        integritySignalDeleted: integrityDeleted,
        candidatesAnonymised: anonymisedIds.length,
        skippedCapExceeded: false,
      };
    });
    orgReports.push(report);
  }

  return { executedAt: new Date().toISOString(), dryRun: !execute, orgs: orgReports };
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]!);

if (isMainModule) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const execute = process.argv.includes("--execute");
  createPool(databaseUrl);
  try {
    const report = await runRetentionSweep({ execute });
    console.log(JSON.stringify(report, null, 2));
    if (!execute) {
      console.error("\nDry run only — nothing was deleted or anonymised. Re-run with --execute to apply.");
    }
  } finally {
    await closePool();
  }
}
