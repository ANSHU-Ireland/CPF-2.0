/**
 * Outbound message queue (CPF-37): enqueue + retry-with-backoff processing
 * over `outbound_messages`. Every message is org-scoped (RLS FORCE'd), so
 * processing is always run per-org (see jobs/notify.ts for the multi-org
 * driver) rather than across the whole table at once.
 */
import { appendAudit } from "../../db/audit.js";
import type { Queryable } from "../../db/pool.js";
import type { MailPort } from "./mail.js";

export interface OutboundMessageInput {
  organisationId: string;
  messageType: string;
  toAddress: string;
  subject: string;
  body: string;
}

export async function enqueueOutboundMessage(client: Queryable, input: OutboundMessageInput): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO outbound_messages (organisation_id, message_type, to_address, subject, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.organisationId, input.messageType, input.toAddress, input.subject, input.body],
  );
  return result.rows[0]!.id;
}

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_SECONDS = 60;

export interface ProcessQueueOptions {
  mailPort: MailPort;
  batchSize?: number;
}

export interface ProcessQueueReport {
  sent: number;
  failed: number;
  deadLettered: number;
}

/** Sends due (`queued` or backed-off `failed`) messages for the org scoped to `client`. */
export async function processOutboundQueue(
  client: Queryable,
  options: ProcessQueueOptions,
): Promise<ProcessQueueReport> {
  const batchSize = options.batchSize ?? 50;
  const due = await client.query<{
    id: string;
    organisation_id: string;
    message_type: string;
    to_address: string;
    subject: string;
    body: string;
    attempts: number;
  }>(
    `SELECT id, organisation_id, message_type, to_address, subject, body, attempts
       FROM outbound_messages
      WHERE status IN ('queued', 'failed') AND next_attempt_at <= now()
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [batchSize],
  );

  const report: ProcessQueueReport = { sent: 0, failed: 0, deadLettered: 0 };
  for (const row of due.rows) {
    try {
      await options.mailPort.send({ to: row.to_address, subject: row.subject, body: row.body });
      await client.query("UPDATE outbound_messages SET status = 'sent', updated_at = now() WHERE id = $1", [row.id]);
      await appendAudit(client, {
        organisationId: row.organisation_id,
        action: "notification.sent",
        entityType: "outbound_message",
        entityId: row.id,
        metadata: { messageType: row.message_type },
      });
      report.sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (attempts >= MAX_ATTEMPTS) {
        await client.query(
          `UPDATE outbound_messages
              SET status = 'dead_letter', attempts = $2, last_error = $3, updated_at = now()
            WHERE id = $1`,
          [row.id, attempts, errorMessage],
        );
        await appendAudit(client, {
          organisationId: row.organisation_id,
          action: "notification.dead_lettered",
          entityType: "outbound_message",
          entityId: row.id,
          metadata: { messageType: row.message_type, attempts },
        });
        report.deadLettered += 1;
      } else {
        const backoffSeconds = BACKOFF_BASE_SECONDS * 2 ** (attempts - 1);
        await client.query(
          `UPDATE outbound_messages
              SET status = 'failed', attempts = $2, last_error = $3,
                  next_attempt_at = now() + ($4 || ' seconds')::interval, updated_at = now()
            WHERE id = $1`,
          [row.id, attempts, errorMessage, backoffSeconds],
        );
        report.failed += 1;
      }
    }
  }
  return report;
}
