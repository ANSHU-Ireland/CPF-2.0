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
Scheduled job (Phase 2, CPF-26): per-org policy → collect due records per
category → skip legal holds → anonymise/delete per mode → write audit entries
with counts → verification query proves no orphaned PII → monthly sample audit.
Manual erasure (DSR): same pipeline, single-subject scope, dual-confirmation.

## Runbook: AI kill switch (when AI features exist)
Org scope: org_admin toggles feature flag → gateway refuses invocations →
reviewer UI falls back to human-only (always functional). Platform scope:
platform_admin disables provider/model → in-flight requests time out safely.
Verify: invocation log shows zero calls post-switch.
