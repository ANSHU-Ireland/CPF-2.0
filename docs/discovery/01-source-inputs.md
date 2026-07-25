# Discovery — Source Inputs Inventory

Date: 2026-07-25 · Status: complete for available inputs

## Inputs analysed

| # | Input | Location at analysis time | Role in this project |
|---|---|---|---|
| 1 | `CPF_AI_Collaboration_Profile_Evaluation_Method.docx` (22 Jul 2026) | Co-founder document | Primary methodology source: Evidence Ledger, AI Collaboration Profile, guardrails, compliance rationale, developer backlog |
| 2 | `CPF_Phase1_AI_Native_Talent_Assessment_Templates.xlsx` | Assessment workbook | Primary framework source: 10 templates, scoring model, calibration protocol, governance controls |
| 3 | Legacy repository `Desktop\CPF` | Existing codebase | Reference only — audited, not copied (see 04-legacy-repo-audit.md) |
| 4 | `EU_AI_Product_Engineer_v2` skill | Methodology | Operating model for this build: bounded autonomy, assumption ledger, evidence-based release outcomes |
| 5 | `CPF_Pitch_Deck.pdf`, `CPF_Product_Readiness_Report.*`, `CPF_System_and_Product_Overview_v1.2.pdf` | Supplementary | Not machine-extracted this cycle; referenced by the workbook ("CPF 5Y Plan" slides). Flagged for later ingestion |

## Extraction pipeline (reproducible)

- `tools/source-import/transform_workbook.py` converts the approved workbook
  into versioned JSON under `packages/assessment-framework/data/`.
  Verified output: 10 templates × 18 criteria (6 critical each), weights
  summing to 1.0, 100% interview-probe linkage, 10 dimensions, 5 anchors,
  4 evidence-index bands, 4 governance controls.
- The co-founder document was analysed manually; its normative content is
  captured in 02-cofounder-document-analysis.md and encoded in the domain
  engine and schema.
- Raw extraction artefacts live in `.tmp-extract/` (gitignored — source
  documents are confidential and are not committed).

## Key structural finding: two scoring vocabularies

The two primary sources use **different dimension sets**:

| Source | Dimensions | Nature |
|---|---|---|
| Workbook "Scoring Model" | 10: Decomposition, Context, Tool Choice, Verification, Correction, Judgment, Escalation, Domain Execution, Client Readiness, Trust & Safety | Operational v0.1 scoring arithmetic with weights, anchors, controls |
| Co-founder document §4 | 7: Problem framing, Prompt direction, Iteration & steering, Verification & scepticism, Output ownership, Efficiency & proportionality, Integrity context | Employer-facing AI Collaboration Profile lens with evidence bands |

**Resolution (recorded in ADR-0004):** these are complementary layers, not a
contradiction. The 10-dimension model is the *reviewer scoring instrument*;
the 7-dimension profile is the *employer-facing narrative lens* assembled by
the reviewer from Evidence Ledger claims. Both are versioned data. The
integrity dimension is structurally separated in both sources, which the
schema enforces via evidence-event categories.
