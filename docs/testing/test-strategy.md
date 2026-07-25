# Testing Strategy

Principle: guardrails and money-path logic get tests before UI exists.
A change is not done while critical tests fail (Definition of Done).

## Current automated coverage (68 tests, all passing 2026-07-25)

| Suite | Tests | What it proves |
|---|---|---|
| framework-data | 26 | Import fidelity: 10 dims (Σw=1), bands, controls, 10 templates × 18 criteria (Σw=1), dimension referential integrity, 6 critical + full probes each |
| scoring engine | 12 | Exact weighted arithmetic; band boundaries (0.55/0.70/0.85 inclusive); critical-concern flag; variance→adjudication; averaging <trigger; adjudicated resolution; coverage gates (scores + notes); unknown/duplicate rejection; **no outcome vocabulary in output**; real-SE1 integration |
| state machines | 14 | Disclosure gate (no start without ack); report gate (no issue before finalised review); pause/resume; reissue; conflict decline; adjudication routing; oversight completeness guard; DSR lifecycle; no "rejected" state exists |
| API | 8 | Health + security headers; catalogue summaries (no rubric leak); full template fetch; 404 contract; evaluate happy path (+governance note); 400 validation; 422 domain error |

## CI (implemented in .github/workflows/ci.yml)

typecheck (strict) → tests → build → audit (prod, high+) → seed generation →
**migration job against real PostgreSQL 16**: applies 0001/0002, seeds 10
template versions, asserts version count, asserts RLS enabled on all tenant
tables.

## Test matrix for critical flows (Phase 2 — written before the features)

| Flow | Required tests |
|---|---|
| Tenant isolation | API-level: authenticated org A cannot read/write any org B resource (every endpoint, automated matrix) — CPF-42 |
| AuthN/AuthZ | Role × capability matrix from permission-matrix doc; step-up for exports; session revocation |
| Evidence ingestion | Category allow-list; forbidden events rejected (raw_keystroke, external_clipboard_content); no ingestion without disclosure or outside active session; server-timestamp integrity |
| Data rights | Access package completeness; erasure across evidence/scores/claims + verification query; restriction honoured; legal-hold suppresses deletion; due-date clocks |
| Retention | Deletion job honours per-category clocks + holds; audit of every run; restore-safety (no orphan PII) |
| Scoring persistence | Round-trip: stored scores → engine → profile identical to stateless result; frozen-version binding |
| Report issuance | Impossible without finalised review (API + DB layers both asserted) |
| Accessibility | axe automated on every screen + manual SR pass per release |
| Performance | Profile p95 <500ms; ingestion burst (candidate typing) sustained; k6 load before pilot |
| Migrations | Forward-apply on production-like volume; additive-only lint |

## AI evaluation tests
Per AI-governance framework: golden-set agreement, injection suite, reference-
integrity validator, bias probes — gate feature flags, run in CI nightly when
AIF-01 development starts.
