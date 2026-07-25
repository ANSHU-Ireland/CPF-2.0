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
- **CPF-04** ✅ Migrations 0001–0002: tenancy RLS, audit chain, assessment core (Doc T17, AUD L2/L6).
- **CPF-05** ✅ Framework API + stateless evaluation + error contract (DIR §13) — 8 tests.
- **CPF-06** ✅ CI with real-PG migration validation + RLS assertion.

### Next (Phase 1 completion)
- **CPF-40** Identity module (Doc T20, AUD L3). *As an org user I sign in with
  Argon2id-hashed credentials + TOTP MFA so no demo-auth path exists.*
  AC: rate-limited login; session rotation on privilege change; revocation;
  auth audit events; no personal-data endpoint reachable unauthenticated;
  security review sign-off. Deps: none. Tests: authz matrix, lockout, revocation.
- **CPF-42** Tenant-context middleware + API isolation test matrix (DIR §15).
  AC: SET LOCAL org id per txn; cross-tenant matrix green on every endpoint.
- **CPF-43** Rate limiting + idempotency middleware. AC: per-token buckets;
  Idempotency-Key replay-safe on mutations.
- **CPF-44** OpenAPI generation from route schemas. AC: spec matches inject tests.
- **CPF-45** SBOM + secret scanning + SAST in CI (AUD L11).

### Phase 2 core (each has full AC in PRD FRs)
- **CPF-20** Disclosure API + versioned notices (Doc T22-P0) — schema ✅, endpoints + content.
- **CPF-21** Ledger claims API with band developer-rules validation (Doc T12).
- **CPF-22** Report issuance endpoint behind oversight gate (Doc T22-P0) — guard ✅.
- **CPF-23** Evidence-profile projection: bands/claims/probes, no index, integrity separated (Doc §11).
- **CPF-24** Evidence ingestion API: category allow-list, forbidden-event rejection, disclosure + active-session preconditions (Doc §8.2).
- **CPF-25** Candidate data-rights portal workflows (Doc T22-P1) — machine ✅.
- **CPF-26** Retention & deletion jobs honouring legal holds (Doc T22-P1).
- **CPF-30** AI Collaboration Profile rendering (7-dimension lens, ADR-0004).
- **CPF-31** Evidence-band rule validation (≥2 refs for Strong, etc.) (Doc T12).
- **CPF-32** Candidate workspace with approved-AI panel + auto-save/recovery (WB).
- **CPF-33** Reviewer calibration records + assignment gating (Doc T22-P1, WB protocol).
- **CPF-34** Employer responsible-use acknowledgement (Doc T22-P2).
- **CPF-35** Candidate imports with partial-failure reports + dedupe merge (DIR §9).

### Deferred / gated
- **CPF-50** Desktop integrity agent (Doc T22-P2) — **gated on legal review LR-04+**; session-scoped signals only.
- **CPF-41** SOC 2 evidence collection automation (Doc T19) — Phase 3.

## Sprint 1 proposal (next working cycle)
Goal: "A real org user can sign in securely and the platform proves tenant
isolation end-to-end." → CPF-40, CPF-42, CPF-43 + threat-model update + DPIA
scoping session. Demo: authz matrix test run + audit-chain walkthrough.
