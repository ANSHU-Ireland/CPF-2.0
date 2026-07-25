# Security Architecture & Threat Model

Baseline: OWASP ASVS (scaled to risk) for the application; OWASP GenAI/LLM
guidance for AI features. Verify current versions before each formal review.

## Implemented today

| Control | Where |
|---|---|
| Strict input validation at every implemented boundary | zod schemas (config, API bodies/params) |
| Safe error contract; no internal leakage | Fastify error handler |
| Security headers (nosniff, DENY, CSP default-src 'none', no-store) | onSend hook + tested |
| Log redaction (authorization, cookie) + request IDs | logger config |
| Tenant isolation backstop: RLS deny-by-default on 12 tenant tables | migration 0002 + CI check |
| Append-only, hash-chained audit log | migration 0001 (trigger-enforced) |
| Invitation tokens stored hashed; passwords Argon2id-only by schema comment | migration 0002 / 0001 |
| Forbidden-surveillance events rejected at DB level | CHECK constraint |
| No secrets in repo; env-example only; extraction workspace gitignored | .gitignore, .env.example |
| Dependency audit clean (0 vulns after vitest-4 upgrade); CI re-audits | ci.yml |

## Not yet implemented (honest gaps, tracked)

Authentication/MFA/sessions (CPF-40 — blocks all personal-data endpoints) ·
rate limiting (CPF-43) · file upload pipeline with malware scanning (Phase 2) ·
encryption-at-rest configuration (deployment task) · secret manager integration
(deployment task) · CSRF strategy for cookie-authed UI (with first web app) ·
SAST/secret-scanning workflow (CPF-45) · backup/restore drills (Phase 3).

## Threat model — critical workflows (STRIDE-condensed)

### T1. Candidate assessment session
| Threat | Vector | Control |
|---|---|---|
| Session hijack | Stolen invitation token | Hashed single-use tokens, expiry, reissue invalidates predecessor, IP/UA anomaly flag (P2) |
| Evidence forgery | Client posts fabricated events | Server timestamps, session-state precondition, category allow-list, sequence integrity checks (P2) |
| Surveillance creep | Ingesting forbidden telemetry | API rejection + DB CHECK + policy; no agent in Phase 1–2 |
| Data exfil via AI panel | Candidate pastes secrets into prompts | Redaction in AI gateway; brief instructs; Trust & Safety criteria assess behaviour |
| Elevation | Candidate token reaching org APIs | Token audience-scoped to candidate surface only |

### T2. Review & report issuance
| Threat | Vector | Control |
|---|---|---|
| Rubber-stamping | Reviewer accepts AI suggestions wholesale | Oversight record logs suggestion use/modification; calibration + sampling double-review |
| Score tampering | Direct DB/API manipulation | RLS, role checks, audit chain, finalisation immutability (reopen creates new version) |
| Report without oversight | API bug | Domain guard + DB CHECK constraint (two independent layers, both tested) |
| Employer overreach | Requesting raw evidence/integrity feeds | Projection layer never exposes them; permission matrix; audit on report access |

### T3. Tenancy & platform
| Threat | Vector | Control |
|---|---|---|
| Cross-tenant read | Missing org filter | RLS backstop (deny-by-default), CI verification, API isolation tests (CPF-42) |
| Insider/support access | Broad admin rights | JIT scoped support access, break-glass dual logging (Phase 3) |
| Audit tampering | UPDATE/DELETE on audit | Trigger blocks; hash chain detects; external anchor (Phase 3) |
| Supply chain | Malicious dependency | Lockfile, npm audit in CI, SCA + SBOM (CPF-45), minimal dependency policy |

### T4. AI features (when enabled)
Prompt injection via candidate content → treat all workspace content as
untrusted in reviewer-assist prompts; output schema validation; no tool
execution from model output; suggestion-only UX; budgets against
denial-of-wallet; provider pinning against silent model swaps; kill switch.

## Incident response (summary; runbook in operations/runbooks)

Detect (alerts, audit anomalies, reports) → classify severity (P0 data
leak/integrity failure …) → contain (kill switch, token revocation, tenant
suspension) → preserve evidence (audit chain export) → assess notification
duties (GDPR 72h supervisory-authority clock; deployer/provider AI Act duties)
→ remediate → post-incident review with control changes. Contacts and
decision tree live in the runbook; **notification decisions require counsel.**
