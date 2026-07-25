# CPF Enterprise Ecosystem

**Evidence-based, human-reviewed AI-collaboration assessment for European enterprise hiring — with a roadmap into learning, workforce intelligence, and enterprise productivity.**

CPF (Candidate Performance Framework) evaluates *how people work with AI* on realistic, role-relevant work samples. Instead of an opaque score, CPF produces a human-finalised **Evidence Profile**: anchored criterion scores, per-dimension evidence bands, reviewer confidence, limitations, and interview follow-ups — every claim traceable to captured evidence.

> **Honest status (2026-07-25):** this repository is the greenfield foundation
> (Phase 0 → early Phase 1). The versioned assessment framework, transparent
> scoring engine, lifecycle guardrails, database schema, and framework API are
> implemented and tested. Identity, tenanted persistence flows, and all user
> interfaces are **designed but not yet implemented**. See
> [docs/status/completion-report.md](docs/status/completion-report.md) for the
> complete, category-by-category status. Nothing in this repository is claimed
> to be legally compliant or production-deployed.

## What CPF never does

These guardrails are enforced in the domain engine, database constraints, and tests — not just policy documents:

- ❌ No universal candidate score, ranking, pass/fail, or hire/reject output
- ❌ No automated rejection from metrics or integrity flags
- ❌ No hidden cutoffs
- ❌ No raw keystroke or full clipboard capture (rejected at ingestion and by DB constraint)
- ❌ No assessment session before candidate disclosure acknowledgement
- ❌ No employer report without a finalised human oversight record (rationale + confidence + limitations)

## Repository layout

```
apps/api                       Fastify API (framework catalogue + stateless scoring evaluation)
packages/assessment-framework  Versioned framework data, scoring engine, state machines (60 tests)
packages/db                    PostgreSQL migrations (RLS tenancy, append-only audit) + seed generator
tools/source-import            Reproducible workbook → framework JSON pipeline (Python)
docs/                          Discovery, product, architecture, compliance, security, agile, investor
.github/                       CI (typecheck, tests, audit, migration validation on real PostgreSQL)
```

## The assessment framework (v0.1.0)

Imported and normalised from the approved CPF Phase-1 workbook — the runtime never reads Excel:

- **10 assessment templates**: SE1–SE5 (software engineering), DM1–DM5 (digital marketing)
- **10 scoring dimensions** with weights (Verification 0.14, Domain Execution 0.14, Judgment 0.12, …)
- **18 criteria per template** (6 critical), each with observable standards, evidence requirements, red flags, and interview probes
- **Shared 1–5 anchors**, evidence-index bands (Limited / Mixed / Supported / Strong)
- **Governance controls**: critical-score concern threshold, reviewer-variance adjudication, minimum scored and evidence-note coverage

## Quick start

Prerequisites: Node 22 (`nvm use`), npm 10+. PostgreSQL via Docker optional.

```bash
npm install
npm run typecheck        # strict TS across all workspaces
npm test                 # 68 tests: framework data, scoring engine, state machines, API
npm run api:dev          # API at http://127.0.0.1:4000
```

Try it:

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/framework/templates
curl http://127.0.0.1:4000/v1/framework/templates/SE1
```

Evaluate reviewer scores (stateless — nothing persisted, no outcome produced):

```bash
curl -X POST http://127.0.0.1:4000/v1/scoring/evaluate \
  -H "content-type: application/json" \
  -d '{"templateCode":"SE1","assessments":[{"criterionId":"SE1-06","reviewer1Score":4,"evidenceNote":"Criterion-to-test mapping verified"}]}'
```

Database (requires Docker):

```bash
docker compose up -d     # PostgreSQL 16 + Mailpit; migrations auto-apply on first boot
npm run seed:generate    # framework JSON → packages/db/seed/generated/seed.sql
docker compose exec -T postgres psql -U cpf -d cpf < packages/db/seed/generated/seed.sql
```

## Documentation map

| Area | Where |
|---|---|
| Discovery (sources, legacy audit, risks, assumptions) | [docs/discovery](docs/discovery) |
| Product (vision, PRD, personas, roadmap) | [docs/product](docs/product) |
| Architecture + ADRs | [docs/architecture](docs/architecture), [docs/decisions](docs/decisions) |
| Data model | [docs/data](docs/data) |
| API standards | [docs/api](docs/api) |
| Design system & experience | [docs/design](docs/design) |
| Security | [docs/security](docs/security) |
| Compliance (GDPR, EU AI Act) | [docs/compliance](docs/compliance) |
| AI governance | [docs/ai-governance](docs/ai-governance) |
| Testing strategy | [docs/testing](docs/testing) |
| Agile backlog & delivery | [docs/agile](docs/agile) |
| Operations & runbooks | [docs/operations](docs/operations) |
| Investor pack | [docs/investor](docs/investor) |
| **Honest completion report** | [docs/status/completion-report.md](docs/status/completion-report.md) |

## Relationship to the legacy CPF repository

The original `CPF` repository (Next.js investor demo) was audited as a
**reference input only** — see
[docs/discovery/04-legacy-repo-audit.md](docs/discovery/04-legacy-repo-audit.md).
No code was copied. Its product concepts (evidence-first assessment, human
review, disclosure-first capture) were preserved; its demo-auth model, schema,
and UI were deliberately not.

## Licence

Proprietary — see [LICENSE](LICENSE).
