# Operations — Environments, Deployment, Runbooks

## Environments

| Env | Purpose | Data | Status |
|---|---|---|---|
| local | Development: docker-compose (PG 16 + Mailpit), `npm run api:dev` | Synthetic only | ✅ working |
| ci | GitHub Actions: typecheck, tests, audit, migration+RLS validation, container build+smoke on real PG | Synthetic | ✅ verified green on GitHub Actions (Step 30) |
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

### Container image (implemented, Step 31)

`apps/api/Dockerfile` — multi-stage build (build context is the repo root,
since npm workspaces need the full monorepo layout to resolve
`@cpf/assessment-framework` / `@cpf/identity`): a `deps`/`build` stage
compiles the three workspaces the API needs, a separate `prod-deps` stage
installs a fresh production-only `node_modules` from the lockfile, and the
final `runtime` stage is `node:22-slim` running as a non-root `cpf` user
under `tini` (PID 1, correct signal forwarding for `SIGTERM`), with a
`HEALTHCHECK` hitting `/health` via Node's built-in `fetch` (no `curl`
installed, keeps the image lean). No Docker engine is available in this
development environment, so the image cannot be built/run locally — its
correctness is proven every CI run by the `container-smoke` job in
`.github/workflows/ci.yml`, which builds the image, boots it against a real
Postgres service container, and asserts `/health` reports
`"mode":"platform"`. If that job goes red, fix forward before merging
anything else.

`docker-compose.yml` gained a `production` profile (`docker compose
--profile production up`) — a self-contained reference/on-prem stack (`db` +
`migrate` + `api`), **not** the recommended real production architecture
above (which is managed Postgres + a secrets manager, not this file's
hardcoded-with-env-override placeholder passwords). The `migrate` service
(`packages/db/scripts/docker-migrate.sh`) applies every migration file and
then ensures the `cpf_api` LOGIN role exists with an operator-supplied
password (`CPF_API_PASSWORD` env var, never committed with a real value);
it is safe only against a **fresh** database — Step 32 adds a
`schema_migrations` tracking table + `scripts/migrate.mjs` so re-runs
against an already-migrated database become a safe no-op instead of an
error.

Reverse proxy (TLS termination in front of the container — the API itself
speaks plain HTTP): a minimal reference `Caddyfile` —

```
api.example.eu {
    reverse_proxy localhost:4000
    encode gzip
}
```

— or the nginx equivalent (`proxy_pass http://127.0.0.1:4000;` inside a
`server { listen 443 ssl; ... }` block with a Let's Encrypt/ACME-issued
cert). Neither is run in CI; they are reference configuration only, to be
adapted to whichever EU-region runtime is chosen (Phase 1 close-out
decision, still open).


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
