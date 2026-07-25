# Discovery — Assessment Workbook Analysis

Source: `CPF_Phase1_AI_Native_Talent_Assessment_Templates.xlsx` (13 sheets) ·
Analysed and machine-imported: 2026-07-25

## Structure

| Sheet | Content | Import destination |
|---|---|---|
| Read Me | Library governance, employee profile, usage steps, template catalogue, prototype guidance | This document + product docs |
| Plan Assessment | Critique of the CPF 5Y plan with ratings and a 12-week prototype sequence | Product strategy inputs (below) |
| Scoring Model | 10 dimensions + weights, 1–5 anchors, controls, index bands, calibration protocol | `data/scoring-model.json` |
| SE1–SE5, DM1–DM5 | Per-template: metadata, 5-stage workflow, 18-criterion rubric, 18 interview probes, decision-support summary, reviewer instruction | `data/templates/*.json` |

## Imported scoring model (verified against source)

Dimensions and weights (sum = 1.0): Decomposition 0.10 · Context 0.08 ·
Tool Choice 0.08 · **Verification 0.14** · Correction 0.10 · Judgment 0.12 ·
Escalation 0.08 · **Domain Execution 0.14** · Client Readiness 0.08 ·
Trust & Safety 0.08.

Controls: critical score threshold **2** (concern for review, never rejection);
reviewer variance trigger **2** (adjudication required); minimum scored
coverage **0.9**; minimum evidence-note coverage **0.9** ("a number alone is
not evidence").

Evidence-index bands: ≥0 Limited · ≥0.55 Mixed · ≥0.70 Supported · ≥0.85 Strong.

Anchors: 1 "Unsafe or materially incorrect" → 5 "Exceptional and leverage
creating" (full text in `scoring-model.json`).

## Template library

| Code | Template | Timebox | Workbook guidance |
|---|---|---|---|
| SE1 | Production-safe feature delivery | 120 + 20 min interview | **Pilot first** — best broad engineering predictor |
| SE2 | Incident diagnosis & recovery | 90 + 20 | Expand later — needs realistic logs/runbook |
| SE3 | Secure integration | 120 | Design library |
| SE4 | Legacy optimisation | 120 | Design library — needs stable benchmark fixture |
| SE5 | AI pull-request review | 90 | **Pilot first or second** — most aligned to CPF differentiation |
| DM1 | Paid acquisition | 120 | **Pilot first** — strong observable customer value |
| DM2 | SEO & content | 120 | Expand later — requires dated SERP pack |
| DM3 | Lifecycle CRM | 105 | Design library — needs precise event dictionary |
| DM4 | Attribution | 120 | **Pilot first or second** — excellent for marketing ops |
| DM5 | Integrated launch | 150 | Expand later — mid-level breadth |

Every template: 18 criteria (6 critical), criterion weights sum to 1.0,
observable standards + evidence requirements + red flags, 5 timed workflow
stages, 18 interview probes, and the reviewer instruction: *"score only
observable evidence… Do not infer motivation, personality, emotion, disability,
protected characteristics or future performance."*

## Strategic directives adopted from Read Me / Plan Assessment

1. **Library, not launch list.** Treat the 10 templates as a design and
   calibration library. Productionise **two** first (one SE + one DM), selected
   by paid design-partner demand. → shapes the release roadmap.
2. **Freeze rule.** "Freeze the brief, source pack, tool permissions and rubric
   for each validation cohort." → implemented as immutable
   `assessment_template_versions` with SHA-256 checksums.
3. **Calibration.** Double-score 20–30% during prototype; adjudicate
   differences ≥2; weighted kappa / ICC targets near 0.75. → reviewer
   calibration module (Phase 2) + variance logic already in the scoring engine.
4. **Validity discipline.** Link dimensions to 30/60/90-day role outcomes
   before claiming predictive value; purchase is not proof of validity.
5. **Economics.** Time ~30 real reviews per role before fixing pricing; the
   EUR 18 reviewer-cost assumption is optimistic — measure, don't assume.
6. **Open strategic decision (escalated to founders):** the workbook flags a
   wedge conflict — the 5Y plan's NOW roles were customer support / business
   analysis / revenue operations, while these templates target software
   engineering + digital marketing. And the commercial model (assessment
   platform vs placement vs managed talent) changes contracts, economics, and
   risk. **This build implements the assessment-platform model** (A-02) and
   keeps the framework role-family–agnostic so the wedge can change without
   re-architecture.

## Fidelity checks performed at import

- 10/10 templates parsed; 18 criteria each; 6 critical each; probes linked 18/18.
- Dimension weights sum to 1.0 (6 d.p.); criterion weights sum to 1.0 (4 d.p.)
  — the workbook's own 1/3-split weights (0.046666…) preserved exactly.
- All criterion dimensions resolve against the 10 scoring dimensions
  (enforced by automated test `framework-data.test.ts`).
