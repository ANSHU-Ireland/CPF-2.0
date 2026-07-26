# Investor Brief — CPF Enterprise Ecosystem

**Accuracy rule: this document distinguishes built reality from roadmap.
Anything not marked "built" is a plan or hypothesis. No compliance
certification is claimed anywhere.**

## Executive summary

CPF is an EU-first talent-assessment platform that shows employers **how
candidates actually work with AI** — through human-reviewed, evidence-linked
work samples — instead of an automated score. The wedge product serves hiring
for AI-era knowledge roles; the same evidence architecture extends into
employee learning, workforce intelligence, and enterprise productivity.

## The problem (validated by sources; market sizing = hypothesis pending research)

- Employers can't distinguish real AI-collaboration ability from prompt
  theatre; interviews and CVs don't show verification behaviour, judgement, or
  escalation — the capabilities that determine whether AI-assisted work is safe.
- Surveillance-style assessment tools damage candidate trust and carry GDPR /
  EU AI Act exposure precisely in the highest-risk domain: employment.

## The product (built vs planned — refreshed 2026-07-26, Delivery Plan Step 49)

**Built and tested today**, across employer, reviewer, candidate, and
platform-admin portals, all against a real PostgreSQL 17 database with
row-level security (no mock data remaining anywhere):

- Versioned assessment framework v0.1.0: 10 role templates (software
  engineering + digital marketing), 10 weighted dimensions, 180 criteria with
  observable standards, red flags, and interview probes.
- Transparent scoring engine with governance controls **enforced in code**:
  no score/rank/verdict output, critical-concern flags instead of rejections,
  reviewer-variance adjudication, evidence-coverage gates.
- Lifecycle guardrails: no assessment without disclosure acknowledgement; no
  employer report without a finalised human review (rationale + confidence +
  limitations) — enforced in state machines **and** database constraints.
- Full identity/auth: scrypt password hashing, RFC 6238 TOTP MFA, account
  lockout, session management, activation/reset flows — no demo-auth path
  exists in any build.
- All three portals live end-to-end: candidate (disclosure gate, AI-assisted
  workspace, real integrity signals, self-service data rights), reviewer
  (queue, double-scoring/adjudication, calibration status), employer
  (candidates, jobs, sessions pipeline, evidence profiles — never a verdict),
  and platform admin (organisations, subscriptions/entitlements, support
  console, platform-wide analytics with k-anonymity floors).
- Two full commercial/product modules beyond the core assessment wedge:
  **Learning** (courses, enrollments, completion tracking) and **Workforce
  Intelligence** (pain-point themes, skills-gap aggregates, a plugin/module
  framework with a first productivity module — Workflow Insights — that
  proposes, never executes, recommendations; a human approves or dismisses
  every one).
- **AI Gateway** package: a single governed entry point for any future AI
  call — kill switch, model allow-list/pinning, PII redaction before any
  external call, budget enforcement, bounded retry/timeout, and a
  golden-set evaluation harness. **Honestly disclosed**: this gateway is not
  yet wired into a live user-facing feature; its first candidate use
  (reviewer-assist suggestions) is built and evaluated against a small
  *synthetic* golden set only (5 fabricated cases, 100% precision/recall
  against a 0.7 threshold) — the internal governance bar (≥30 real
  double-scored sessions) is not yet met, so the feature stays gated OFF.
- Full accessibility audit: automated axe coverage across all 27 page
  components (zero violations), two real WCAG contrast defects found and
  fixed via genuine sRGB luminance calculation, keyboard tab-order verified
  with zero positive `tabindex` anywhere in the codebase. One disclosed
  exception: no NVDA/VoiceOver screen-reader pass has been performed (no
  assistive technology available in this build environment) — an open,
  human-tester-required item, not fabricated as done.
- Performance/load verification: k6 load tests against a 1,000-session
  seeded dataset — all four scenarios (login, sessions-list, evidence-profile
  read, candidate event submission) passed their `p95 < 500ms` thresholds on
  the first real run, with headroom of 10–100x. **Local-environment result
  only** — no multi-tenant/concurrent-load or production-infrastructure test
  has been performed; see the operations runbook for the full caveat.
- 175 passing automated tests in the API integration suite alone (1
  intentionally skipped), plus dedicated unit-test suites per package and a
  100-test `apps/web` component/accessibility suite — the full count is
  tracked, not rounded, in `docs/status/completion-report.md`.

**Designed, not yet built**: candidate desktop integrity agent (Phase 4,
explicitly gated on legal review LR-04+), billing/payment processing, a live
user-facing AI reviewer-assist feature (built + evaluated, not yet enabled —
see above), multi-region/production infrastructure (still local-only).

## Why defensible

1. **Compliance-by-construction** in the most regulated assessment domain —
   guardrails live in domain types, state machines, DB constraints, and 175+
   automated tests, producing an audit trail regulators and enterprise
   procurement can inspect. A full requirement-traceability matrix
   (`docs/compliance/traceability-matrix.md`) and a counsel-ready
   legal-review handoff package (`docs/compliance/legal-review-handoff.md`)
   now exist so this claim can be checked line by line, not taken on faith.
2. **Evidence architecture** (Evidence Ledger → human-finalised profile) is a
   product primitive competitors bolt on as PDF reports.
3. **Calibration discipline** (anchors, double-scoring, adjudication,
   validity studies) creates data-network effects per role family.
