# AI Governance

Rule (ADR-0005): **no AI feature exists in the product until its register entry
below is complete and its evaluation plan has passed.** Phase 1 ships zero AI
features; the platform is fully functional human-only, permanently.

## AI feature register (design-stage entries)

### AIF-01 Reviewer assist — evidence surfacing & claim suggestions
| Field | Value |
|---|---|
| Purpose | Reduce reviewer minutes by proposing evidence references, strengths/concerns, and draft ledger claims from session evidence |
| Input | Session workspace evidence (prompts, AI responses, edits, tests, verification note). Integrity signals **excluded** from suggestion prompts |
| Output | Suggestions labelled "AI suggestion — requires your judgement"; JSON schema-validated; never auto-applied |
| Autonomy level | Propose only (level 2 of the autonomy ladder) |
| Human oversight | Reviewer accepts/modifies/rejects; oversight record stores aiSuggestionUsed / aiSuggestionModified / overrideReason |
| Model / provider | Undecided — gateway adapter; EU data region required; pinned version |
| Risks | Automation bias (R-07), hallucinated evidence references, prompt injection from candidate content |
| Mitigations | References validated against actual event IDs before display; injection-hardened prompt template; suggestion-free mode always available; sampling re-review of AI-assisted vs unassisted reviews |
| Evaluation before enablement | Golden set of ≥30 double-scored sessions: suggestion precision/recall vs calibrated reviewer claims; bias probes (identical work, varied names/styles — names must not appear in prompts at all); injection suite |
| Retention | Invocations logged per ADR-0005; prompts retained ≤90d, EU region, no vendor training |
| Kill switch | Org + platform level; feature flag default OFF |

### AIF-02 Internal reviewer-assist indexes (promptSpecificity, iterationDepth, verificationEvidence, aiVerbatimShare, workspaceOwnership, externalPasteRisk, efficiencyPattern)
Deterministic/statistical computations (not necessarily LLM). Restrictions
adopted verbatim from the co-founder document: cannot set evidence bands,
cannot produce pass/fail, employer sees descriptive patterns only where
approved, externalPasteRisk triggers *review prompts* only. Status: Phase 5
design; each index needs its own validation study before display.

### AIF-03 Candidate workspace assistant (the assessed AI)
The approved AI the candidate works with — a product surface, not an
evaluation feature. Requirements: version pinned per cohort (fairness),
conversation fully captured as evidence, identical configuration for all
candidates in a cohort, EU processing, offline/scripted fallback for provider
outage (documented as fixture mode, never presented as live AI).

## Human oversight framework

1. Reviewers: trained + calibrated before assignment (CPF-33); adjudication
   protocol on variance; finalisation gate (implemented).
2. Employers: responsible-use acknowledgement; instructions-for-use document;
   contractual duty to keep human decision-makers accountable.
3. Candidates: AI-interaction disclosure; explanation and challenge routes;
   human-review request type in the DSR workflow (implemented in schema).

## Evaluation framework (applies to every AIF)

Layer 1 deterministic: schema validity, reference integrity, forbidden-content
filters, latency/cost budgets.
Layer 2 task quality: agreement with calibrated human baseline on golden sets;
multilingual behaviour before non-English launch.
Layer 3 adversarial: prompt injection (direct + via candidate artefacts),
leakage probes, protected-characteristic sensitivity tests (no demographic
inference — tested by construction and by probe).
Drift: re-run on provider/model/prompt version change (change control in
ADR-0005); quarterly otherwise. Human review of samples is mandatory — an LLM
judge is never the sole evidence for enablement.
