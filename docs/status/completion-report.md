# Completion Report — CPF Enterprise Ecosystem

Reporting date: 2026-07-25 (second build cycle) · Reporting standard:
directive §21 (no premature completion claims). This is the authoritative
status document.

## Release judgement

**NOT READY** for real candidate processing — by explicit gate, not by defect:
the legal-review register (LR-01…LR-04) and the remaining Phase-2 candidate/
reviewer/employer **user interfaces** block pilot. The backend platform now
executes the complete hiring workflow end-to-end with every governance
guardrail enforced and integration-tested against real PostgreSQL. No
compliance certification is claimed. No real candidate data has ever entered
this system.

## Fully implemented and tested — 92 automated tests green (verified locally 2026-07-25, two consecutive runs)

| Layer | Evidence |
|---|---|
| **Assessment framework v0.1.0** (10 templates × 18 criteria, 10 dimensions, anchors, controls) | 26 data-fidelity tests |
| **Transparent scoring engine** (weighted index, bands, critical concerns, variance→adjudication, coverage gates, no outcome vocabulary) | 12 engine tests |
| **Lifecycle state machines** (disclosure gate, report gate, pause/resume, reissue, DSR, oversight guard) | 14 machine tests |
| **Identity primitives** (scrypt w/ OWASP params, opaque hashed tokens, RFC 6238 TOTP against RFC test vectors, base32) | 17 identity tests |
| **Framework API** (catalogue, stateless evaluation, error contract, security headers) | 8 API tests |
| **Full platform integration on PostgreSQL 17** — everything below | **15 integration tests** |

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

## Defects found and fixed by our own tests this cycle (disclosed per §21)

1. Superuser DB connection silently bypassed RLS → dedicated `cpf_app`/`cpf_api`
   roles (migration 0004) + suite refuses superuser app connections.
2. Audit hash write/read canonicalisation mismatch → normalised-null hashing.
3. Reply-inside-transaction race (client could outrun COMMIT) → commit-before-
   send rule, applied to auth + portal routes, recorded in ADR-0007.
4. Enum-cast ambiguity in DSR transitions → explicit `::data_rights_status`.

## Implemented, awaiting first CI execution

GitHub Actions workflows (typecheck/test/audit/build + migrations + the same
integration job on PostgreSQL 16 with both roles) are committed but have not
run — the repository has not been pushed (no GitHub credentials in this
environment).

## Designed but not implemented (honest boundary)

- **All user interfaces** (candidate, reviewer, employer, platform admin) —
  complete specifications in docs/design; zero UI code exists.
- Notifications/e-mail delivery (invitation + activation tokens are returned
  to the operator for out-of-band delivery), file uploads, candidate imports,
  retention sweep scheduler (erasure service exists and is tested; the cron
  wrapper is CPF-26), rate-limiting middleware (CPF-43), OpenAPI generation
  (CPF-44), reviewer calibration gating (CPF-33), AI Collaboration Profile
  7-dimension rendering (CPF-30), evidence-band rule validation (CPF-31).
- AI features: **none exist**; gateway is a governed design (ADR-0005).

## Planned (later phases)

Billing/entitlements, support console, feature flags service, learning module,
workforce intelligence, productivity plugins — per release roadmap.

## Blocked by external access

GitHub repo creation/push/branch protection/first CI run · staging/production
provisioning · Docker Desktop engine (would not start in this environment —
integration verification used a local PostgreSQL 17 instance instead; compose
remains the documented path).

## Requires legal review (blocks pilot) — unchanged

LR-01 live-law verification · LR-02 AI Act classification + conformity route ·
LR-03 DPIA + lawful bases · LR-04 notices + employer terms · LR-06 legacy
repo secret rotation (founder action).

## Requires security review

External penetration test before pilot · TOTP-secret envelope encryption
(deployment) · evidence-ingestion threat-model refresh when the workspace
client lands.

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

## Verification evidence (commands, this machine, 2026-07-25)

- `npm run typecheck` — clean, strict, all workspaces.
- `npm test` — 92 passed / 0 failed / 1 intentionally-skipped placeholder
  (framework 60, identity 17, API 8+15) — run twice consecutively with
  `DATABASE_URL` (restricted role) + `DATABASE_ADMIN_URL`.
- `npm audit` — 0 vulnerabilities.
- Live boot: platform mode, bootstrap → login → org creation over HTTP.
