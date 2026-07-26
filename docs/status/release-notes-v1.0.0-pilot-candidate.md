# Release notes — v1.0.0-pilot-candidate

Date: 2026-07-26 · Delivery-plan Step 50 (final acceptance sweep, all 50 steps complete)

## Why "pilot-candidate", not "1.0.0" unqualified

Every automated test passes, twice consecutively, and every real CI defect
found during this final sweep has been fixed. That is a genuine, verified
engineering milestone — but it is **not** the same claim as "production-ready"
or "legally cleared". This tag means: *a design partner could plausibly begin
a supervised pilot on this codebase*, not *this is certified for unsupervised
production use*. See the release judgement in
[completion-report.md](completion-report.md) for the specific counsel-review
and founder-decision gates that remain before real candidate data should
touch this system.

## Scope of this release

All 50 delivery-plan steps, spanning:

- **Identity & tenancy**: scrypt passwords, opaque hashed tokens, RFC 6238
  TOTP MFA, lockout, activation, forced row-level security under a
  non-superuser database role.
- **Complete hiring workflow**: invitation → disclosure → session → evidence
  capture → double-scoring → adjudication → finalisation → Evidence Profile.
- **Data rights**: access/export/erasure/objection workflows with legal-hold
  suppression and a scheduled retention sweep.
- **Governance**: hash-chained append-only audit log, human-oversight
  records required before any employer-facing report, rate limiting +
  idempotency-key replay safety.
- **Learning** and **Workforce Intelligence** modules, each with a k-anonymity
  floor on aggregate signals.
- **AI Gateway**: kill switch, model allow-list, PII redaction, budget
  enforcement, a single reviewer-assist endpoint — disclosed as backed by a
  synthetic (not real) evaluation golden set pending ≥30 real double-scored
  sessions.
- **Plugin/module framework** with its first module, Workflow Insights
  (proposal-only automation, human approve/dismiss required, no execution).
- **Full web application**: 27 page components across 4 portals (employer,
  reviewer, candidate, platform admin) against the real API, no mock data.
- **Accessibility**: 29/29 axe tests across all pages, zero violations;
  verified colour-contrast math and keyboard tab order. Manual
  NVDA/VoiceOver pass remains open (USER-GATED, no AT available in this
  environment).
- **Performance**: k6 load verification against a 1,000-session dataset, all
  thresholds passed, one proactive index added (migration 0021).
- **Compliance evidence pack**: RoPA, DPIA, AI Act readiness map,
  traceability matrix, subprocessor register, legal-review handoff package,
  draft candidate notices — all ⚖️ COUNSEL-GATED, none claimed as final.

## Test evidence

392 automated tests pass, 1 intentionally skipped, verified **twice
consecutively** on 2026-07-26:

| Workspace | Files | Tests |
|---|---|---|
| `@cpf/ai-gateway` | 7 | 32 |
| `@cpf/assessment-framework` | 4 | 68 |
| `@cpf/identity` | 2 | 17 |
| `@cpf/api` | 13 | 175 passed, 1 skipped |
| `@cpf/web` | 30 | 100 |

## Real CI defects found and fixed this cycle

This release was not tagged on the assumption that CI was green — the actual
GitHub Actions run history was queried (`gh run list`, `gh run view
--log-failed`) and two genuine, previously undetected defects were found and
fixed before tagging, per the project rule "never tag with red tests, fix
forward first":

1. **`ai-assist` reply-before-commit race** (`apps/api/src/modules/org/ai-gateway.ts`)
   — the route sent its HTTP response from inside its database transaction,
   ahead of COMMIT, causing flaky `test/ai-gateway.test.ts` failures on
   GitHub Actions' runners (not reliably reproducible on a fast local
   Postgres). Fixed by returning a plain outcome descriptor from the
   transaction and deferring all replies until after commit — the same
   pattern already used in `auth/routes.ts` and `candidate/portal.ts`
   (ADR-0007).
2. **`dependency-review` CI job false failure** (`.github/workflows/security.yml`)
   — the preflight script only recognised two specific error-message
   strings as "gracefully skip"; GitHub's actual response was a bare `403
   Forbidden` with no matching text, hard-failing this job on every PR since
   Step 45. Fixed by treating any 403/404/422 response as "unsupported for
   this repository, skip gracefully".

Full details, including the exact CI run IDs reviewed: see
[completion-report.md](completion-report.md)'s "Defects found and fixed"
list, items 10–11.

## Fresh-clone verification

A clean clone of this branch was built and tested end-to-end from scratch
(`npm install` → `npm run typecheck` → `npm test` → `npm run build` →
bootstrap script → manual smoke of all four portals) to confirm the
repository is runnable by another developer with no hidden local state. See
[completion-report.md](completion-report.md)'s "Final acceptance sweep"
section for the command sequence and outcome.

## Source archive

A reproducible source tarball of this exact tagged commit can be regenerated
at any time with:

```bash
node tools/release/make-source-archive.mjs
```

This wraps `git archive` (tracked files only, no `node_modules`, no local
`.env`/database state) and writes to `dist/` (gitignored) — it is not
committed as a binary artifact in this repository.

## What is explicitly USER-GATED (not closeable by this codebase alone)

- Counsel review of the legal-review register, LR-01…LR-06
  ([legal-review-handoff.md](../compliance/legal-review-handoff.md)).
- Founder decisions A-02 (commercial model) and A-03 (initial wedge roles).
- Real hosting, SMTP, and AI-provider vendor selection and provisioning.
- Merging the Step 48–50 pull requests into `main` via the GitHub web UI.
- Pushing the `v1.0.0-pilot-candidate` git tag to the shared remote — created
  locally as part of this release, push withheld pending explicit user
  confirmation (operational-safety guardrail: pushing a tag to a shared
  remote is a hard-to-reverse, shared-system action).
- A manual NVDA/VoiceOver accessibility pass by a human tester.

## Recommended pilot sequence

Unchanged from the assessment workbook's original 12-week plan: 2 pilot
templates (1 software-engineering + 1 digital-marketing) with 3–5 paid
design partners → calibration (20–30 candidates/template, double-scored,
producing the first real `median_reviewer_minutes` data) → beta validation
(50–100 candidates) → paid deployment with 30/60/90-day outcome tracking.
