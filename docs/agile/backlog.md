# Agile Backlog

Traceability: every item cites its source (Doc = co-founder document table,
WB = workbook sheet, DIR = directive section, AUD = legacy audit finding).

## Definition of Ready / Done — see definition-of-ready-done.md

## Epics

| Epic | Goal | Phase |
|---|---|---|
| E1 Foundation | Repo, CI, framework, schema, API core | 1 |
| E2 Identity & Tenancy | Hardened auth, org context, isolation proof | 1 |
| E3 Candidate Experience | Invitation → disclosure → workspace → submit → rights | 2 |
| E4 Review & Evidence | Queue → scoring → ledger → adjudication → finalisation | 2 |
| E5 Employer Experience | Jobs, candidates, imports, profiles, communications | 2 |
| E6 Platform Administration | Employer CRM, entitlements, support, flags, compliance ops | 3 |
| E7 Learning | Courses, pathways, learner portal, skills | 4 |
| E8 Workforce Intelligence | Privacy-first analytics | 5 |

## Sprint-ready stories (extract; IDs referenced across all docs)

### Done (this cycle)
- **CPF-01** ✅ Source import pipeline (WB) — 10 templates normalised, fidelity-tested.
- **CPF-02** ✅ Scoring engine with governance controls (WB Scoring Model) — 12 tests.
- **CPF-03** ✅ Lifecycle state machines incl. disclosure + report gates (Doc T21) — 14 tests.
- **CPF-04** ✅ Migrations 0001–0004: tenancy FORCE RLS, audit chain, assessment core, identity runtime, app role (Doc T17, AUD L2/L6).
- **CPF-05** ✅ Framework API + stateless evaluation + error contract (DIR §13) — 8 tests.
- **CPF-06** ✅ CI with real-PG migration + integration validation.
- **CPF-40** ✅ Identity module: scrypt, activation, lockout, TOTP MFA, session revocation (Doc T20, AUD L3) — integration-tested; SSO/OIDC remains planned.
- **CPF-42** ✅ Tenant-context middleware + API isolation matrix + RLS backstop test (DIR §15).
- **CPF-20** ✅ Disclosure API with versioned notices — gate enforced end-to-end.
- **CPF-22** ✅ Report issuance behind finalised human review — tested at API + DB layers.
- **CPF-23** ✅ Evidence-profile projection (bands/claims/probes, integrity separated, no index).
- **CPF-24** ✅ Evidence ingestion API: category allow-list, forbidden-event rejection, active-session precondition.
- **CPF-25** ✅ Data-rights workflows incl. candidate-raised erasure + legal holds (portal + org side).
- **CPF-27** ✅ Org read-model endpoints for the web UI: sessions pipeline, member directory, review detail (org/views.ts) — integration-tested incl. tenant isolation.
- **CPF-36** ✅ Web application: routing/auth/shell/session-restore + all 13 pages implemented against the real API — sign-in, platform employer directory, candidate CRM, template library, job profiles, sessions pipeline, team directory, data rights + legal holds, review queue, reviewer workspace (rubric scoring/preview/finalise), evidence profile (bands/probes, no verdict), candidate entry, and the full public candidate portal (disclosure gate, evidence workspace, real integrity signals, DSR self-service). 42 component/unit tests incl. an 11-test vitest-axe accessibility smoke suite; typechecked/built/browser-smoke-verified against the real API. No stub pages remain.
- **CPF-34** ✅ Employer responsible-use acknowledgement (Doc T22-P2) — migration 0005 (employer_acknowledgements, RLS+FORCE); GET/POST /v1/orgs/:orgId/acknowledgements/responsible-use; Evidence Profile endpoint returns 428 ACKNOWLEDGEMENT_REQUIRED until the viewer has acked the current document version; version-mismatch re-ack returns 409 STALE_DOCUMENT_VERSION; web interstitial gate before first profile view. Integration-tested (428→ack→200; stale version rejected).
- **CPF-21** ✅ **CPF-31** ✅ Evidence Ledger claims API + Doc T12 band developer-rules validation — GET/POST/PUT/DELETE `/v1/orgs/:orgId/reviews/:reviewId/claims(/:claimId)` on the existing `evidence_ledger_claims` table (migration 0002), reviewer-only + own-review-only, frozen (409) once the review is finalised; evidence references validated against the session's real `evidence_events` in a single `ANY($ids)` query; structural band rules enforced via `@cpf/assessment-framework`'s new `checkBandRule()` (Exceptional ≥2 refs + high confidence, Strong ≥2 refs, Some requires counter-evidence + limitations). Integration-tested (fake reference → 422; under-strength Strong → 422; full CRUD lifecycle; frozen-after-finalisation → 409).
- **CPF-30** ✅ AI Collaboration Profile rendering (7-dimension lens, ADR-0004) — evidence-profile endpoint now returns `collaborationProfile`: 7 dimensions each with the strongest band among the review's ledger claims (or "Not assessed"), and per-claim `{claim, band, limitations, counterEvidence}` — never evidence references or reviewer confidence, keeping employer-facing output free of raw evidence/session internals. Reviewer workspace gained a claims editor panel (create/edit/delete, evidence-reference checklist scoped to the session's real evidence events, band select with Doc T12 rule hints), frozen once the review is finalised. Evidence Profile page renders the collaboration profile section above the scoring dimension bands. Integration-tested (claims text present, event ids/payloads never present) and web-tested (7-dimension section renders, heading precedes "Dimension bands", no `evidenceReferences`/`reviewerConfidence` leakage).
- **CPF-33** ✅ Reviewer calibration records + assignment gating (Doc T22-P1) — migration 0006 (reviewer_calibration_records: org, reviewer, framework_version, status valid/expired/revoked, calibrated_at/expires_at, RLS+FORCE); admin endpoints POST/GET `/v1/orgs/:orgId/reviewer-calibrations` + DELETE (revoke); the existing session-review-assignment endpoint now checks `checkReviewerCalibrated()` and returns 422 `REVIEWER_NOT_CALIBRATED` unless the reviewer holds a valid, non-expired record for the session template's `frameworkVersion`; TeamPage gained a Calibration column (status pill + "Record calibration" action) for reviewer-role members. Integration-tested (uncalibrated assign → 422; calibrated → 201; expired record → 422; revoke → 204). Web-tested (calibration pill + record flow).
- **CPF-26** ✅ Retention sweep job — `apps/api/src/jobs/retention.ts`, runnable as `npm run retention:dry-run`/`retention:execute` in `apps/api` (also importable/testable as `runRetentionSweep()`). For each organisation with a configured `retention_policies` row, deletes `evidence_events` (by category — `workspace_evidence`/`integrity_signal`, each against its own retention-day setting) whose owning session is in a terminal status (`report_issued`/`withdrawn`/`expired`/`invalidated`) and past the window measured from the session's terminal `updated_at`, and anonymises candidates whose sessions are all terminal and past the evidence window — all suppressed entirely for any candidate under an active legal hold. Defaults to a dry run (counts only); `--execute`/`{execute: true}` applies. A per-category, per-org deletion cap (default 5000, configurable) skips an org's execution outright (still reporting counts) if exceeded, guarding against a mass-delete from a misconfigured policy. Writes one `retention.sweep_executed` audit entry per org per run with counts. `audit_log` and ledger/score data are untouched (retained for accountability; only removed via the explicit data-rights erasure workflow). Scheduling (cron/Task Scheduler) documented in the operations runbook. Integration-tested: dry-run reports without deleting, execute deletes only aged+unheld data, legal hold suppresses, cap guard skips execution, audit entry recorded, residual checks confirm zero remaining events + anonymised candidate for the eligible fixture and untouched data for the held fixture.
- **CPF-38** ✅ Double-scoring & adjudication workflow completion — migration 0007 (`reviews.second_reviewer_user_id`); new admin endpoint `POST /v1/orgs/:orgId/reviews/:reviewId/second-reviewer` (validates reviewer role, calibration, distinct from reviewer1, review not finalised); PUT `/v1/orgs/:orgId/reviews/:reviewId/scores` rewritten with actor-based field guards — reviewer1 may only write `reviewer1Score`, reviewer2 only `reviewer2Score`, org admin only `adjudicatedScore` (and only once both reviewer scores exist for that criterion) — returning 403 `FORBIDDEN`/422 `ADJUDICATION_SCORE_PREMATURE` otherwise; fixed a latent bug where the prior blanket UPSERT wrote all score columns on every save (a second writer would have nulled out the first reviewer's stored score — caught and fixed before any two-reviewer traffic existed). `@cpf/assessment-framework`'s `resolveScore()` already implemented the variance/adjudication resolution end-to-end and needed no changes. Web: SessionsPage gained an "Assign second reviewer" action + modal with a 20–30% sampling-guidance note; ReviewWorkspacePage is now actor-aware (reviewer1/reviewer2/admin), showing the other party's already-saved score read-only and restricting the writable radio group + save payload to the caller's own field. Integration-tested end-to-end with two real reviewer identities (second-reviewer assignment, same-reviewer rejection, forbidden-field 403s for both reviewers and admin, premature-adjudication 422, variance → blocked finalise → adjudication → finalise).

### Next (Phase 1/2 remainder)
- **CPF-43** Rate limiting + idempotency middleware. AC: per-token buckets;
  Idempotency-Key replay-safe on mutations.
- **CPF-44** OpenAPI generation from route schemas. AC: spec matches inject tests.
- **CPF-45** SBOM + secret scanning + SAST in CI (AUD L11).

### Phase 2 core remaining (each has full AC in PRD FRs)
- **CPF-32** Candidate workspace UI with approved-AI panel + auto-save/recovery (WB).
- **CPF-35** Candidate imports with partial-failure reports + dedupe merge (DIR §9).
- **CPF-37** Notification delivery (invitation, activation, DSR clocks) via mail adapter.

### Deferred / gated
- **CPF-50** Desktop integrity agent (Doc T22-P2) — **gated on legal review LR-04+**; session-scoped signals only.
- **CPF-41** SOC 2 evidence collection automation (Doc T19) — Phase 3.

## Sprint 1 proposal (next working cycle)
Goal: "A real org user can sign in securely and the platform proves tenant
isolation end-to-end." → CPF-40, CPF-42, CPF-43 + threat-model update + DPIA
scoping session. Demo: authz matrix test run + audit-chain walkthrough.
