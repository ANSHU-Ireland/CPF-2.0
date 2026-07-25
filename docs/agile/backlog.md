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

### Next (Phase 1/2 remainder)
- **CPF-43** Rate limiting + idempotency middleware. AC: per-token buckets;
  Idempotency-Key replay-safe on mutations.
- **CPF-44** OpenAPI generation from route schemas. AC: spec matches inject tests.
- **CPF-45** SBOM + secret scanning + SAST in CI (AUD L11).
- **CPF-26** Retention sweep scheduler over the tested erasure service (jobs + audit of runs).

### Phase 2 core remaining (each has full AC in PRD FRs)
- **CPF-21** Ledger claims API with band developer-rules validation (Doc T12) — schema ✅, endpoints pending.
- **CPF-30** AI Collaboration Profile rendering (7-dimension lens, ADR-0004).
- **CPF-31** Evidence-band rule validation (≥2 refs for Strong, etc.) (Doc T12).
- **CPF-32** Candidate workspace UI with approved-AI panel + auto-save/recovery (WB).
- **CPF-33** Reviewer calibration records + assignment gating (Doc T22-P1, WB protocol).
- **CPF-34** Employer responsible-use acknowledgement (Doc T22-P2).
- **CPF-35** Candidate imports with partial-failure reports + dedupe merge (DIR §9).
- **CPF-36** Reviewer / employer / candidate / admin web applications per docs/design specs.
- **CPF-37** Notification delivery (invitation, activation, DSR clocks) via mail adapter.

### Deferred / gated
- **CPF-50** Desktop integrity agent (Doc T22-P2) — **gated on legal review LR-04+**; session-scoped signals only.
- **CPF-41** SOC 2 evidence collection automation (Doc T19) — Phase 3.

## Sprint 1 proposal (next working cycle)
Goal: "A real org user can sign in securely and the platform proves tenant
isolation end-to-end." → CPF-40, CPF-42, CPF-43 + threat-model update + DPIA
scoping session. Demo: authz matrix test run + audit-chain walkthrough.
