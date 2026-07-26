# Completion Report — CPF Enterprise Ecosystem

Reporting date: 2026-07-26 (sixth build cycle — delivery-plan Steps 30–34:
GitHub push + first CI run, production container image, staging deployment
runbook + migration tracking, observability wiring, backup/restore drill
[MILESTONE]) · Reporting standard: directive §21 (no premature completion
claims). This is the authoritative status document.

## Release judgement

**NOT READY** for real candidate processing — by explicit gate, not by defect:
the legal-review register (LR-01…LR-04, notably the LR-04 candidate-facing
notice content, which the portal currently renders as labelled DRAFT
placeholder copy) blocks pilot. The backend platform executes the complete
hiring workflow end-to-end with every governance guardrail enforced and
integration-tested against real PostgreSQL. **All 13 planned web application
pages are now implemented against the real API (no mock data, no stubs
remaining)** — employer portal, reviewer workspace, candidate portal, and
platform administration. No compliance certification is claimed. No real
candidate data has ever entered this system.

## Fully implemented and tested — 204 automated tests green on `main`, 1 intentionally skipped (verified locally 2026-07-26; rises to 208 once the open Step 33 observability PR merges, plus migration/container coverage from the open Step 31/32 PRs)

| Layer | Evidence |
|---|---|
| **Assessment framework v0.1.0** (10 templates × 18 criteria, 10 dimensions, anchors, controls) | 26 data-fidelity tests |
| **Transparent scoring engine** (weighted index, bands, critical concerns, variance→adjudication, coverage gates, no outcome vocabulary) | 12 engine tests |
| **Lifecycle state machines** (disclosure gate, report gate, pause/resume, reissue, DSR, oversight guard) | 14 machine tests |
| **Identity primitives** (scrypt w/ OWASP params, opaque hashed tokens, RFC 6238 TOTP against RFC test vectors, base32) | 17 identity tests |
| **Framework API** (catalogue, stateless evaluation, error contract, security headers) | 8 API tests |
| **Full platform integration on PostgreSQL 17** — everything below, plus double-scoring & adjudication (CPF-38), a scheduled retention sweep with legal-hold suppression (CPF-26), an outbound-mail notification queue with retry/backoff/dead-letter (CPF-37), candidate CSV bulk import with a partition report (CPF-35), and token-bucket rate limiting + Idempotency-Key replay safety (CPF-43) | **25 integration tests, 1 intentionally skipped** |
| **Web application** — all 13 pages real, no stubs remaining: sign-in, platform employer directory, candidate CRM (now with CSV import), assessment template library, job profiles, sessions pipeline (now with second-reviewer assignment), team directory (now with calibration status), data rights + legal holds, review queue, reviewer workspace (actor-aware double-scoring/adjudication), evidence profile (bands/probes, no verdict), candidate entry, and the full public candidate portal (disclosure gate, evidence workspace, real integrity signals, DSR self-service) | 48 component tests (incl. 11 vitest-axe accessibility smoke tests across the app's core screens) + a live browser smoke test |

Integration-verified end-to-end journeys (real HTTP → real database, restricted
non-superuser role):

1. **Complete hiring journey:** org admin → job profile → candidate (duplicate
   → 409) → invitation (frozen SE1 version, hashed single-use token) →
   candidate portal → accept → **start blocked before disclosure (409)** →
   acknowledge → start → accommodation recorded → evidence events (workspace +
   integrity accepted; `raw_keystroke` **rejected 422**; reviewer-decision
   category from candidate **rejected 422**) → pause/resume → submit →
   **report blocked before review (409)** → reviewer assignment (non-reviewer
   → 422) → evidence view with integrity signals separated → scores validated
   against frozen version → **variance ≥2 blocks finalisation until
   adjudicated** → finalise (rationale+confidence+limitations) → issue report →
   **evidence profile: 10 dimension bands, 18 probes, accommodations note,
   governance note — zero outcome vocabulary, zero raw evidence.**
2. **Tenant isolation:** org B sees nothing of org A (list, direct-object 404,
   path 403); **RLS backstop proves zero rows without tenant context** under
   the restricted `cpf_api` role.
3. **Audit chain:** hash chain verifies over 10+ real entries; tampering blocked
   at two layers (no grant + append-only trigger).
4. **Data rights:** candidate-raised erasure → **legal hold blocks fulfilment
   (409)** → release → erasure executes → events deleted, identity anonymised,
   portal token dead (404).
5. **Account lifecycle:** invite → single-use activation (weak password → 422;
   token reuse → 422) → login; lockout after 5 failures (423); TOTP enrollment
   → login requires code → logout revokes session immediately.

Live smoke test (this machine): `bootstrap.mjs` → platform-mode boot → login →
employer organisation created via API with first-admin activation token.

Live **web** smoke test (this machine, browser-automated): unauthenticated `/`
redirects to `/login` → sign-in succeeds → lands on `/platform/organisations`
with the employer directory rendered from real API data (not mocked) → reload
preserves the session (no re-login flash) → an unbuilt route renders its
typed stub, not a dead link → an unknown route renders a 404 with a working
recovery link → sign-out clears the session and returns to `/login`. Every
request in the API access log returned 200; no console/network errors.

## Fourth build cycle additions (Steps 20–24, disclosed per §21)

1. **Double-scoring & adjudication (CPF-38):** a second reviewer can be
   assigned per session (calibration-gated, distinct from reviewer 1); score
   writes are now actor-scoped by field (reviewer1/reviewer2/admin-only
   adjudication) — this also caught and fixed a latent bug where the prior
   blanket score UPSERT would have silently overwritten the first reviewer's
   score once a second reviewer started saving.
2. **Retention sweep (CPF-26):** `npm run retention:dry-run`/`retention:execute`
   deletes aged evidence events and anonymises candidates once every session
   is terminal and past its configured retention window, suppressed entirely
   for any candidate under an active legal hold, with a per-org/per-category
   deletion cap as a guard against a misconfigured policy.
3. **Notifications (CPF-37):** an outbound-message queue with exponential
   backoff and dead-lettering after 5 attempts, delivered via a console
   adapter by default or SMTP when configured — invitation and
   activation-token issuance now enqueue a real notice rather than only
   returning the token to the caller for manual delivery. Candidate-facing
   e-mail delivery remains out of scope pending a consent/enablement setting.
4. **Candidate CSV import (CPF-35):** bulk candidate creation from a
   `name,email` CSV (≤1MB, ≤2000 rows) with per-row validation, in-file and
   existing-record dedupe, a formula-injection guard on stored names, and a
   partition report (created/duplicate/invalid) surfaced in the web UI with a
   downloadable rejects file.
5. **Rate limiting + Idempotency-Key (CPF-43):** an in-memory token-bucket
   limiter (stricter buckets on `/v1/auth/*` and `/v1/candidate/*`, honestly
   documented as single-node only — `RateLimitStore` is the seam for a future
   Redis-backed implementation) returns 429 + `retry-after`; invitation
   creation, candidate import, and candidate-raised data-rights requests all
   support an `Idempotency-Key` header that replays the original stored
   response on a matching retry and rejects a same-key-different-body replay
   with 422, rather than double-creating records on client retry.

## Fifth build cycle additions (Steps 25–29, disclosed per §21)

1. **Supply-chain & static analysis in CI (CPF-45):** `.github/workflows/security.yml` adds secret scanning (gitleaks, full history), CodeQL (javascript-typescript), SBOM generation (CycloneDX), and PR dependency review. Fixed a genuine pre-existing lockfile defect found while wiring this up: `@types/react`'s dependency on `csstype` had no resolved entry in `package-lock.json`, silently never installed.
2. **Session & authorization hardening (CPF-46):** sliding session renewal clamped to a hard 24h absolute cap regardless of activity; an admin endpoint to remove a user's org role, which revokes all of that user's active sessions and refuses to leave an org with zero admins; step-up re-authentication (password + TOTP if enrolled) gating a new admin-only org data-export endpoint.
3. **Authorization matrix automation (CPF-47):** a table-driven test asserting deny-by-default across every org-scoped route (30 distinct path templates, 37 method combinations) × every role (5 org roles, no token, cross-org), cross-checked at test time against the live OpenAPI spec so an unlisted new route breaks the test immediately. Confirmed two roles (`learning_admin`, `support_agent`) are correctly denied by literally every existing route, since neither is wired to any endpoint yet.
4. **Threat-model refresh + ingestion fuzz testing (Step 29, MILESTONE):** `docs/security/security-architecture-and-threat-model.md` rewritten with a per-threat status column reflecting implemented reality; new fuzz test suite sends malformed JSON, oversized bodies (both transport `bodyLimit` and application-level checks), unicode (emoji/CJK/RTL), and prototype-pollution-shaped keys (`__proto__`, `constructor.prototype`) to the candidate evidence-ingestion endpoint — every case resolves to a safe, correctly classified status and the process's real `Object.prototype` is never mutated. Log redaction verified two ways: a unit test of the exact redact config against a raw pino instance, and an end-to-end capture of a real authenticated request's log stream confirming a genuine bearer token is never emitted.

## Sixth build cycle additions (Steps 30–34, disclosed per §21)

Note on workflow: starting this cycle, delivery work moved to a PR-per-step
model at the user's request (a feature branch per step, pushed to GitHub, the
user merges via the web UI) rather than direct commits to `main`. At the time
of this report, Steps 31–33's PRs are pushed and awaiting the user's merge —
their code is fully implemented and verified on their respective branches
(as described below) but not yet part of `main`'s history; Step 30 is merged.

