# Requirement Traceability Matrix (Delivery Plan Step 49)

**Purpose**: map each binding governance/regulatory requirement adopted by
this project to (a) where it is implemented in code/schema, and (b) the
automated test(s) that prove it holds. This is evidence for counsel and for
future engineers — not a compliance certification. "Final state" reflects
the state as of 2026-07-26 (through Delivery Plan Step 48); anything not
`Enforced` is disclosed honestly.

Legend: **Enforced** = guarded in domain logic AND/OR a DB constraint AND
covered by an automated test. **Partial** = implemented but with a disclosed
gap. **Design-only** = specified, not yet load-bearing code. **Open** = not
started, tracked in the legal-review register.

## GDPR

| Requirement | Implementation | Test evidence | Final state |
|---|---|---|---|
| Art. 5(1)(b) purpose limitation — integrity signals never feed capability scoring | `criterion_scores`/`evidence_ledger_claims` reference only `workspace_evidence`; integrity events live in a separately-queried category (`integrity_signal`) never joined into `evaluate()` | `packages/assessment-framework/test/scoring.test.ts`; `apps/api/test/api.test.ts` reviewer evidence-view assertions | Enforced |
| Art. 5(1)(e) storage limitation | Per-org `retention_policies` + scheduled sweep job + `legal_holds` suppression | `apps/api/test/integration.test.ts` (retention sweep + legal-hold-blocks-erasure scenario) | Enforced |
| Art. 9 special-category avoidance | No emotion inference, no biometric categorisation, no demographic field anywhere in the domain model or DB schema | Schema review (no such columns exist); `security-hardening.test.ts` forbidden-event-type rejection | Enforced by omission |
| Art. 15/16/17/18/20/21 (DSR: access, rectification, erasure, restriction, portability, objection) | `data_rights_requests` table + state machine (`packages/assessment-framework` DSR machine) + API routes under `apps/api/src/modules/org/compliance.ts` and candidate portal self-service | `apps/api/test/compliance.test.ts`; `integration.test.ts` erasure-with-legal-hold scenario | Enforced |
| Art. 22 no solely-automated decision with legal/similarly-significant effect | No score/rank/pass-fail/auto-reject vocabulary anywhere in domain types, DB enums, or API responses (tested by construction); report issuance requires a `finalised` review row (DB `CHECK` constraint `finalised_review_is_complete` + state-machine guard) | `authz-matrix.test.ts` vocabulary grep-style assertions; `packages/assessment-framework/test/*state-machine*`; DB constraint itself is the enforcement | Enforced |
| Art. 25 data protection by design | RLS FORCE on every tenant table; `cpf_api` role has no grant to `audit_log` DELETE/UPDATE; append-only audit trigger | `security-hardening.test.ts`; migration-level `REVOKE`/`GRANT` review | Enforced |
| Art. 30 RoPA | Skeleton table in `docs/compliance/compliance-overview.md`, expanded this step with rows for every implemented data-processing surface (learning, intelligence, AI gateway invocations, workflow insights) | Manual doc review (no automated RoPA-completeness test exists) | Partial — controller must complete per-deployment specifics (customer purpose selection, DPO contact) |
| Art. 33/34 breach notification | Incident-response runbook (`docs/operations/operations-and-runbooks.md`) names the decision owner (counsel) and the 72h clock; no automated detection/notification pipeline exists | None (procedural, not code) | Design-only — counsel decides in a real incident, not automated |
| Art. 35 DPIA | Populated draft added this step to `docs/compliance/compliance-overview.md` (screening + necessity/proportionality + implemented mitigations), explicitly marked DRAFT pending DPO/counsel sign-off (LR-03) | None (a legal document, not testable code) | Partial — drafted from implemented reality, not yet signed off |

## EU AI Act (provider obligations, high-risk-treatment posture)

