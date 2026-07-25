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

## The product (built vs planned)

**Built and tested today (2026-07-25):**
- Versioned assessment framework v0.1.0: 10 role templates (software
  engineering + digital marketing), 10 weighted dimensions, 180 criteria with
  observable standards, red flags, and interview probes — imported from the
  authored assessment workbook through a reproducible pipeline.
- Transparent scoring engine with governance controls **enforced in code**:
  no score/rank/verdict output, critical-concern flags instead of rejections,
  reviewer-variance adjudication, evidence-coverage gates. 60 domain tests.
- Lifecycle guardrails: no assessment without disclosure acknowledgement; no
  employer report without a finalised human review (rationale + confidence +
  limitations). Enforced in state machines **and** database constraints.
- Multi-tenant PostgreSQL schema with row-level security, append-only
  hash-chained audit log, data-rights and retention/legal-hold models.
- API serving the framework catalogue + stateless evaluation; CI validating
  migrations and tenant isolation on real PostgreSQL.

**Designed, not yet built:** the three portals (candidate, reviewer, employer),
identity/MFA, evidence ingestion, AI reviewer-assist (governed, kill-switchable),
billing, learning and intelligence modules. See release roadmap.

## Why defensible

1. **Compliance-by-construction** in the most regulated assessment domain —
   guardrails live in domain types, state machines, DB constraints, and tests,
   producing an audit trail regulators and enterprise procurement can inspect.
2. **Evidence architecture** (Evidence Ledger → human-finalised profile) is a
   product primitive competitors bolt on as PDF reports.
3. **Calibration discipline** (anchors, double-scoring, adjudication,
   validity studies) creates data-network effects per role family.

## Business model (hypotheses — to be validated with paid design partners)

Platform subscription + per-assessment usage + role-pack licensing.
Reviewer marketplace/managed review as margin layer. **Unit economics are
deliberately unpriced until reviewer minutes are measured on ~30 real reviews
per role (workbook directive). The EUR 18/review cost assumption from the 5Y
plan is treated as optimistic and unverified.**

## Go-to-market

2 pilot templates (1 SE + 1 DM) with 3–5 paid design partners → calibration
(20–30 candidates/template, double-scored) → beta validation (50–100,
reliability + fairness monitoring) → paid deployment with 30/60/90-day outcome
tracking. Gate to scale: reviewer consistency ≈0.75 weighted kappa, no
unexplained subgroup patterns, repeat purchase intent. (12-week sequence from
the assessment workbook.)

## Open strategic decisions (founder-level, flagged honestly)

1. Commercial model: assessment platform vs placement vs managed talent (A-02).
2. Wedge roles: these templates (SE+DM) vs the 5Y plan's original NOW roles (A-03).
3. Pilot template pair selection from paid demand.

## Risk & mitigation (top 5 of 15 — full register in repo)

Employer misuse as auto-verdict → product friction + contract terms + score-free
reports · Reviewer economics → measure before pricing · Reviewer consistency →
calibration machinery · Regulatory (high-risk AI classification) → conservative
high-risk design posture + counsel-gated pilot · Wedge indecision → escalated
with decision framework.

## Use of funds (indicative categories, not commitments)

Phase 1–2 completion (identity, portals, ingestion) · calibration studies with
design partners · compliance work-products (DPIA, conformity route, notices) ·
pilot operations.

## Demo script (current, honest)

1. `npm test` — 68 green tests including guardrail proofs.
2. `npm run api:dev` → browse the SE1 template: staged workflow, 18 criteria,
   anchors, probes.
3. POST a scored review → evidence profile with bands, adjudication flags,
   coverage gates — and point out what's absent: any score, any verdict.
4. Walk the schema: RLS policies, append-only audit trigger, disclosure gate.
5. Close on the roadmap with the built/designed boundary explicit.

## Data-room index

Product: vision, PRD, roadmap · Technical: architecture, ADRs, data model,
test strategy + results · Compliance: posture, registers, legal-review list ·
Delivery: backlog, completion report · This brief.
