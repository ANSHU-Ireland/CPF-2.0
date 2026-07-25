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

## Environment variables (Delivery Plan Step 32)

Reference `.env.example` at the repo root is kept in sync with this table
and with `apps/api/src/config.ts`'s validated schema (fail-fast on startup —
`NODE_ENV=production` refuses to start at all without `DATABASE_URL`).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `production` enables the fail-fast startup checks below. |
| `API_HOST` | no | `127.0.0.1` | Set to `0.0.0.0` in any container/orchestrator so the port is reachable from outside the container network namespace. |
| `API_PORT` | no | `4000` | |
| `DATABASE_URL` | **yes in production** | unset (framework-only mode) | Must be the restricted `cpf_api` role, never a superuser/table-owner (RLS bypass risk). |
| `SMTP_HOST` | no | unset (console adapter) | Leaving this unset is safe and intentional pre-pilot — the console adapter logs message metadata only and never delivers. Set all `SMTP_*` together to enable real delivery. |
| `SMTP_PORT` | no | `587` | |
| `SMTP_SECURE` | no | `false` | |
| `SMTP_USER` / `SMTP_PASSWORD` | no | unset | Store in a managed secret store in any real environment, never in a `.env` file on disk. |
| `SMTP_FROM` | no | `no-reply@cpf.invalid` | |
| `RATE_LIMIT_TEST_MULTIPLIER` | no | `1` | Test-only knob to widen rate-limit buckets for the integration suite. **Never set this outside CI/local test runs** — it directly weakens the production rate-limit posture. |
| `DATABASE_ADMIN_URL` | only for `packages/db/scripts/migrate.mjs` and CI | — | Superuser/owner connection used solely to apply migrations and provision the `cpf_api` role; the running API process never uses this variable. |

### Secret checklist

- `SESSION_SECRET` was removed from `.env.example` (Step 32) — it was dead
  configuration, never read by `config.ts`. Sessions are opaque random
  tokens hashed at rest (`@cpf/identity`), not signed/HMAC'd, so there is
  nothing for a "session secret" to do; wiring one up would have been
  security theatre. If a signed-cookie or JWT mechanism is ever introduced,
  add its secret back deliberately at that point, sourced from the secret
  store below.
- Real values for `DATABASE_URL`, `DATABASE_ADMIN_URL`, `SMTP_PASSWORD`, and
  (Phase 2+) `AI_GATEWAY_API_KEY` must live in a managed secret store
  (cloud provider's native secrets manager, or Vault) in staging/production
  — never in a committed file, never in plain CI logs. GitHub Actions
  secrets are the interim mechanism for CI-only credentials (already
  scoped to ephemeral per-run Postgres containers with throwaway
  passwords, so no real secret exists there today).
- Rotate any credential that has ever been pasted into a chat, ticket, or
  log line before using it in a real environment.

## EU-region provider shortlist (Delivery Plan Step 32)

Decision remains open (Phase 1 close-out, per the deployment reference
above) — reference shortlist so the choice isn't made from a blank page:

| Option | Fit | Notes |
|---|---|---|
| **Hetzner Cloud (Germany/Finland) + managed k8s or plain VMs** | Recommended default | Lowest cost, straightforward EU-only data residency, good for an early pilot's scale. No managed Postgres offering as strong as the alternatives below — pair with a managed PG add-on or self-run PG with PITR configured carefully. |
| Scaleway (France) | Alternative | EU-native, has managed PostgreSQL with PITR built in — reduces the self-run-PG operational burden vs. Hetzner. |
| OVHcloud (France) | Alternative | Similar profile to Scaleway; broader compliance-certification portfolio if a customer specifically requires it. |
| AWS/GCP/Azure EU regions | Not recommended for pilot | Real EU regions exist, but cost and platform complexity are disproportionate for this stage; revisit only if a customer's procurement requires a specific hyperscaler. |

Whichever is chosen, the non-negotiable requirements are: EU-region-only
data residency, managed PostgreSQL with point-in-time recovery (the actual
production backup mechanism — see the backup & restore runbook above),
and object storage with versioning in the same region.

### DNS / TLS reference

- DNS: a dedicated subdomain per environment (e.g. `api.staging.cpf.example`,
  `api.cpf.example`), managed via the chosen provider's DNS or a
  provider-agnostic registrar — no specific registrar decision needed yet.
- TLS: terminate at a reverse proxy in front of the container (Caddy/nginx
  reference config above, Step 31) using an ACME-issued certificate
  (Let's Encrypt via Caddy's automatic HTTPS, or certbot for nginx) —
  auto-renewing, never a manually-managed certificate file left to expire.
- The API process itself never terminates TLS — it always speaks plain HTTP
  behind the proxy, consistent with the container's `API_HOST=0.0.0.0`
  default being safe only because it's never directly internet-facing.

## Migration-apply procedure (Delivery Plan Step 32)

`packages/db/scripts/migrate.mjs` (`npm run migrate -w @cpf/db`, or directly
via `DATABASE_ADMIN_URL=... node packages/db/scripts/migrate.mjs`) replaces
manually looping `psql -f` per file for any environment beyond local/CI:

- Tracks applied files in `schema_migrations` (migration 0011) — re-running
  against an already-migrated database is a safe no-op (only genuinely new
  migration files get applied).
- Retrofits existing pre-Step-32 environments automatically: if
  `schema_migrations` doesn't exist yet but the foundational `organisations`
  table does (i.e. 0001-0010 were already applied by hand/CI before this
  tracking table existed), it marks those as already-applied without
  re-running their SQL, then applies 0011 (which creates the tracking table
  and backfills those same rows for consistency) and any migrations after
  it.
- Verified locally against both a genuinely fresh throwaway database (all 11
  migrations applied, then a re-run applied zero) and the existing local dev
  database (retrofit path: 0001-0010 correctly detected as already applied,
  only 0011 ran).
- **Rollback**: migrations are append-only by project rule (BINDING RULES
  §2) — there is no down-migration mechanism, by design. Rollback means
  redeploying the previous container image against the same (forward-only)
  schema; a schema change that would break the previous image's queries
  must ship as an additive, backward-compatible migration first, with the
  breaking cleanup as a later, separate migration once the old image is no
  longer running anywhere (expand/contract pattern).

## Staging provisioning (Delivery Plan Step 32 — USER-GATED)

Provisioning an actual staging environment (a real EU-region host/cluster,
managed Postgres instance, DNS record, and TLS certificate) requires
real-world credentials and an account with the chosen provider — this
cannot be done from inside this development environment. The runbook above
is the deliverable for this step; ask the user before any real staging
environment is provisioned, and never fabricate a "staging is live" status.

