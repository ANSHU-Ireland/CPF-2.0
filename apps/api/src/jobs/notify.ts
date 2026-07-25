/**
 * Notification retry job (CPF-37): drives `processOutboundQueue` across every
 * organisation. Run periodically (see docs/operations/operations-and-runbooks.md)
 * to retry backed-off deliveries and age out permanent failures to
 * `dead_letter`. Uses the console adapter unless SMTP_* is configured.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createMailPort } from "../modules/notifications/mail.js";
import { processOutboundQueue, type ProcessQueueReport } from "../modules/notifications/queue.js";
import { withTx, withOrgTx, createPool, closePool } from "../db/pool.js";

export interface NotificationRetryReport {
  executedAt: string;
  orgs: Array<{ organisationId: string } & ProcessQueueReport>;
}

export async function runNotificationRetry(
  options: { mailPort: ReturnType<typeof createMailPort>; batchSizePerOrg?: number },
): Promise<NotificationRetryReport> {
  const orgs = await withTx((client) =>
    client.query<{ id: string }>("SELECT id FROM organisations ORDER BY created_at"),
  );
  const orgReports: Array<{ organisationId: string } & ProcessQueueReport> = [];
  for (const org of orgs.rows) {
    const report = await withOrgTx(org.id, (client) =>
      processOutboundQueue(client, {
        mailPort: options.mailPort,
        ...(options.batchSizePerOrg !== undefined ? { batchSize: options.batchSizePerOrg } : {}),
      }),
    );
    orgReports.push({ organisationId: org.id, ...report });
  }
  return { executedAt: new Date().toISOString(), orgs: orgReports };
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]!);

if (isMainModule) {
  const config = loadConfig();
  if (!config.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  createPool(config.DATABASE_URL);
  try {
    const report = await runNotificationRetry({ mailPort: createMailPort(config) });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closePool();
  }
}