4. **AI governed at the platform layer, not per-feature** — the AI Gateway's
   kill switch, redaction, and budget controls apply to every future AI
   feature by construction, not by developer discipline alone.

## Business model (hypotheses — to be validated with paid design partners)

Platform subscription + per-assessment usage + role-pack licensing.
Reviewer marketplace/managed review as margin layer. **Unit economics remain
deliberately unpriced.** A `median_reviewer_minutes` metric is now
implemented and queryable (`apps/api/src/modules/org/analytics.ts`) — it
measures wall-clock time from a review's first score save to its
finalisation, per organisation and platform-wide (suppressed below a
k-anonymity floor at the platform level). **Honestly disclosed**: no real
candidate has ever used this platform, so no real reviewer-minutes number
exists yet — this cycle's load-test fixtures created only synthetic review
records for read-path performance testing, not a timed reviewer exercise.
The metric is proven to work in code and tests; the EUR 18/review cost
assumption from the 5Y plan remains unverified until it is run on ~30 real
reviews per role (workbook directive) with paid design partners.

## Go-to-market

2 pilot templates (1 SE + 1 DM) with 3–5 paid design partners → calibration
(20–30 candidates/template, double-scored, generating the first real
`median_reviewer_minutes` data) → beta validation (50–100, reliability +
fairness monitoring) → paid deployment with 30/60/90-day outcome tracking.
Gate to scale: reviewer consistency ≈0.75 weighted kappa, no unexplained
subgroup patterns, repeat purchase intent. (12-week sequence from the
assessment workbook.)

## Open strategic decisions (founder-level, flagged honestly)

1. Commercial model: assessment platform vs placement vs managed talent (A-02).
2. Wedge roles: these templates (SE+DM) vs the 5Y plan's original NOW roles (A-03).
3. Pilot template pair selection from paid demand.
4. No hosting/SMTP/AI-model vendor has been chosen — the AI Gateway and
   notification queue are built provider-agnostic specifically so this
   decision doesn't block engineering progress, but it does block any real
   deployment.

## Risk & mitigation (top 5 of 15 — full register in repo)

Employer misuse as auto-verdict → product friction + contract terms + score-free
reports · Reviewer economics → measure before pricing (metric now implemented,
awaiting real data) · Reviewer consistency → calibration machinery · Regulatory
(high-risk AI classification) → conservative high-risk design posture +
counsel-gated pilot (full legal-review handoff package now indexed for
counsel) · Wedge indecision → escalated with decision framework.

## Use of funds (indicative categories, not commitments)

Calibration studies with design partners (to generate the first real reviewer-
minutes and cost-per-review data) · legal sign-off on the DPIA/notices/
conformity-assessment route already drafted · production infrastructure
(the platform is currently local-development-only) · pilot operations.

## Demo script v2 — full portal journey (Delivery Plan Step 49, honest)

1. `npm run typecheck && npm test` — full green suite across every workspace
   (175+ API integration tests twice-consecutively verified, plus per-package
   unit suites and the `apps/web` 100-test accessibility-inclusive suite).
2. **Platform admin**: sign in, create an employer organisation, assign a
   subscription plan with module entitlements, view platform-wide analytics
   (k-anonymity floor visibly suppresses any small-cohort metric).
3. **Employer portal**: as the new org's admin, create a job profile, import
   candidates via CSV (with a partition report for invalid rows), send an
   invitation, watch the sessions pipeline populate, open an issued Evidence
   Profile — point out what's absent: any score, any verdict, any rank.
4. **Candidate portal**: accept an invitation, walk through the disclosure
   gate (notices must be opened before starting — point out the DRAFT labels
   and LR-04 pending status, said out loud, not hidden), start the session,
   submit workspace evidence, request an accommodation, submit a data-rights
   request.
5. **Reviewer workspace**: pick up the session, score against the frozen
   rubric with inline anchors, see the variance-adjudication gate trigger,
   finalise with rationale/confidence/limitations, issue the report.
6. **Governance walkthrough**: show the RLS policies blocking cross-tenant
   access live (query as the wrong org, get zero rows); show the audit hash
   chain; show the AI Gateway's kill switch and redaction step in code
   (feature not yet enabled in any UI — say so).
7. Close on the roadmap with the built/designed boundary explicit, and hand
   over `docs/status/completion-report.md` for the full itemised evidence
   list.

## Data-room index (refreshed, Step 49)

- **Product**: vision & principles, PRD (assessment suite), release roadmap.
- **Technical**: architecture overview, ADRs 0001–0007, logical data model,
  test strategy + `docs/status/completion-report.md` results.
- **Compliance** (all new/expanded this step): `compliance-overview.md`
  (posture, RoPA, DPIA draft, AI Act readiness map, subprocessor register),
  `candidate-notices-draft.md` (full DRAFT notice text), `traceability-matrix.md`
  (requirement → implementation → test), `legal-review-handoff.md` (single
  indexed package of every open legal question, phrased for counsel).
- **AI governance**: `ai-governance.md` (feature register, evaluation
  framework, human-oversight framework).
- **Operations**: environments, deployment reference, incident/backup/
  retention/notification runbooks, and the new capacity-model/load-test
  results section (Step 48).
- **Delivery**: agile backlog (every shipped item cross-referenced to its
  delivery-plan step), this brief.
