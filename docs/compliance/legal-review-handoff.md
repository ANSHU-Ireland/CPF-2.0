# Legal Review Handoff Package (Delivery Plan Step 49)

**Purpose**: a single index of every item in this codebase/doc-tree that is
marked ⚖️ COUNSEL-GATED or tracked in the legal-review register, with the
specific question counsel needs to answer for each — so a lawyer can review
this one document rather than hunting across the repository. **Nothing in
this package is legal advice, and nothing here should be read as a
compliance claim.** No real candidate data has ever been processed by this
system.

## How to use this package

For each item: read the linked evidence, then answer the "Question for
counsel" cell. Until answered, the item stays OPEN and blocks whatever it is
listed as blocking in the "Blocks" column.

## Legal-review register (LR items)

| ID | Question for counsel | Evidence to review | Blocks |
|---|---|---|---|
| **LR-01** | Please confirm the current consolidated text, application dates, and any 2026 amendments/harmonised standards for the EU AI Act (Reg. 2024/1689) that affect our Annex III(4) employment-context classification. This build was authored offline against a co-founder document's characterisation of the Act, not a live legal-database check. | [`docs/compliance/compliance-overview.md`](../compliance/compliance-overview.md) (Legal snapshot section) | Pilot |
| **LR-02** | Please confirm whether this platform, as built, should be classified as a high-risk AI system provider under Annex III(4), and if so, the conformity-assessment route we must follow before any real recruitment deployment. If our design choices (no automated scoring, human-finalised review required, no AI-driven decision) change this classification, please say so explicitly. | [`docs/compliance/traceability-matrix.md`](../compliance/traceability-matrix.md) (EU AI Act table); [`docs/ai-governance/ai-governance.md`](../ai-governance/ai-governance.md) | Real recruitment use |
| **LR-03** | Please review the DPIA draft below and confirm: (a) it is scoped correctly for a systematic evaluation of natural persons in an employment context using new technology, (b) the lawful-basis reasoning holds per our intended launch country, (c) what remains to be added before this can be signed off. | [`docs/compliance/compliance-overview.md`](../compliance/compliance-overview.md) §"DPIA draft" | Pilot |
| **LR-04** | Please review the candidate-facing notice drafts (privacy, AI-use, telemetry, assessment-rules) and either approve, redline, or replace the text. Confirm the controller/processor allocation statement and DPO contact requirement. Once approved, we will bump `NOTICE_VERSIONS` in code (never edit the existing DRAFT version in place). | [`docs/compliance/candidate-notices-draft.md`](../compliance/candidate-notices-draft.md) | Pilot |
| **LR-05** | Please confirm whether any works-council or employee-representative consultation is required in our launch countries for the Phase 4–5 features (desktop integrity agent, manager-facing workforce-intelligence views) before they are built, not just before they ship. | [`docs/agile/backlog.md`](../agile/backlog.md) CPF-50; [`docs/discovery/06-risk-register.md`](../discovery/06-risk-register.md) | Phase 4 |
| **LR-06** | The legacy repository (pre-rebuild) had committed secrets (`.env` files). Please confirm whether any rotation, disclosure, or other legal obligation attaches to that exposure, independent of this rebuild. | Founder-level item; no code evidence in this repository (the new repo has never committed a secret — verified by the CI secret-scan step) | Immediate founder action |

## Other ⚖️-marked items outside the LR-01…06 numbering

| Item | Question for counsel | Evidence | Status |
|---|---|---|---|
| GDPR Art. 6/13/14 notice content | See LR-04 above | [`docs/discovery/08-constraints-and-compliance-gaps.md`](../discovery/08-constraints-and-compliance-gaps.md) row | Folded into LR-04 |
| National employment-law overlays per launch country | Please identify any country-specific recruitment/assessment rules (e.g., algorithmic-hiring disclosure laws, works-council co-determination) that apply beyond GDPR/AI-Act baseline, for whichever country the first pilot targets. | [`docs/discovery/08-constraints-and-compliance-gaps.md`](../discovery/08-constraints-and-compliance-gaps.md) | Open — depends on founder decision A-02/A-03 (pilot geography/template), not yet made |
| Subprocessor register | Once SMTP/hosting/model-provider vendors are chosen (see `docs/compliance/compliance-overview.md` §Subprocessor register), please confirm DPA + EU-data-location/transfer requirements before any is contracted. | [`docs/compliance/compliance-overview.md`](../compliance/compliance-overview.md) §"Subprocessor register" | Open — no vendor chosen yet (founder decision, not made) |
| AI Act Art. 43 conformity assessment | See LR-02 | [`docs/compliance/traceability-matrix.md`](../compliance/traceability-matrix.md) | Open — blocks pilot |

## What is explicitly NOT included in this handoff (by design)

This package intentionally does not attempt to answer any legal question
itself, does not draft contract terms, and does not make a classification
determination. Every "Question for counsel" cell above is phrased as a
question, not a proposed answer, to avoid the exact failure mode this
project's own guardrails exist to prevent: a technical team quietly making a
legal determination by default. Founder decisions A-02 (commercial model)
and A-03 (pilot template/geography) are also open and are founder-level, not
legal, decisions — they are listed here only where a legal question depends
on their outcome.
