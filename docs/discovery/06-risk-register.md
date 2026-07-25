# Risk Register

Scoring: Severity × Likelihood (1–5 each). Review cadence: every sprint for ≥12; monthly otherwise.

| ID | Risk | People affected | Sev | Lik | Score | Control | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| R-01 | Employer treats evidence profile as an automated verdict (Art. 22 drift) | Candidates | 5 | 3 | 15 | Score-free reports enforced in engine + tests; employer responsible-use acknowledgement (CPF-34); deployer instructions | Product | Mitigating |
| R-02 | Wedge/commercial-model indecision stalls the prototype | Company | 4 | 4 | 16 | Escalated founder decision (A-02/A-03); framework kept role-agnostic | Founders | **Escalated** |
| R-03 | Reviewer inconsistency undermines validity | Candidates, employers | 4 | 4 | 16 | Variance-trigger adjudication (implemented); calibration module + double-scoring protocol (CPF-33) | Product | Partially mitigated |
| R-04 | Cross-tenant data leak | All customers | 5 | 2 | 10 | Postgres RLS deny-by-default (implemented); tenancy tests in CI (implemented for schema; API-level tests pending CPF-42) | Engineering | Mitigating |
| R-05 | Integrity signals misused as cheating verdicts | Candidates | 5 | 3 | 15 | Category separation in schema; no auto-verdict anywhere; reviewer-context-only display rule; policy doc | Product | Mitigating |
| R-06 | Demo-style auth reaching production (legacy lesson) | All | 5 | 2 | 10 | No auth shipped at all until hardened module (CPF-40); CI blocks; personal-data endpoints absent until then | Engineering | Controlled |
| R-07 | AI-assist suggestions bias reviewer judgement (automation bias) | Candidates | 4 | 3 | 12 | Suggestions non-binding + labelled; oversight record logs AI-suggestion use/modification; evaluation framework before enabling | AI governance | Designed |
| R-08 | Subgroup unfairness in criteria or review behaviour | Candidates | 5 | 3 | 15 | Fairness monitoring protocol (workbook); no demographic inference; accommodations before timing comparisons; expert review | Compliance | Designed |
| R-09 | Reviewer cost breaks unit economics (EUR 18 assumption optimistic) | Company | 4 | 4 | 16 | Measure ~30 real reviews per role before pricing; reviewer-minutes telemetry (Phase 3) | Founders | Open |
| R-10 | Candidate data retained beyond purpose | Candidates | 4 | 3 | 12 | Per-org retention policies + legal holds (schema done); automated deletion jobs (CPF-26) | Engineering | Partially mitigated |
| R-11 | Model-provider outage or silent version change corrupts AI-assist | Reviewers | 3 | 3 | 9 | AI gateway with pinning + kill switch (designed, ADR-0005); human-only path always works | Engineering | Designed |
| R-12 | Compliance documents drift from software behaviour | Company | 4 | 3 | 12 | Guardrails as code + tests; traceability matrix; PR governance checklist | All | Mitigating |
| R-13 | Legacy repo secrets (.env committed) already exposed | Company | 3 | 3 | 9 | Flagged to founders for rotation; new repo never commits env files | Founders | **Escalated** |
| R-14 | Accessibility gaps exclude candidates (also EAA exposure) | Candidates | 4 | 3 | 12 | WCAG 2.2 AA specification before UI build; accessibility tests in Definition of Done | Design | Designed |
| R-15 | Scope explosion (10 templates, 6 modules at once) | Delivery | 4 | 4 | 16 | Phased roadmap; workbook "library not launch list" rule; out-of-scope register | Product | Controlled |
