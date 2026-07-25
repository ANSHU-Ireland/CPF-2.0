# Operations — Environments, Deployment, Runbooks

## Environments

| Env | Purpose | Data | Status |
|---|---|---|---|
| local | Development: docker-compose (PG 16 + Mailpit), `npm run api:dev` | Synthetic only | ✅ working |
| ci | GitHub Actions: typecheck, tests, audit, migration+RLS validation on real PG | Synthetic | ✅ workflow committed (first run after push) |
| staging | Pre-production, EU region, production-like config | Synthetic + pilot rehearsal | 🔴 not provisioned |
| production | Pilot+ | Real (post legal gates) | 🔴 not provisioned |

Environment rules: separate credentials per env/service; secrets only in a
managed secret store (never files); `NODE_ENV=production` refuses to start
without full config (fail-fast validation implemented); no demo/dev auth path
may exist in production builds (legacy lesson L3).

## Local setup (verified 2026-07-25)

```bash
nvm use && npm install
npm run typecheck && npm test        # 68 tests green
npm run api:dev                      # http://127.0.0.1:4000/health
# optional DB:
docker compose up -d                 # migrations auto-apply on first boot
npm run seed:generate
docker compose exec -T postgres psql -U cpf -d cpf < packages/db/seed/generated/seed.sql
```

## Deployment reference (target)

Container image (multi-stage, non-root, pinned base) → EU-region runtime
(any of: Hetzner/Scaleway/OVH k8s or managed containers; decision Phase 1
close-out) → managed PostgreSQL with PITR backups → object storage (EU) →
staged rollout (staging soak → canary → full) → rollback = previous image +
additive-only migrations mean no down-migration needed for rollback.

## Runbook: incident response (summary)

1. **Detect & triage** — severity: P0 data leak/tamper/integrity-gate bypass ·
   P1 core workflow down · P2 degraded.
2. **Contain** — feature-flag off / AI kill switch / revoke tokens / suspend
   tenant / scale to zero as proportionate. All actions audited.
3. **Preserve** — export audit chain segment + relevant logs before changes.
4. **Notify** — counsel decides GDPR Art. 33 (72h) and AI Act serious-incident
   duties; customer comms per contract; never speculate in writing.
5. **Remediate & review** — fix, verify, post-incident review within 5 working
   days, control changes tracked in the risk register.

## Runbook: backup & restore
Nightly automated PG snapshots + WAL PITR (managed). **Restore is drilled
quarterly into staging and the drill result is recorded** — a backup that has
never been restored is not a backup. Object storage: versioning + lifecycle.

## Runbook: data deletion & retention run
Scheduled job (CPF-26, implemented): `apps/api/src/jobs/retention.ts`, run via
`npm run retention:dry-run` (default, reports counts only) or
`npm run retention:execute` (applies) from `apps/api` after `npm run build`,
with `DATABASE_URL` set to the restricted `cpf_api` role. Per-org policy
(`retention_policies`) → per-category evidence-event deletion measured from
the owning session's terminal date → skip legal holds entirely → anonymise
candidates whose sessions are all terminal and past the evidence window →
write one `retention.sweep_executed` audit entry per org with counts → a
per-category/per-org cap (default 5000) skips an org's execution outright if
exceeded, requiring manual review before re-running. Always run a dry run
first and review the printed report before `--execute`.

**Scheduling**: run daily, off-peak. On Linux/managed cron:
`0 3 * * * cd /app/apps/api && DATABASE_URL=... node dist/jobs/retention.js --execute >> /var/log/cpf/retention.log 2>&1`.
On Windows (local/dev only) via Task Scheduler: create a daily trigger
running `node.exe` with arguments `dist/jobs/retention.js --execute`, working
directory `apps/api`, and `DATABASE_URL` set in the task's environment. Alert
on any run whose report contains `skippedCapExceeded: true` for any org — it
indicates either a misconfigured policy or an anomalous backlog and needs
manual investigation before forcing execution with a higher cap.

Manual erasure (DSR): same anonymisation/deletion shape, single-subject
scope, dual-confirmation, via the data-rights workflow (not this sweep).

## Runbook: notification delivery & retry (CPF-37)
Outbound notices (invitation-issued courier note, activation-token issued,
future DSR clock reminders) are enqueued to `outbound_messages` at the point
of issuance rather than sent inline. `apps/api/src/jobs/notify.ts` (run via
`npm run notify:retry` from `apps/api` after `npm run build`) drives delivery
per org: due `queued`/backed-off `failed` rows are sent through the console
adapter (default; metadata-only logs, body never printed) or the SMTP adapter
when `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` are
configured. Failures back off exponentially (60s doubling per attempt) and
age out to `dead_letter` after 5 attempts; every send/dead-letter transition
is audited. Schedule frequently (e.g. every 5 minutes) via the same
cron/Task Scheduler mechanism as the retention job. Alert on any
`dead_letter` rows — they represent notices that never reached their
recipient and may need manual redelivery.

## Runbook: AI kill switch (when AI features exist)
Org scope: org_admin toggles feature flag → gateway refuses invocations →
reviewer UI falls back to human-only (always functional). Platform scope:
platform_admin disables provider/model → in-flight requests time out safely.
Verify: invocation log shows zero calls post-switch.
