# Constraints Register & Compliance Gap Analysis

## Constraints

| ID | Constraint | Source | Consequence for design |
|---|---|---|---|
| C-01 | No employer-facing universal score, ranking, pass/fail, or auto-reject | Co-founder doc Table 21; GDPR Art. 22 posture | Engine output type contains no outcome vocabulary; DB has no rejected states |
| C-02 | No session capture before disclosure acknowledgement | Co-founder doc; transparency duties | State machine has a single path through `disclosure_pending` |
| C-03 | No raw keystrokes / full external clipboard content, ever | Co-founder doc Table 16; data minimisation | DB CHECK constraint + API ingestion rejection (CPF-24) |
| C-04 | Employer reports require finalised human oversight record | Co-founder doc; AI Act human-oversight expectations | `assertReportCanBeIssued` guard + DB CHECK on finalised reviews |
| C-05 | Integrity context separate from capability evidence | Both sources | `evidence_event_category` enum; separate retention clocks |
| C-06 | Template rubrics frozen per cohort | Workbook governance | Immutable `assessment_template_versions` + checksum |
| C-07 | EU/EEA data residency; GDPR-first engineering | Directive; sources | EU-hostable stack, transfer assessment before any non-EEA subprocessor |
| C-08 | No camera-based or emotion-inference monitoring | Directive §11; AI Act Art. 5 risk | Prohibited by policy; not present in schema or roadmap |
| C-09 | Assessment economics must be measured before pricing claims | Workbook | Investor docs label economics as hypotheses |
| C-10 | This environment: no GitHub credentials, no Docker daemon, no production infra | Session reality | Push/branch-protection/live-deploy = founder actions; recorded honestly |

## Compliance gap analysis (initial — full detail in docs/compliance)

Legend: ✅ control implemented in this repo · 🟡 designed/documented, not implemented · 🔴 not started · ⚖️ requires specialist review

| Area | Requirement theme | Status | Evidence / next step |
|---|---|---|---|
| GDPR Art. 5 | Minimisation, purpose limitation, storage limitation | 🟡 | Event categories + retention schema ✅; deletion automation 🔴 (CPF-26) |
| GDPR Art. 6/13/14 | Lawful basis + candidate transparency | 🟡 | Disclosure records schema ✅; notices content ⚖️ counsel |
| GDPR Art. 15–22 | Data-subject rights incl. no solely-automated decisions | 🟡 | DSR state machine + schema ✅; portal workflows 🔴 (CPF-25); Art. 22 posture ✅ by design |
| GDPR Art. 25/32 | Data protection by design; security | 🟡 | RLS, append-only audit, hash chain ✅; auth/MFA 🔴 (CPF-40); encryption at rest = deployment config 🔴 |
| GDPR Art. 30/35 | RoPA, DPIA | 🟡 | RoPA skeleton + DPIA scoping drafted; ⚖️ DPO/counsel before pilot |
| EU AI Act Art. 5 | Prohibited practices (incl. workplace emotion inference) | ✅ policy / ⚖️ | Excluded by design; legal confirmation of full Art. 5 sweep pending |
| EU AI Act Annex III(4) high-risk (employment) | Risk mgmt, logging, oversight, transparency, deployer instructions | 🟡 | Oversight + logging architecture ✅; risk-management system, technical documentation, conformity route ⚖️🔴 — **before any real recruitment use** |
| EU AI Act Art. 50 | AI-interaction transparency | 🟡 | Disclosure versions in schema; UI copy 🔴 |
| EAA / WCAG 2.2 AA | Accessibility of candidate-facing service | 🟡 | Specification written; no UI exists yet, tests planned in DoD |
| ePrivacy | Cookies/telemetry consent surfaces | 🔴 | No web UI yet; specified for Phase 2 |
| National employment law overlays | Per-country recruitment rules | ⚖️ | Legal-review register lists launch-country checks |

**Verdict recorded:** current state is compatible with the target posture, and
no prohibited-practice functionality exists. The platform must not process real
candidates until 🔴/⚖️ items in the "blocks pilot" column of the compliance
register are closed.

## Legal snapshot

- Review date: 2026-07-25.
- Basis: source documents (22 Jul 2026), which target GDPR, EU AI Act
  (Reg. 2024/1689) high-risk posture for recruitment, and SOC 2 readiness.
- Live verification of AI Act application dates, the 2026 Digital Omnibus
  amendments, harmonised standards, and Member-State overlays **was not
  performed from this offline environment** and is a mandatory pre-pilot
  action (LR-01 in the legal-review register).
