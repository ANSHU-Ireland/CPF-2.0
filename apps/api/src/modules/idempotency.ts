/**
 * Idempotency-Key support for unsafe (mutating) endpoints (CPF-43).
 *
 * A caller may send an `Idempotency-Key` header on a POST. If the same key is
 * replayed with the identical request body, the original stored response is
 * returned unchanged (no re-execution, no duplicate row). If the same key is
 * replayed with a *different* body, this throws IdempotencyConflictError so
 * the route can surface a 422 rather than silently doing the wrong thing.
 *
 * Storage is a plain (non-RLS) table because lookups are always explicitly
 * scoped by `scope` + `actorKey` in application code — the same pattern used
 * for the platform-level `organisations` table.
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency-Key was already used with a different request body.");
    this.name = "IdempotencyConflictError";
  }
}

export interface IdempotentOutcome<T> {
  status: number;
  body: T;
}

export interface IdempotencyResult<T> extends IdempotentOutcome<T> {
  replayed: boolean;
}

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export async function runIdempotent<T>(
  client: PoolClient,
  params: { scope: string; actorKey: string; idempotencyKey: string; requestBody: unknown },
  handler: () => Promise<IdempotentOutcome<T>>,
): Promise<IdempotencyResult<T>> {
  const requestHash = hashBody(params.requestBody);
  const existing = await client.query<{ request_hash: string; response_status: number; response_body: T }>(
    `SELECT request_hash, response_status, response_body
       FROM idempotency_keys
      WHERE scope = $1 AND actor_key = $2 AND idempotency_key = $3`,
    [params.scope, params.actorKey, params.idempotencyKey],
  );
  const row = existing.rows[0];
  if (row) {
    if (row.request_hash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    return { status: row.response_status, body: row.response_body, replayed: true };
  }

  const outcome = await handler();
  try {
    await client.query(
      `INSERT INTO idempotency_keys (scope, actor_key, idempotency_key, request_hash, response_status, response_body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.scope, params.actorKey, params.idempotencyKey, requestHash, outcome.status, JSON.stringify(outcome.body)],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      // A concurrent request with the same key raced us; defer to whichever
      // response actually got persisted so every caller sees the same result.
      const winner = await client.query<{ response_status: number; response_body: T }>(
        `SELECT response_status, response_body FROM idempotency_keys
          WHERE scope = $1 AND actor_key = $2 AND idempotency_key = $3`,
        [params.scope, params.actorKey, params.idempotencyKey],
      );
      const winnerRow = winner.rows[0]!;
      return { status: winnerRow.response_status, body: winnerRow.response_body, replayed: true };
    }
    throw error;
  }
  return { ...outcome, replayed: false };
}
