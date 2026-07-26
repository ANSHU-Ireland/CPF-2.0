# Completion Report — CPF Enterprise Ecosystem

Reporting date: 2026-07-26 (sixth build cycle — delivery-plan Steps 30–39:
GitHub push + green CI, production container, staging runbook, observability,
backup/restore drill, subscriptions & entitlement enforcement, support
console, compliance console, platform analytics + reviewer-minutes
telemetry) · Reporting standard: directive §21 (no premature completion
claims). This is the authoritative status document.

**Merge status note:** this report reflects work verified on this step's own
feature branch (`feat/step-39-platform-analytics`, branched from `main` at
`ce70408`). Steps 30–38 were each implemented, tested, and reported on their
own feature branches per the established PR-per-step workflow; at the time of
writing `main` itself has Steps 1–29 plus Steps 37/38 merged (PRs #3/#4) —
Steps 30–36 exist on still-open branches pending user review/merge via the
GitHub web UI. This section reports the cumulative state across all of them
honestly, regardless of merge order.

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

## Fully implemented and tested — 254 automated tests green, 1 intentionally skipped (verified locally 2026-07-26)

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

## Sixth build cycle additions (Steps 30–39, disclosed per §21)

1. **GitHub push + CI (Step 30):** first push to `https://github.com/ANSHU-Ireland/CPF-2.0` — both workflows (`ci`, `security`) went green on the first real run. Branch protection deliberately deferred (founder decision, revisit before any real collaborator/pilot).
2. **Production container (Step 31, CPF-?):** multi-stage `apps/api/Dockerfile` (non-root user, `tini` PID 1, HTTP healthcheck), a `production` Compose profile, and a `container-smoke` CI job that builds and boots the image against a real Postgres service — proven in CI since this environment has no local Docker engine.
3. **Staging runbook (Step 32):** a `schema_migrations` tracking table + idempotent `migrate.mjs` script (safe against both a genuinely fresh DB and an already-migrated pre-Step-32 environment), and a completed operations runbook (env-var table, secrets checklist, EU-region provider shortlist, DNS/TLS, rollback note). Actual staging provisioning remains USER-GATED (no cloud credentials in this environment).
4. **Observability (Step 33):** Prometheus metrics behind `METRICS_ENABLED` (HTTP histogram, evidence/audit counters, retention gauges), optional OpenTelemetry tracing (genuine no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set), and trace-id correlation into both audit-log metadata and request logs.
5. **Backup/restore drill (Step 34, MILESTONE):** a real, repeatable `pg_dump`/`pg_restore` drill script, run twice against this machine's local PostgreSQL 17 — both runs independently re-verified the restored copy's audit hash chain (1,631 real entries) and template-version row count. Explicitly labelled a local mechanism proof, not the production backup path (managed-provider automated snapshots + WAL PITR).
6. **Subscriptions & entitlements (Steps 35–36, CPF-54):** platform-owned `plans`/`org_subscriptions` tables (no RLS — platform-only visibility, by design), plan CRUD + org suspend/resume (a suspended org gets `403 ORG_SUSPENDED` on every org-scoped route, checked once per request via the existing `requireOrgRole` guard), a `requireModuleEntitlement` guard applied across every assessment-related route, per-plan `maxActiveAssessments` enforcement (`422 PLAN_LIMIT_REACHED`), and a usage-vs-limit dashboard on the Team page.
7. **Support console / JIT access (Step 37, CPF-?):** time-boxed, audited `support_access_grants` (≤4h expiry, org-admin-approved or platform-admin break-glass, always dual-logged in both org and platform audit scopes) gating a metadata-only cross-org summary endpoint — no evidence-content access exists, and none is granted by any current scope value.
8. **Compliance operations console (Step 38):** a paginated/filtered audit-log explorer, step-up-gated CSV export (personal-data egress requires fresh re-authentication), and a retention-policy editor, all org-admin-only, unified into one `CompliancePage` in the web app.
9. **Platform analytics + reviewer-minutes telemetry (Step 39, MILESTONE, this step):** `reviews.started_at` (set on a reviewer's first saved score) makes `finalised_at − started_at` a real, measurable "reviewer minutes" figure. New org-level analytics endpoint (`GET /v1/orgs/:orgId/analytics` — own-org-only data: assessments by status/template, median reviewer minutes by template, completion rate, and a candidate-level "challenge rate" derived from data-rights `challenge` requests) and a platform-level endpoint (`GET /v1/platform/analytics`, platform-admin-only, aggregated across every organisation). Per-template platform cells are suppressed (`null`, never a fabricated `0`) unless at least 5 distinct organisations have used that template, preventing a low-cardinality cell from being read back to a single org's private data — enforced with a new, narrow, read-only row-level-security escape hatch (migration 0015's `platform_read_all()`, added to `USING` only, never to `WITH CHECK`, so it can never be used to write or move data across a tenant boundary). Both org and platform web dashboards show each figure's definition inline. This is the evidence base the plan calls for feeding into the pricing decision (R-09); the actual pricing decision itself remains a founder call (A-02).

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

GitHub Actions workflows (typecheck/test/audit/build + migrations + the same
integration job on PostgreSQL 16 with both roles) are committed but have not
run — the repository has not been pushed (no GitHub credentials in this
environment).

## Designed but not implemented (honest boundary)

- File uploads beyond the CSV import path (e.g. resume/document attachments) —
  no binary upload/malware-scanning pipeline exists yet; not required until one is added.
- Learning module, workforce intelligence, AI gateway, plugin/module framework
  — none started (Steps 40–46).
- Actual staging/production provisioning — the runbook and container are
  ready (Steps 31–32), but real provisioning needs cloud credentials this
  environment doesn't have (USER-GATED).
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

Actual staging/production provisioning (runbook + container ready, needs real
cloud credentials) · Docker Desktop engine (would not start in this
environment — integration verification and the backup/restore drill both used
a local PostgreSQL 17 instance instead; the container path is proven via a
dedicated CI job) · branch protection (deferred by founder choice).

## Requires legal review (blocks pilot) — unchanged

LR-01 live-law verification · LR-02 AI Act classification + conformity route ·
LR-03 DPIA + lawful bases · LR-04 notices + employer terms · LR-06 legacy
repo secret rotation (founder action).

## Requires security review

External penetration test before pilot (not run in this environment) ·
TOTP-secret envelope encryption (deployment) · production deployment
hardening review (needs real staging/production environment to review against).

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
- `npm test` — 254 passed / 0 failed / 1 intentionally-skipped, run twice
  consecutively for stability (framework 65, identity 17, API 115+1 skip,
  web 57) with `DATABASE_URL` (restricted role) + `DATABASE_ADMIN_URL` set.
- `npm audit` — 0 vulnerabilities (across all workspaces incl. @cpf/web).
- `npm run build` — succeeds (framework + identity + API build ordering).
- `npx vite build` (@cpf/web) — succeeds.
- Live boot: platform mode, bootstrap → login → org creation over HTTP.
- Live web smoke test: sign-in → real API data rendered → session-restore →
  stub-page/404/sign-out all correct (browser-automated; predates the stub
  pages being replaced with real implementations, kept for history).
- Backup/restore drill (Step 34) run twice against this machine's local
  PostgreSQL 17: both exits 0, audit chain + template-version counts verified
  on the restored copy.