1. **GitHub push + first CI run (CPF-49, Step 30):** the repository was
   pushed to GitHub for the first time; both workflows (`ci`, `security`)
   went green on the first real run against PostgreSQL 16 in CI. Branch
   protection was deliberately deferred (user's explicit choice, to be
   revisited before any real collaborator or pilot). The authenticated `gh`
   CLI identity was found to have only read (`pull`) access to the repo —
   a different, lower-privileged credential than whatever performs actual
   `git push` operations — so native GitHub security-setting toggles
   (Dependabot alerts, secret-scanning/push-protection) could not be enabled
   via the API and require a real admin via the GitHub web UI.
2. **Production container image (CPF-50, Step 31):** a 4-stage multi-stage
   `apps/api/Dockerfile` (non-root user, `tini` PID 1, Node-native
   `HEALTHCHECK`), a `docker-compose.yml` production profile (separate `db`
   service from the local-dev one, to avoid double-applying migrations), and
   a new CI `container-smoke` job that builds the image, runs it against a
   real PostgreSQL 16 service container, and polls `/health` for
   `"mode":"platform"`. No local Docker engine is available in this
   environment, so correctness is proven only via CI — this had not yet been
   confirmed green as of this report (the PR is open).
3. **Staging deployment runbook + migration tracking (CPF-51, Step 32,
   partially user-gated):** a new idempotent `packages/db/scripts/migrate.mjs`
   tracks applied migrations in a new `schema_migrations` table (migration
   0011) and safely retrofits any environment where 0001–0010 were already
   applied by hand; verified locally against both a fresh throwaway database
   and the existing local dev database (retrofit path), including idempotent
   re-runs. The unused `SESSION_SECRET` was removed from `.env.example` (dead
   configuration — sessions are opaque hashed tokens, never signed). The
   operations runbook gained an exact env-var reference table, a secrets
   checklist, an EU-region provider shortlist (Hetzner recommended default),
   and a DNS/TLS reference. Actual staging provisioning was **not** performed
   — it requires real cloud credentials this environment doesn't have; the
   user was asked and chose to defer it.
