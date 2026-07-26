# CPF Enterprise Ecosystem

**Evidence-based, human-reviewed AI-collaboration assessment for European enterprise hiring — with a roadmap into learning, workforce intelligence, and enterprise productivity.**

CPF (Candidate Performance Framework) evaluates *how people work with AI* on realistic, role-relevant work samples. Instead of an opaque score, CPF produces a human-finalised **Evidence Profile**: anchored criterion scores, per-dimension evidence bands, reviewer confidence, limitations, and interview follow-ups — every claim traceable to captured evidence.

> **Honest status (2026-07-26, delivery-plan Step 50 — final acceptance sweep):**
> this repository contains a fully integration-tested backend (identity with
> scrypt + TOTP MFA + lockout + activation, multi-tenant persistence with
> forced row-level security under a restricted database role, the complete
> hiring workflow end-to-end, data-rights workflows with legal holds, a
> hash-chained append-only audit log, learning, workforce intelligence, an
> AI gateway with a kill switch, and a plugin/module framework) **and** a
> complete web application — employer portal, reviewer workspace, candidate
> portal, and platform administration, all against the real API with no
> mock data. **392 automated tests pass** (32 ai-gateway + 68 assessment-
> framework + 17 identity + 175/1-skip API integration + 100 web component/
> accessibility), verified green **twice consecutively**. See
> [docs/status/completion-report.md](docs/status/completion-report.md) for
> the complete, category-by-category status, including every disclosed gap.
> **Nothing in this repository is claimed to be legally compliant,
> production-deployed, or ready for real candidate processing** — see the
> release judgement in the completion report for the specific gates
> (counsel review, founder decisions) that remain.

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
apps/api                       Fastify modular monolith — identity, tenancy, hiring, candidate portal,
                               reviews, data rights, learning, workforce intelligence, AI gateway,
                               plugin/module framework (platform mode) + framework catalogue (always)
apps/web                       React 19 + Vite web application — employer portal, reviewer workspace,
                               candidate portal, platform administration (27 page components, no mock data)
packages/assessment-framework  Versioned framework data, scoring engine, state machines
packages/identity              scrypt passwords, opaque tokens, RFC 6238 TOTP
packages/ai-gateway            Governed AI orchestration: kill switch, model allow-list, PII redaction,
                               budget enforcement, evaluation harness (pure domain, no DB/HTTP dependency)
packages/db                    PostgreSQL migrations (forced RLS tenancy, append-only audit, app role)
tools/load                     k6 load-test scripts + seed fixture (Delivery Plan Step 48)
tools/docs-link-check.mjs      Scans docs/**/*.md for broken relative links
tools/source-import            Reproducible workbook → framework JSON pipeline (Python)
docs/                          Discovery, product, architecture, compliance, security, agile, investor
.github/                       CI: typecheck, tests, audit + migrations & integration scenarios on real
                               PostgreSQL; security: secret scan, CodeQL, SBOM, dependency review
```

## The assessment framework (v0.1.0)

Imported and normalised from the approved CPF Phase-1 workbook — the runtime never reads Excel:

- **10 assessment templates**: SE1–SE5 (software engineering), DM1–DM5 (digital marketing)
- **10 scoring dimensions** with weights (Verification 0.14, Domain Execution 0.14, Judgment 0.12, …)
- **18 criteria per template** (6 critical), each with observable standards, evidence requirements, red flags, and interview probes
- **Shared 1–5 anchors**, evidence-index bands (Limited / Mixed / Supported / Strong)
- **Governance controls**: critical-score concern threshold, reviewer-variance adjudication, minimum scored and evidence-note coverage

## Quick start (fresh clone → API + all four portals)

Prerequisites: Node 22 (`nvm use`), npm 10+, PostgreSQL 16+ reachable via `DATABASE_URL`/`DATABASE_ADMIN_URL` (Docker Compose provided below, or any local/managed instance).

```bash
git clone https://github.com/ANSHU-Ireland/CPF-2.0.git
cd CPF-2.0
npm install
npm run typecheck        # strict TS across all 6 workspaces
npm test                 # 392 tests (integration scenarios need DATABASE_URL + DATABASE_ADMIN_URL)
```

Bring up the database (Docker) and the full platform:

```bash
docker compose up -d     # PostgreSQL 16 + Mailpit; migrations + cpf_api role auto-apply
npm run seed:generate
docker compose exec -T postgres psql -U cpf -d cpf < packages/db/seed/generated/seed.sql
npm run build

# one-time platform administrator (choose your own credentials):
BOOTSTRAP_EMAIL=you@example.eu BOOTSTRAP_PASSWORD='a-long-password' \
DATABASE_URL=postgresql://cpf_api:cpf_local_dev@localhost:5432/cpf \
  node apps/api/scripts/bootstrap.mjs

# start the API (platform mode — identity, tenancy, hiring, reviews, data rights, learning, intelligence, AI gateway, plugins):
DATABASE_URL=postgresql://cpf_api:cpf_local_dev@localhost:5432/cpf npm run api:dev
```

In a second terminal, start the web application (all four portals — employer, reviewer, candidate, platform admin — are routes within the one app):

```bash
npm run dev -w @cpf/web   # Vite dev server, defaults to http://127.0.0.1:5173, proxies /v1 to the API
```

Open `http://127.0.0.1:5173`, sign in with the bootstrap admin credentials above, and you land on the platform employer directory. From there: create an organisation → sign in as its admin (via the activation token the API returns) → create a job profile and candidates → invite a candidate (the candidate portal link is the invitation's own URL, no separate login) → assign a reviewer → finalise a review → view the Evidence Profile. Every screen talks to the real API; there is no mock or stub data anywhere in the web app.

The API refuses production start without `DATABASE_URL`, and the database
role is a non-superuser member of `cpf_app` — row-level security is enforced
even against the application itself.

Try the framework-only mode (no database required) and stateless scoring:

```bash
npm run api:dev           # framework-only mode at http://127.0.0.1:4000 (no DATABASE_URL set)
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/framework/templates
curl http://127.0.0.1:4000/v1/framework/templates/SE1
curl -X POST http://127.0.0.1:4000/v1/scoring/evaluate \
  -H "content-type: application/json" \
  -d '{"templateCode":"SE1","assessments":[{"criterionId":"SE1-06","reviewer1Score":4,"evidenceNote":"Criterion-to-test mapping verified"}]}'
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
