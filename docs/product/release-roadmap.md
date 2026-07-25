# Release Roadmap

Honest categories per milestone: **Done/tested · Implemented/awaiting review ·
Partial · Designed · Planned · Blocked · Requires legal/security/commercial
review.** Nothing below is a date promise; sequencing is dependency-driven.

## Phase 0 — Discovery & Product Definition ✅ (this repository, 2026-07-25)
Audits, source import pipeline, framework data v0.1.0, registers, PRD core,
architecture + ADRs, compliance scaffolding, backlog, investor pack skeleton.

## Phase 1 — Enterprise Foundation (in progress)
| Deliverable | Status |
|---|---|
| Repo, CI, standards, docs tree | ✅ done |
| Assessment framework package (data + scoring + machines, 60 tests) | ✅ done |
| DB schema: tenancy, RLS, audit chain, assessment core | ✅ implemented; CI-validated migrations (workflow ready; first run on GitHub) |
| Framework API (catalogue + stateless evaluation, 8 tests) | ✅ done |
| Identity & authentication module (Argon2id, MFA, sessions, revocation) | 🔴 planned — CPF-40, blocks all personal-data endpoints |
| Tenanted persistence services + API-level isolation tests | 🔴 planned — CPF-42 |
| Design system tokens + component specs | 🟡 specified (docs/design); no UI code yet |
| Observability baseline (structured logs ✅, traces/metrics 🔴) | partial |

## Phase 2 — Assessment Platform (pilot wedge: 2 templates per A-03)
Candidate portal (disclosure gate, workspace, recovery, rights centre) ·
Reviewer workspace (queue, evidence viewer, rubric, adjudication, ledger,
finalisation) · Employer portal (jobs, candidates, imports, invitations,
profile viewer with responsible-use ack) · Evidence ingestion API with
forbidden-event rejection · Communications · Accommodations · Retention jobs.
**Gate to real candidates: compliance "blocks-pilot" register cleared + counsel
sign-off (LR-01…LR-04).**

## Phase 3 — CPF Administration & Commercial Operations
Employer CRM, subscriptions/entitlements, billing readiness, support console
(JIT access), feature flags service, compliance operations console, platform
analytics, reviewer-minutes telemetry → pricing model from measured data.

## Phase 4 — Learning & Development
Course/pathway management, learner portal, learning assessments reusing the
framework engine, skills profiles, manager views with aggregate-only analytics,
learning-records separation from hiring evidence (constraint from workbook).

## Phase 5 — Workforce Intelligence (privacy-first)
Pain-point collection, skills-gap and AI-adoption analytics, token-cost
analytics. Hard rules: aggregate reporting with k-anonymity floors, no
individual surveillance dashboards, works-council consultation pack before any
org enablement.

## Phase 6 — Enterprise Productivity Modules
Plugin framework, workflow assistants built on learned patterns, integrations
(HRIS/ATS via stable APIs), automation with human approval gates.

## Cross-phase tracks
Security hardening (each phase) · Accessibility (every UI ships WCAG 2.2 AA-
reviewed) · AI governance (every AI feature passes the register + evaluation
before enablement) · Compliance evidence pack maintenance.
