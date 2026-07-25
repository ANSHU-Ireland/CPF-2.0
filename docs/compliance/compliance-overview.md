# Compliance Overview — GDPR & EU AI Act Posture

**This document records design posture and evidence. It is not legal advice and
makes no compliance guarantee. Counsel sign-off is mandatory before any real
candidate is processed (see legal-review register).**

Legal snapshot: 2026-07-25 · Sources: GDPR (Reg. 2016/679), EU AI Act
(Reg. 2024/1689) as characterised in the 22 Jul 2026 co-founder document ·
Live verification of current consolidated texts, application dates, the 2026
amendments, and guidance **not performed from this offline environment** —
mandatory pre-pilot action LR-01.

## Roles (working determination)

| Context | CPF role | Customer role |
|---|---|---|
| GDPR — candidate assessment data | Processor (customer-configured retention, purposes) with narrowly-defined controller functions for platform security/audit | Controller |
| EU AI Act — assessment platform with AI features used in recruitment | **Provider** of a system used in an Annex III(4) employment context → design assumes **high-risk obligations** (A-08) | Deployer |

Working rule adopted from the co-founder document: *"CPF should assume
high-risk treatment when used for recruitment or candidate evaluation."*

## GDPR Art. 22 posture (core product argument)

CPF is engineered so that no solely-automated decision with legal/similarly
significant effect occurs **inside the product**:

1. No employer-facing score, ranking, pass/fail, shortlist, or auto-reject —
   absent from the domain model, DB enums, and API vocabulary (tested).
2. Report issuance is impossible without a finalised human oversight record
   (rationale + confidence + limitations) — domain guard + DB constraint.
3. Reviewer-assist AI is suggestion-only; usage and modification are logged.
4. Candidates get disclosure-before-capture, explanation routes, challenge,
   and human-review request workflows (schema + state machine; UI Phase 2).
5. Deployer instructions will require employers to keep a human decision-maker
   accountable (responsible-use acknowledgement, CPF-34).

Residual risk R-01 (employer treats profile as verdict) is mitigated but not
eliminable by CPF alone — addressed via contract terms + product friction.

## EU AI Act high-risk readiness map (provider obligations, design-stage)

| Obligation theme | Status |
|---|---|
| Risk management system | 🟡 risk register live (discovery/06); formal RMS process pre-pilot |
| Data governance | 🟡 framework provenance + import fidelity checks ✅; training data N/A (no fine-tuning) |
| Technical documentation | 🟡 this docs tree is structured to become the technical file |
| Logging / traceability | ✅ architecture: audit chain, model-invocation log schema (ADR-0005/0006) |
| Transparency & deployer instructions | 🟡 disclosure records ✅; instructions-for-use document Phase 2 |
| Human oversight | ✅ enforced in domain + DB (the product's core primitive) |
| Accuracy / robustness / cybersecurity | 🟡 calibration protocol defined; security baseline implemented; formal metrics at pilot |
| Conformity assessment + registration | 🔴 **CONFORMITY ASSESSMENT REQUIRED before any real recruitment deployment** — route with counsel (LR-02) |
| Art. 5 prohibited practices | ✅ excluded by design: no emotion inference, no biometric categorisation, no social scoring, no manipulation; monitoring policy hard-bans them |
| Art. 50 transparency | 🟡 AI-interaction disclosure in candidate flow spec |

## Records of Processing (RoPA skeleton — controller completes per deployment)

| Purpose | Subjects | Categories | Lawful basis (customer-selected, recorded in disclosure) | Retention |
|---|---|---|---|---|
| Assessment delivery & evidence capture | Candidates | Identity (name, email), work-sample evidence, session metadata | Art. 6(1)(b)/(f) per controller determination — **not consent-dependent by design** | Per retention matrix |
| Integrity assurance | Candidates | Session-scoped integrity metadata | Art. 6(1)(f) with balancing test (LIA template) | 90d default |
| Review & profile production | Candidates, reviewers | Scores, claims, rationales | Same as delivery | 365d default |
| Rights handling | Candidates | Request records | Art. 6(1)(c) | 3y |
| Platform security/audit | All users | Audit events | Art. 6(1)(f) CPF | 730d |

DPIA: required before pilot (systematic evaluation of natural persons in an
employment context using new technology). Scoping draft lives with this file;
completion + DPO/counsel review = LR-03.

## Candidate transparency artefacts (Phase 2 content, versioned in disclosure records)

Privacy notice · AI-use notice (what the workspace assistant does, what is
recorded, that AI never decides) · telemetry notice (exact integrity signals,
in plain language) · assessment rules · rights & challenge routes.

## Monitoring & integrity policy (binding product rules)

Allowed (session-scoped, disclosed, metadata-only): focus loss, tab/app switch
indicators, full-screen exit, paste-after-focus-loss patterns, idle gaps,
concurrent-session detection, device change, interruption reports.
**Prohibited: raw keystroke capture, full clipboard content, camera/microphone
analysis, emotion inference, off-session telemetry, automatic cheating
verdicts.** Signals appear only in the reviewer's separated integrity context
with guidance; candidates can annotate/dispute every signal.

## Subprocessor register

None yet — no hosting, e-mail, or model provider is contracted. Every future
entry requires: DPA, EU data location or transfer assessment, security
evidence, AI-Act information duties where relevant. (Register lives here.)

## Legal-review register (blocking items)

| ID | Question | Blocks |
|---|---|---|
| LR-01 | Live verification of AI Act consolidated text, application dates, 2026 amendments, harmonised standards | Pilot |
| LR-02 | High-risk classification confirmation + conformity-assessment route | Real recruitment use |
| LR-03 | DPIA completion + lawful-basis validation per launch country | Pilot |
| LR-04 | Candidate notices + employer terms (responsible use, Art. 22 allocation) | Pilot |
| LR-05 | Works-council/employee-rep requirements for Phase 4–5 features per country | Phase 4 |
| LR-06 | Legacy repo committed secrets — rotation confirmation | Immediate founder action |
