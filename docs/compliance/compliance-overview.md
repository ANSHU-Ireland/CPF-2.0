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
| Logging / traceability | ✅ architecture implemented: `packages/ai-gateway` produces a `GatewayInvocationRecord` per call (provider, model, version, prompt version, region, tokens, cost, latency, redactions); append-only hash-chained `audit_log` covers all state-mutating actions. **Disclosed gap**: no product feature yet calls the gateway from a live user-facing flow — AIF-01 reviewer-assist is built and evaluated against a SYNTHETIC golden set only, gated OFF pending a real ≥30-session golden set |
| Transparency & deployer instructions | 🟡 disclosure records ✅; candidate notice DRAFT text authored ([`candidate-notices-draft.md`](candidate-notices-draft.md)), pending LR-04; instructions-for-use document for employers still Phase 2 |
| Human oversight | ✅ enforced in domain + DB (the product's core primitive) |
| Accuracy / robustness / cybersecurity | 🟡 calibration protocol defined; kill switch + model allow-list + PII redaction + budget guard implemented in `packages/ai-gateway` (unit-tested); formal accuracy/robustness metrics require real-candidate-scale data, not yet available |
| Conformity assessment + registration | 🔴 **CONFORMITY ASSESSMENT REQUIRED before any real recruitment deployment** — route with counsel (LR-02) |
| Art. 5 prohibited practices | ✅ excluded by design: no emotion inference, no biometric categorisation, no social scoring, no manipulation; monitoring policy hard-bans them; `FORBIDDEN_EVENT_TYPES` enforces this at the API boundary (tested) |
| Art. 50 transparency | 🟡 AI-interaction disclosure mechanism implemented (notices opened before session start, tested); candidate workspace assistant (AIF-03, the assessed AI itself) remains Phase 2/3, not yet built |

See [`docs/compliance/traceability-matrix.md`](traceability-matrix.md) for the
full requirement → implementation → test mapping (Delivery Plan Step 49), and
[`docs/compliance/legal-review-handoff.md`](legal-review-handoff.md) for a
single indexed package of every open legal question above, phrased for
counsel.

## Records of Processing (RoPA — finalised against implemented reality, Step 49)

Controller (the employer customer) completes purpose selection, lawful-basis
choice, and jurisdiction-specific details per deployment; the rows below
reflect every processing activity this platform's implemented schema
actually performs today, so the controller's copy starts from real system
behaviour rather than a guess.

| Purpose | Subjects | Categories | Lawful basis (customer-selected, recorded in disclosure) | Retention | Implementation evidence |
|---|---|---|---|---|---|
| Assessment delivery & evidence capture | Candidates | Identity (name, email), work-sample evidence, session metadata | Art. 6(1)(b)/(f) per controller determination — **not consent-dependent by design** | Per retention matrix | `assessment_sessions`, `evidence_events` |
| Integrity assurance | Candidates | Session-scoped integrity metadata (focus/tab-switch/paste-timing signals only — never keystroke/clipboard-content/camera/microphone) | Art. 6(1)(f) with balancing test (LIA template) | 90d default | `evidence_events` category `integrity_signal`; `FORBIDDEN_EVENT_TYPES` allow-list |
| Review & profile production | Candidates, reviewers | Scores, claims, rationales | Same as delivery | 365d default | `reviews`, `criterion_scores`, `evidence_ledger_claims` |
| Rights handling | Candidates | Request records | Art. 6(1)(c) | 3y | `data_rights_requests` |
| Platform security/audit | All users | Audit events (append-only, hash-chained) | Art. 6(1)(f) CPF | 730d | `audit_log` |
| Account & authentication | All users | Email, password hash (scrypt), MFA secret (encrypted), session tokens | Art. 6(1)(b) (contract with employer) | Life of account + 90d post-deactivation | `users`, `sessions`, identity package |
| Employer directory & entitlements | Employer org users | Org membership, role, module entitlements, plan/subscription | Art. 6(1)(b) | Life of subscription | `organisations`, `org_memberships`, `org_subscriptions` |
| Learning progress (Phase F, if entitled) | Employees/learners | Enrollment, completion, quiz scores | Art. 6(1)(b) | Per org retention policy | `packages/db` learning migrations 0016–0017 |
| Workforce-intelligence aggregates (Phase G, if entitled) | Employees (aggregated, k-anonymity ≥8) | Pain-point themes, skills-gap aggregates — **no individual-level output below the k=8 floor** | Art. 6(1)(f) with balancing test | Per org retention policy | `apps/api/src/modules/org/intelligence.ts` `MIN_COHORT_FOR_CELL` |
| AI Gateway invocations (when a feature using it is enabled) | Reviewers (as prompt authors), candidates (as evidence subjects, PII redacted before send) | Prompt/response metadata, token counts, cost, latency, redactions applied — **not the raw candidate PII itself, which is redacted pre-send** | Art. 6(1)(f) | ≤90d, EU region, no vendor training (per AI-governance register) | `packages/ai-gateway/src/redaction.ts`, `gateway.ts` |

## DPIA draft (Delivery Plan Step 49 — populated from implemented reality)

**Status: DRAFT. Requires DPO/counsel review and sign-off (LR-03) before any
real candidate is processed. This is a working screening document, not a
completed, signed DPIA.**

**Systematic description of processing**: candidates complete a work-sample
assessment using an approved AI assistant inside a browser workspace; every
interaction with that assistant, every edit, and a limited set of
session-integrity signals are captured as evidence; a trained human reviewer
scores the evidence against a fixed rubric, writes a rationale, and (if
variance between two reviewers is high) an adjudicator resolves it; the
employer receives an Evidence Profile — bands, claims, interview probes, and
reviewer rationale — never a score, rank, or automated recommendation.

**Necessity and proportionality**: the assessment exists to let an employer
observe AI-collaboration behaviour that a CV or interview cannot show
(verification habits, escalation judgement, correction behaviour). Less
intrusive alternatives considered and rejected as insufficient: unstructured
interview (no comparable evidence across candidates); CV/portfolio review
(does not show live AI-collaboration behaviour); fully automated scoring
(rejected outright — this is the platform's core design constraint, not a
DPIA mitigation bolted on afterward).

**Risks to data subjects identified (cross-referencing the risk register)**:
- R-01 Employer treats the Evidence Profile as an automated verdict —
  mitigated by score-free design (enforced in code) + responsible-use
  acknowledgement gate (CPF-34) before any employer user can view a profile.
- R-05 Integrity signals misused as cheating verdicts — mitigated by
  category separation in schema/API and a policy that signals are reviewer
  context only, never a verdict.
- R-08 Subgroup unfairness — mitigated by no demographic inference anywhere
  in the schema, and workforce-intelligence aggregates enforce a k=8 minimum
  cohort floor before any output is shown, precisely to prevent small-group
  re-identification or unfair singling-out.
- R-10 Retention beyond purpose — mitigated by per-org retention policies +
  an automated scheduled sweep + legal-hold suppression (CPF-26), verified
  by an integration test that a legal hold blocks an erasure request until
  released.
- R-04 Cross-tenant leak — mitigated by PostgreSQL row-level security
  (FORCE, deny-by-default) verified by an integration test proving zero rows
  are returned without tenant context under the restricted, non-superuser
  API role.

**Residual risk not eliminable by the platform alone**: an employer could
still, outside this platform, treat the Evidence Profile as a de facto
verdict despite the score-free design — this is addressed by contract terms
and the responsible-use acknowledgement, not by any technical control, and
is disclosed as residual risk R-01 rather than claimed as solved.

**Consultation**: no DPO has yet reviewed this draft; no data subjects or
their representatives have been consulted (none exist yet — no real
candidate has used the platform). This section will be completed with real
names/dates once counsel engagement begins.

**Outstanding before sign-off**: DPO review; lawful-basis confirmation per
launch country (LR-03); confirmation the k=8 aggregate floor is adequate
under applicable guidance (rather than an internally-chosen number); a data
flow diagram (not yet drawn — a reasonable next artefact, not fabricated
here).

## Candidate transparency artefacts (Phase 2 content, versioned in disclosure records)

Full DRAFT text for the privacy notice, AI-use notice, telemetry notice, and
assessment rules — versioned to `NOTICE_VERSIONS`, pending counsel review
under LR-04 — now lives in
[`docs/compliance/candidate-notices-draft.md`](candidate-notices-draft.md).
The product currently renders a short DRAFT summary of each and requires
every notice to be opened before a candidate may proceed (implemented and
tested).

## Monitoring & integrity policy (binding product rules)

Allowed (session-scoped, disclosed, metadata-only): focus loss, tab/app switch
indicators, full-screen exit, paste-after-focus-loss patterns, idle gaps,
concurrent-session detection, device change, interruption reports.
**Prohibited: raw keystroke capture, full clipboard content, camera/microphone
analysis, emotion inference, off-session telemetry, automatic cheating
verdicts.** Signals appear only in the reviewer's separated integrity context
with guidance; candidates can annotate/dispute every signal.

## Subprocessor register

None yet — no hosting, e-mail, SMTP, or AI model provider is contracted; this
remains blocked on founder decisions A-02/A-03 and is not fabricated here.
The outbound-notification queue (`apps/api/src/jobs`, CPF-37) and the AI
gateway's `ProviderAdapter` interface (`packages/ai-gateway/src/types.ts`)
are both built against a swappable-provider abstraction specifically so that
whichever vendor is chosen later is a configuration change, not a rewrite.
Every future entry requires, before use: a signed DPA, an EU data-location or
transfer-mechanism assessment, security evidence (e.g. SOC 2/ISO 27001), and
an AI-Act information-duties check where the vendor is a model provider. See
[`docs/compliance/legal-review-handoff.md`](legal-review-handoff.md) for the
counsel question that applies once a vendor is chosen.

| Vendor | Service | Status |
|---|---|---|
| *(none contracted)* | SMTP / transactional email | Not chosen — founder decision |
| *(none contracted)* | Hosting / managed PostgreSQL | Not chosen — founder decision |
| *(none contracted)* | AI model provider (for any gateway-backed feature) | Not chosen — no AI feature is enabled in any build |

## Legal-review register (blocking items)

**Full handoff package with a specific question per item, indexed for
counsel: [`docs/compliance/legal-review-handoff.md`](legal-review-handoff.md)
(Delivery Plan Step 49).**

| ID | Question | Blocks |
|---|---|---|
| LR-01 | Live verification of AI Act consolidated text, application dates, 2026 amendments, harmonised standards | Pilot |
| LR-02 | High-risk classification confirmation + conformity-assessment route | Real recruitment use |
| LR-03 | DPIA completion + lawful-basis validation per launch country | Pilot |
| LR-04 | Candidate notices + employer terms (responsible use, Art. 22 allocation) | Pilot |
| LR-05 | Works-council/employee-rep requirements for Phase 4–5 features per country | Phase 4 |
| LR-06 | Legacy repo committed secrets — rotation confirmation | Immediate founder action |
