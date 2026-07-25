# Security Architecture & Threat Model

Baseline: OWASP ASVS (scaled to risk) for the application; OWASP GenAI/LLM
guidance for AI features. Verify current versions before each formal review.

Last refreshed against implemented reality: 2026-07-25 (delivery plan Step 29).

## Implemented today

| Control | Where |
|---|---|
| Strict input validation at every implemented boundary | zod schemas (config, API bodies/params) |
| Safe error contract; no internal leakage (incl. correct 4xx classification for Fastify-native errors — fixed via Step 29 fuzz testing) | Fastify error handler |
| Security headers (nosniff, DENY, CSP default-src 'none', no-store) | onSend hook + tested |
| Log redaction (authorization, cookie), never observed in log output for a real request | logger config (`LOG_REDACT_PATHS`) + unit + end-to-end test (Step 29) |
| Tenant isolation backstop: RLS deny-by-default on tenant tables | migration 0002 + CI check |
| Append-only, hash-chained audit log | migration 0001 (trigger-enforced) |
| Invitation tokens stored hashed; passwords Argon2id-only by schema comment | migration 0002 / 0001 |
| Forbidden-surveillance events rejected at DB level | CHECK constraint |
| Ingestion fuzz-tested: malformed JSON, oversized bodies (both transport- and application-level limits), unicode, prototype-pollution-shaped keys — all resolve to a safe classified status, never a 500, and never touch the real `Object.prototype` | evidence-events endpoint + Step 29 fuzz suite |
| Authentication, MFA (TOTP), session lifecycle (sliding renewal + absolute cap), step-up re-auth for sensitive actions | CPF-40, CPF-46 |
| Rate limiting (token-bucket, per-session/per-IP, stricter on unauthenticated surfaces) | CPF-43 |
| Authorization matrix automated across every org-scoped route × every role, fails on unlisted new routes | CPF-47 (`authz-matrix.test.ts`) |
| No secrets in repo; env-example only; extraction workspace gitignored | .gitignore, .env.example |
| Dependency audit clean (0 vulns); SAST (CodeQL), secret scanning (gitleaks), SBOM generation in CI | ci.yml, security.yml (CPF-45) |
| CSRF: not applicable — the web client is bearer-token authenticated (Authorization header, no ambient cookie credential), so classic cross-site cookie-riding CSRF has no attack surface here | apps/web/src/auth.tsx (sessionStorage + header, not cookies) |

## Not yet implemented (honest gaps, tracked)

File upload pipeline with malware scanning (no binary file uploads exist yet —
CSV candidate import is validated text, not a stored file) · encryption-at-rest
configuration (deployment/infra task, Step 31-32) · secret manager integration
(deployment task, Step 32) · backup/restore drills (Step 34, not yet run) ·
external penetration test (required pre-pilot, not run in this environment) ·
production deployment hardening review (post Step 30-32).

## Threat model — critical workflows (STRIDE-condensed)

### T1. Candidate assessment session
| Threat | Vector | Control | Status |
|---|---|---|---|
| Session hijack | Stolen invitation token | Hashed single-use tokens, expiry, reissue invalidates predecessor | Implemented; IP/UA anomaly flag still open (P2) |
| Evidence forgery | Client posts fabricated events | Server timestamps, session-state precondition, category allow-list | Implemented; sequence-integrity checks still open (P2) |
| Surveillance creep | Ingesting forbidden telemetry | API rejection + DB CHECK + policy; no agent in Phase 1-2 | Implemented, fuzz-tested Step 29 |
| Malformed/malicious ingestion payloads | Malformed JSON, oversized body, unicode, `__proto__`/`constructor` keys | zod validation, transport + application size limits, JSON stored inertly via parameterized jsonb insert (never merged/evaluated) | Implemented, fuzz-tested Step 29; malformed-JSON 500-misclassification bug found and fixed this step |
| Data exfil via AI panel | Candidate pastes secrets into prompts | Redaction in AI gateway; brief instructs; Trust & Safety criteria assess behaviour | Planned — AI gateway not yet built (Step 45) |
| Elevation | Candidate token reaching org APIs | Token audience-scoped to candidate surface only | Implemented |

### T2. Review & report issuance
| Threat | Vector | Control | Status |
|---|---|---|---|
| Rubber-stamping | Reviewer accepts AI suggestions wholesale | Oversight record logs suggestion use/modification; calibration + sampling double-review | Calibration implemented; AI suggestions not yet built (Step 45) |
| Score tampering | Direct DB/API manipulation | RLS, role checks, audit chain, finalisation immutability (reopen creates new version) | Implemented, authz-matrix tested |
| Report without oversight | API bug | Domain guard + DB CHECK constraint (two independent layers, both tested) | Implemented |
| Employer overreach | Requesting raw evidence/integrity feeds | Projection layer never exposes them; permission matrix; audit on report access | Implemented |

### T3. Tenancy & platform
| Threat | Vector | Control | Status |
|---|---|---|---|
| Cross-tenant read | Missing org filter | RLS backstop (deny-by-default), CI verification, API isolation tests, authz matrix (cross-org caller case) | Implemented |
| Insider/support access | Broad admin rights | JIT scoped support access, break-glass dual logging | Planned (Step 37) |
| Audit tampering | UPDATE/DELETE on audit | Trigger blocks; hash chain detects | Implemented; external anchor still open (Phase 3) |
| Supply chain | Malicious dependency | Lockfile, npm audit in CI, SCA + SBOM, minimal dependency policy | Implemented (CPF-45) |
| Mid-session privilege change | Role removed while session active | Role-removal endpoint revokes all of the affected user's sessions; last-admin guard | Implemented (CPF-46) |
| Session lifetime abuse | Indefinitely-refreshed session via constant activity | Sliding renewal clamped to a hard absolute cap regardless of activity | Implemented (CPF-46), tested |
| Sensitive-action replay | Stale session performs a high-impact action (bulk export) | Step-up re-authentication required within a freshness window | Implemented (CPF-46) |

### T4. AI features (when enabled)
Prompt injection via candidate content → treat all workspace content as
untrusted in reviewer-assist prompts; output schema validation; no tool
execution from model output; suggestion-only UX; budgets against
denial-of-wallet; provider pinning against silent model swaps; kill switch.
**Status: planned, not yet built (Step 45) — reviewer-assist stays OFF by
default when it is built.**

## Incident response (summary; runbook in operations/runbooks)

Detect (alerts, audit anomalies, reports) → classify severity (P0 data
leak/integrity failure …) → contain (kill switch, token revocation, tenant
suspension) → preserve evidence (audit chain export) → assess notification
duties (GDPR 72h supervisory-authority clock; deployer/provider AI Act duties)
→ remediate → post-incident review with control changes. Contacts and
decision tree live in the runbook; **notification decisions require counsel.**

**External pentest is still required before any pilot deployment — nothing in
this document substitutes for one.**