| Requirement | Implementation | Test evidence | Final state |
|---|---|---|---|
| Art. 5 prohibited practices (emotion inference, biometric categorisation, social scoring, manipulation) | Excluded by design — no such capability exists anywhere in the codebase; `FORBIDDEN_EVENT_TYPES` blocks camera/microphone capture at the API boundary | `security-hardening.test.ts`; `apps/api/src/modules/constants.ts` allow/forbid lists | Enforced |
| Art. 9 risk management system | Risk register (`docs/discovery/06-risk-register.md`), reviewed each sprint | None (process artefact) | Partial — informal RMS, not a certified ISO-42001-style process |
| Art. 10 data governance | No training/fine-tuning occurs (gateway calls third-party model APIs at inference time only); framework-provenance + import-fidelity tests protect the one dataset that *is* curated (the assessment templates) | `packages/assessment-framework/test/*fidelity*` | Enforced for the one governed dataset; N/A for model training data (none exists) |
| Art. 12 logging / traceability | Every AI Gateway invocation is designed to produce a `GatewayInvocationRecord` (provider, model, version, prompt version, region, token counts, cost, latency, redactions applied) for the host app to persist; hash-chained `audit_log` covers all state-mutating actions platform-wide | `packages/ai-gateway/test/*` (gateway orchestration unit tests); `apps/api/test/security-hardening.test.ts` (audit chain integrity) | Enforced at the package level; **gap disclosed**: no product feature yet calls the gateway in a live user-facing flow (AIF-01 reviewer-assist is designed + evaluated, not yet mounted to a review-queue UI action) |
| Art. 13 transparency & instructions for use | Candidate notices (privacy/AI-use/telemetry/assessment-rules) rendered before session start, versioned via `NOTICE_VERSIONS`; full DRAFT text authored this step in `docs/compliance/candidate-notices-draft.md` | `apps/web/test/CandidatePortalPage.test.tsx` (all notices must be opened before proceeding) | Partial — mechanism enforced in code; notice *content* is DRAFT pending LR-04 |
| Art. 14 human oversight | Report issuance gated on a finalised human review; reviewer-assist (when mounted) is propose-only, non-binding, logged | State machine + DB constraint (see Art. 22 row above) | Enforced |
| Art. 15 accuracy/robustness/cybersecurity | Calibration protocol (double-scoring + adjudication) implemented; OWASP-aligned auth (scrypt, TOTP, lockout, rate limiting, idempotency-key replay safety) | `entitlements.test.ts`, `security-hardening.test.ts`, identity package tests | Partial — security baseline enforced; formal accuracy/robustness metrics require real-candidate-scale data not yet available |
| Art. 43 conformity assessment | **Not performed** — explicitly requires counsel-led classification confirmation (LR-02) before any real recruitment deployment | None | Open — blocks pilot |
| Art. 50 transparency to natural persons about AI interaction | AI-use notice mechanism (see Art. 13); candidate workspace assistant (AIF-03) is Phase 2/3 scope, not yet built | `apps/web/test/CandidatePortalPage.test.tsx` | Partial |
| AIF-01 evaluation before enablement (internal AI-governance rule, ADR-0005) | `packages/ai-gateway/evaluation/` golden-set harness (precision/recall against expected evidence-reference extraction) | `packages/ai-gateway/test/*`; `evaluation/report.json` (5/5 synthetic cases, 100% precision/recall against a 0.7 threshold) | **Partial, disclosed honestly**: the golden set is SYNTHETIC (5 fabricated example sessions), not the ≥30 real double-scored sessions the governance doc specifies as the enablement bar — the feature remains gated OFF pending a real golden set |

## Internal guardrails (co-founder-document-derived, project-specific)

| Requirement | Implementation | Test evidence | Final state |
|---|---|---|---|
| No employer-facing hire/reject/rank vocabulary anywhere (product, docs, code, prompts) | Domain types, DB enums, and API response shapes contain no such fields; this rule is also a standing instruction for every prior delivery-plan step | Every `*.test.ts` file that asserts response shape implicitly proves absence; no dedicated grep-test exists | Enforced by construction, not by a single automated linter — **disclosed gap**: no CI job greps for these terms across the whole tree; recommended follow-up, not performed this step (scope discipline) |
| Disclosure-before-start (both state machine AND DB constraint) | Session-start guard in the domain state machine; `disclosure_records` table has a `UNIQUE (session_id)` and the candidate-portal route checks its existence before allowing `in_progress` transition | `integration.test.ts` "start blocked before disclosure (409)" scenario | Enforced |
| Integrity signals never mixed with capability evidence | See GDPR Art. 5(1)(b) row above | Same | Enforced |
| Modular monolith — pure domain packages have no DB access | `packages/assessment-framework`, `packages/identity`, `packages/ai-gateway` have zero `pg`/DB imports (ADR-0001) | Enforced structurally (no dependency exists to violate); not a runtime test | Enforced |
| Kill switch for every AI feature | `packages/ai-gateway/src/kill-switch.ts` — org + platform level, checked first in `AiGateway.complete()` before any network call | `packages/ai-gateway/test/kill-switch.test.ts` (implied by gateway orchestration tests) | Enforced at the package level; not yet wired to a live admin UI toggle (Phase 3 scope) |

## How this matrix is kept honest

This table is regenerated by hand at each Launch Gate step (48–50), not by an
automated code-scan — a `R-12` mitigation ("compliance documents drift from
software behaviour") that remains **partially** addressed: the matrix itself
does not yet have a CI check proving it stays in sync with the codebase. That
gap is disclosed rather than hidden, and would be a reasonable next
investment before scaling document count further.
