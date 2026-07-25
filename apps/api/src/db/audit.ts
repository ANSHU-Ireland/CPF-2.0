import { createHash } from "node:crypto";
import type { Queryable } from "./pool.js";
import { auditAppendsTotal } from "../observability/metrics.js";
import { currentTraceId } from "../observability/tracing.js";

/**
 * Tamper-evident audit log writer (ADR-0006).
 *
 * Each entry's hash covers a canonical serialisation of the entry plus the
 * previous entry's hash, forming a verifiable chain. Appends are serialised
 * with a transaction-scoped advisory lock so the chain stays linear. The table
 * itself is append-only (UPDATE/DELETE blocked by trigger).
 */

export interface AuditEntry {
  organisationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`);
  return `{${entries.join(",")}}`;
}

export function computeEntryHash(
  prevHash: string | null,
  entry: AuditEntry & { occurredAt: string },
): string {
  return createHash("sha256")
    .update(prevHash ?? "genesis")
    .update(canonicalise(entry))
    .digest("hex");
}

export async function appendAudit(client: Queryable, entry: AuditEntry): Promise<void> {
  // Serialise chain appends within this transaction scope.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('cpf_audit_chain'))");
  const prev = await client.query<{ entry_hash: string }>(
    "SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1",
  );
  const prevHash = prev.rows[0]?.entry_hash ?? null;
  const occurredAt = new Date().toISOString();
  // Normalise to the exact shape verifyAuditChain reads back from the database:
  // absent fields become explicit nulls so write- and read-side hashes agree.
  // traceId (Step 33) is attached whenever a span is active when this is
  // called; undefined is dropped consistently by both JSON.stringify and
  // canonicalise below, so it never appears (and never breaks hash
  // recomputation) when tracing isn't configured.
  const normalised = {
    organisationId: entry.organisationId ?? null,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: { ...(entry.metadata ?? {}), traceId: currentTraceId() },
    occurredAt,
  };
  const entryHash = computeEntryHash(prevHash, normalised);
  await client.query(
    `INSERT INTO audit_log
       (organisation_id, actor_user_id, action, entity_type, entity_id, metadata, occurred_at, prev_hash, entry_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      normalised.organisationId,
      normalised.actorUserId,
      normalised.action,
      normalised.entityType,
      normalised.entityId,
      JSON.stringify(normalised.metadata),
      occurredAt,
      prevHash,
      entryHash,
    ],
  );
  auditAppendsTotal.inc();
}

/** Recompute the full chain and report the first break, if any. */
export async function verifyAuditChain(
  client: Queryable,
): Promise<{ valid: boolean; entries: number; firstBrokenId: number | null }> {
  const rows = await client.query<{
    id: number;
    organisation_id: string | null;
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata: Record<string, unknown>;
    occurred_at: Date;
    prev_hash: string | null;
    entry_hash: string;
  }>("SELECT * FROM audit_log ORDER BY id ASC");
  let prevHash: string | null = null;
  for (const row of rows.rows) {
    const expected = computeEntryHash(prevHash, {
      organisationId: row.organisation_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata,
      occurredAt: row.occurred_at.toISOString(),
    });
    if (row.prev_hash !== prevHash || row.entry_hash !== expected) {
      return { valid: false, entries: rows.rowCount ?? 0, firstBrokenId: row.id };
    }
    prevHash = row.entry_hash;
  }
  return { valid: true, entries: rows.rowCount ?? 0, firstBrokenId: null };
}
