# Discovery — Co-Founder Document Analysis

Source: `CPF_AI_Collaboration_Profile_Evaluation_Method.docx` ("Developer
Implementation Report", 22 July 2026) · Analysed: 2026-07-25

## Core thesis

A single automated candidate score ("AI proficiency: 82/100") is the wrong
product primitive: it creates GDPR Art. 22 exposure, EU AI Act overreliance
risk, SOC 2 processing-integrity gaps, fairness harms, and commercial distrust.
CPF's primitive is instead:

```
Raw events → Evidence Ledger → AI review suggestions → Human reviewer profile → Employer decision-support report
```

## Normative requirements extracted

### R1. Evidence Ledger (internal, auditable)
Every assessment statement is a claim with: dimension, claim text, evidence
references, counter-evidence, evidence band, reviewer confidence, limitations,
mandatory reviewer rationale.
**Implementation status:** `evidence_ledger_claims` table (migration 0002) — implemented.

### R2. AI Collaboration Profile (employer-facing)
Bands + role-fit interpretation + follow-up prompts. Never raw surveillance
feeds, never a universal score.
**Status:** data model ready; report assembly is Phase 2 backlog (CPF-30).

### R3. Seven capability dimensions with evidence bands
Problem framing, Prompt direction, Iteration & steering, Verification &
scepticism, Output ownership, Efficiency & proportionality, Integrity context
(assessed separately from ability).
**Status:** reconciled with the workbook's 10-dimension scoring model (ADR-0004).

### R4. Evidence bands (7) and confidence levels (5)
Exceptional / Strong / Clear / Some / Limited / Insufficient / Not assessed —
each with a developer rule (e.g. "Strong requires ≥2 supporting evidence
references"; "Insufficient must trigger follow-up, not a negative finding").
Confidence: High / Medium-high / Medium / Low / Insufficient.
**Status:** confidence levels enforced in schema + domain types; band rules are
Phase 2 validation logic (CPF-31).

### R5. Event category separation (data minimisation backbone)
`WorkspaceEvidenceEvent`, `IntegritySignalEvent`, `SystemAuditEvent`,
`ReviewerDecisionEvent`, `EmployerAccessEvent` — with different retention and
audiences. Integrity signals are never shown raw to employers by default.
**Status:** `evidence_event_category` enum implemented (migration 0002).

### R6. Ingestion guardrails
The event API must reject: raw global keystrokes, full external clipboard
content, telemetry outside an active session, events without a disclosure
record. "A product guardrail, not merely a policy statement."
**Status:** DB CHECK constraint implemented; API-level ingestion endpoint is
Phase 2 (CPF-24) and must enforce all four rules.

### R7. Product guardrails (Table 21, all adopted verbatim)
No total score in employer report · no auto-reject · no hidden cutoffs · human
finalisation required · evidence required · integrity separated · candidate
transparency (no session without disclosure acknowledgement) · minimal OS
monitoring · audit everything material · reviewer calibration before assignment.
**Status:** state machines + DB constraints enforce disclosure-first,
finalisation-before-report, and score-free profiles today; calibration gating
is Phase 2 (CPF-33).

### R8. Compliance posture
- GDPR Art. 22: no solely automated decision; meaningful human review; data
  minimisation; transparency via disclosure records; full rights support.
- EU AI Act: **assume high-risk treatment for recruitment use**; document
  intended purpose, oversight, logging, risk management, deployer instructions.
- SOC 2: Evidence Ledger supports Processing Integrity; demo-auth is a named
  blocker (Table 20) — the legacy any-password model must never reach production.

### R9. Internal analytics restrictions (Table 18)
Indexes such as promptSpecificityIndex, aiVerbatimShare, externalPasteRisk are
reviewer-assist only; none may set an evidence band, produce pass/fail, or be
shown to employers as scores.
**Status:** recorded in AI governance register; not yet implemented (Phase 5).

### R10. Source backlog (Table 22) mapped to our backlog
| Source priority | Item | New backlog ID |
|---|---|---|
| P0 | AssessmentDisclosureRecord replaces consent framing | CPF-20 (schema done; API pending) |
| P0 | EvidenceLedgerClaim model | CPF-21 (schema done) |
| P0 | HumanOversightRecord gate before report | CPF-22 (domain guard + constraint done) |
| P0 | Remove pass/fail + universal score from employer UI | CPF-23 (enforced in engine; UI pending) |
| P0 | Harden production auth | CPF-40 (not started — flagged) |
| P1 | Event category split | CPF-24 (schema done; ingestion pending) |
| P1 | Data-subject request workflow | CPF-25 (schema + state machine done; portal pending) |
| P1 | Reviewer calibration records | CPF-33 (planned) |
| P1 | Retention & deletion automation | CPF-26 (schema done; jobs pending) |
| P2 | Employer responsible-use acknowledgement | CPF-34 (planned) |
| P2 | SOC 2 evidence collection | CPF-41 (planned) |
| P2 | Desktop agent integrity signals | CPF-50 (deferred; compliance approval required first) |

## Contradictions / open questions

| # | Issue | Handling |
|---|---|---|
| 1 | 7-dimension profile vs 10-dimension scoring model | Reconciled as layered instruments — ADR-0004; validate with co-founder |
| 2 | Document references `CPF_Technical_Overview(1).pdf` v1.0 not supplied in machine-readable form | Assumed superseded by the workbook + this build's docs; flagged in assumptions register (A-07) |
| 3 | SOC 2 pursued alongside EU-first posture | Treated as roadmap evidence discipline, not a claimed certification |