4. **Observability wiring (CPF-52, Step 33):** `GET /metrics` (Prometheus
   text format, off by default, internal-network-only by convention — no
   application-level auth) exposing a request-duration histogram plus
   evidence-event/audit-append counters and retention-run gauges.
   OpenTelemetry tracing, genuinely no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT`
   is set, with deliberately narrow (HTTP + `pg` only) instrumentation to
   limit dependency weight. When active, the current trace id is merged into
   every audit-log entry's metadata via the single `appendAudit` chokepoint
   every module already writes through, correlating a log line, an audit
   entry, and a trace for one event. Manually smoke-tested end-to-end against
   the built server binary.
5. **Backup/restore drill (Step 34, MILESTONE):** new
   `apps/api/scripts/backup-restore-drill.mjs` — `pg_dump` (custom format) →
   throwaway restore-target database → `pg_restore` → assertions against the
   restored copy (assessment-template-version count matches source; the
   tamper-evident audit chain independently re-verifies as valid over 1,631
   real entries and the entry count matches). **Actually run twice against
   this machine's local PostgreSQL 17 instance, both times exiting 0 with all
   assertions passed** (not merely designed — genuinely executed; see
   Verification evidence below for the exact result). Honest scope: this is
   a local drill proving the pg_dump/pg_restore mechanism and the audit-chain
   verification logic both work end-to-end; it is explicitly documented as
   **not** the production backup mechanism (managed-provider automated
   snapshots + WAL PITR, per the operations runbook's backup & restore
   runbook) — a real managed-Postgres PITR restore-to-new-instance drill
   still needs to be run quarterly once a real staging/production database
   exists.

## Defects found and fixed by our own tests this cycle (disclosed per §21)

1. Superuser DB connection silently bypassed RLS → dedicated `cpf_app`/`cpf_api`
   roles (migration 0004) + suite refuses superuser app connections.
2. Audit hash write/read canonicalisation mismatch → normalised-null hashing.
3. Reply-inside-transaction race (client could outrun COMMIT) → commit-before-
   send rule, applied to auth + portal routes, recorded in ADR-0007.
4. Enum-cast ambiguity in DSR transitions → explicit `::data_rights_status`.
5. **(Phase B)** Importing any symbol from `@cpf/assessment-framework`'s root
   barrel in browser code pulled in a `node:fs` (`readFileSync`) dependency
   transitively, breaking `vite build` (invisible to `tsc --noEmit`) — fixed
   with a pure `./state-machines` subpath export; documented in repo memory
   as a standing convention for future pure-module additions.
6. **(Phase B, caught by its own accessibility test)** The Evidence Profile
   page's "no verdict" disclaimer copy literally contained the words "hire"
   and "reject", which its own `/hire/i`/`/reject/i` regex test correctly
   flagged — reworded to remove outcome vocabulary entirely.
7. **(Phase B, caught by the new vitest-axe accessibility smoke suite)**
   Five data tables had an empty, unlabelled trailing `<th>` for the actions
   column (axe `empty-table-header`) — fixed with visually-hidden "Actions"
   text. The shared `EmptyState`/`ErrorState` primitives rendered `<h3>`
   directly under a page's `<h1>` with no `<h2>` in between (axe
   `heading-order`) on every page's empty/error state — both now render
   `<h2>`, fixing the violation across every page that uses them.
8. **(Fifth cycle, caught by Step 29's ingestion fuzz test)** The global error
   handler fell through to a blanket `500 INTERNAL_ERROR` for any Fastify-
   native error it did not explicitly special-case — including malformed-JSON
   request bodies, which Fastify itself already classifies as `400` —
   misreporting a client mistake as a server fault. Fixed: any error carrying
   a Fastify-assigned 4xx `statusCode` not already special-cased is now
   honestly forwarded with that status instead of defaulting to 500.

## Implemented, awaiting first CI execution

GitHub Actions workflows for `container-smoke` (Step 31) are committed on an
open, unmerged PR branch (`feat/step-31-container`) and have not yet had a
confirmed CI run — the branch is pushed but awaiting the user's PR merge.
The original `ci`/`security` workflows (typecheck/test/audit/build +
migrations, CodeQL/SBOM/secret-scan) have run and gone green on `main`
(Step 30).

## Designed but not implemented (honest boundary)

- File uploads beyond the CSV import path (e.g. resume/document attachments) —
  no binary upload/malware-scanning pipeline exists yet; not required until one is added.
- AI gateway, plugin/module framework, learning module, workforce intelligence,
  platform admin console (support/compliance/analytics) — none started (Steps 35–46).
- Staging/production themselves remain unprovisioned (no real cloud
  credentials in this environment) — the container image, migration tooling,
  observability wiring, and a backup/restore drill mechanism are all built
  and verified (Steps 31–34), but nothing has been deployed anywhere real.
- AI features: **none exist**; gateway is a governed design (ADR-0005). The
  candidate portal explicitly states no AI assistant is configured, rather
  than simulating one.
- Candidate-portal notice content is DRAFT placeholder copy pending LR-04
  legal review — the UI labels this honestly rather than presenting
  unreviewed text as final.

## Planned (later phases)

Billing/entitlements, support console, feature flags service, learning module,
workforce intelligence, productivity plugins — per release roadmap.

## Blocked by external access

Branch protection enablement (native GitHub API blocked by the authenticated
`gh` CLI identity's read-only permissions — needs a real admin via the web
UI) · staging/production provisioning (needs real cloud credentials) · Docker
Desktop engine (would not start in this environment — integration
verification used a local PostgreSQL 17 instance instead; the
`container-smoke` CI job is the only way the production container image gets
proven correct, pending that PR's merge and a confirmed green run).

## Requires legal review (blocks pilot) — unchanged

LR-01 live-law verification · LR-02 AI Act classification + conformity route ·
LR-03 DPIA + lawful bases · LR-04 notices + employer terms · LR-06 legacy
repo secret rotation (founder action).

## Requires security review

External penetration test before pilot (not run in this environment) ·
TOTP-secret envelope encryption (deployment) · a real managed-Postgres PITR
restore drill once staging/production exists (the local drill mechanism
itself has been run and passed — see Sixth build cycle additions) ·
production deployment hardening review against a real environment (Steps
31–32 built the mechanism; nothing has been deployed anywhere real yet).

## Requires commercial decision (founders)

A-02 business model · A-03 pilot template pair · pricing after reviewer-minute
measurement.

## Known limitations (disclosed)

1. Candidate portal authenticates with the invitation token (single audience,
   hashed, expiring); step-up identity for repeat candidates is A-11.
2. Lawful-basis value in disclosure records is controller-configured content
   pending LR-04; recorded as `controller_determined`.
3. TOTP secrets stored unencrypted at the application layer (DB/at-rest
   encryption is a deployment control; KMS envelope tracked).
4. Local integration verification used PostgreSQL 17; CI pins 16 — both in the
   supported window, dual-version coverage is deliberate.
5. Supplementary PDFs (pitch deck, readiness reports) not machine-extracted
   this cycle (A-07).
6. English-only framework content v0.1.0.
7. Accessibility verification is automated smoke-level (vitest-axe across 11
   representative page renders, colour-contrast rule disabled because
   happy-dom does not apply real computed styles) plus reliance on native
   semantic HTML (buttons, `<dialog>`, radio groups, `<details>`) for keyboard
   operability — this is not a substitute for a manual assistive-technology
   audit before pilot.

## Verification evidence (commands, this machine, 2026-07-26, sixth cycle)

- `npm run typecheck` — clean, strict, all 4 workspaces (including @cpf/web).
- `npm test` — 204 passed / 0 failed / 1 intentionally-skipped on `main`, run
  twice consecutively for stability (framework 65, identity 17, API 74+1
  skip, web 48) with `DATABASE_URL` (restricted role) + `DATABASE_ADMIN_URL`
  set.
- `npm audit` — 0 vulnerabilities (across all workspaces incl. @cpf/web).
- `npm run build` — succeeds (framework + identity + API build ordering).
- `npx vite build` (@cpf/web) — succeeds.
- **Backup/restore drill (Step 34)** — `node apps/api/scripts/backup-restore-drill.mjs`
  run twice against this machine's local PostgreSQL 17 `cpf` database, both
  runs exiting 0: `pg_dump` (custom format) → fresh throwaway
  `cpf_backup_restore_drill` database → `pg_restore` → assertions against the
  restored copy passed both times (10 assessment-template-version rows match;
  the tamper-evident audit chain independently re-verifies as valid over
  1,631 real entries, entry count matches source) — genuinely executed, not
  simulated.
- Live boot: platform mode, bootstrap → login → org creation over HTTP.
- Live web smoke test: sign-in → real API data rendered → session-restore →
  stub-page/404/sign-out all correct (browser-automated; predates the stub
  pages being replaced with real implementations, kept for history).
