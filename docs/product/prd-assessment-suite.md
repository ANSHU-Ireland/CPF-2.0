# PRD — CPF Assessment Suite (Phases 1–2)

Status: v0.1 · Owner: Product · Modules: Assessment Engine, Employer Portal,
Reviewer Workspace, Candidate Portal · Downstream module PRDs derive from this.

## 1. Users and jobs-to-be-done

| Persona | JTBD | Success looks like |
|---|---|---|
| **Hiring manager "Marta"** (scale-up, 15 open roles) | When CVs all claim AI skills, show me trustworthy evidence of real working ability so I can interview fewer, better candidates | Reads a profile in <10 min; runs the suggested probes; repeat-books assessments |
| **Reviewer "Deniz"** (calibrated senior engineer) | Score a work sample fairly and defensibly in bounded time | Everything evidence-linked; <45 min per review; no "gut feel" required |
| **Candidate "Priya"** (applying while employed) | Show how I actually work, without surveillance anxiety or wasted effort | Clear rules up front; can pause; can challenge; gets treated with dignity |
| **Org admin "Jonas"** | Run assessments lawfully with zero data drama | Retention configured; DSRs handled on time; audit answers in minutes |

## 2. End-to-end journey (happy path)

1. Org admin configures organisation, retention policy, reviewer pool.
2. Hiring manager creates job profile → selects a **frozen template version**
   → invites candidate (expiry, accommodations offered).
3. Candidate opens invitation → identity confirmation → **disclosure
   acknowledgement (mandatory gate)** → system check → assessment workspace
   with approved AI assistant → staged work sample (frame → inspect → build →
   verify → handover) → submit.
4. Reviewer(s) score 18 criteria against anchors with evidence notes; second
   reviewer where sampled; variance ≥2 → adjudication; ledger claims created;
   reviewer finalises with rationale + confidence + limitations (**gate**).
5. Employer receives the Evidence Profile (bands, claims, probes, integrity
   context separately, accommodations noted) — no score, no verdict.
6. Candidate portal: view status, request explanation, challenge, exercise
   data rights.

## 3. Functional requirements (module-level)

### Assessment Engine (implemented core)
- FR-E1 Versioned template library; immutable published versions (✅ schema + seed)
- FR-E2 Transparent scoring: anchors, weights, coverage, variance, critical
  concerns, bands (✅ engine + 60 tests)
- FR-E3 Session lifecycle with disclosure gate, pause/resume, expiry,
  invalidation (✅ state machine; persistence wiring Phase 2)
- FR-E4 Evidence Ledger claims with mandatory rationale (✅ schema)
- FR-E5 Evidence event ingestion with category enforcement + forbidden-event
  rejection (schema ✅; API CPF-24)

### Employer Portal (Phase 2 build)
- FR-P1 Jobs, candidates (dedupe by org+email ✅ schema), imports with partial-
  failure reports
- FR-P2 Invitations: create, expiry, reissue-with-new-token (✅ machine), revoke
- FR-P3 Evidence Profile viewer — bands/claims/probes; **no numeric index shown
  by default**; integrity context visually separated; responsible-use
  acknowledgement before first report access (CPF-34)
- FR-P4 Side-by-side comparison limited to evidence claims (no composite
  ranking; explicit anti-ranking constraint C-01)
- FR-P5 Communication centre with template messages; all sends audited

### Reviewer Workspace (Phase 2 build)
- FR-R1 Queue with calibration-status gating (CPF-33)
- FR-R2 Evidence viewer: prompts, AI responses, edits, tests, verification
  notes; integrity timeline in a separate tab with contextual guidance
- FR-R3 Rubric scoring with anchor definitions inline; evidence note required
  per scored criterion (engine enforces coverage ✅)
- FR-R4 Adjudication flow on variance ≥2 (✅ engine flags; workflow UI Phase 2)
- FR-R5 Finalisation requires rationale + confidence + limitations
  (✅ domain guard + DB constraint)
- FR-R6 Conflict-of-interest decline (✅ machine)

### Candidate Portal (Phase 2 build)
- FR-C1 Invitation acceptance; expired-invitation recovery via reissue request
- FR-C2 Disclosure records with notice versions (✅ schema)
- FR-C3 Accommodation request before start; pause rules honoured (✅ machine)
- FR-C4 Technical-failure recovery: auto-save, resume, incident report attached
  to session
- FR-C5 Data-rights centre: access, rectification, erasure, restriction,
  objection, challenge, human-review request (✅ schema + machine; UI Phase 2)

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Tenancy | RLS deny-by-default on every tenant table (✅); cross-tenant tests in CI (schema-level ✅, API-level CPF-42) |
| Auditability | Hash-chained append-only audit log (✅ schema); every material action audited |
| Availability | Pilot target 99.5%; session auto-save ≤10s loss window |
| Performance | Profile view p95 < 500ms server time; scoring evaluation p95 < 50ms (pure function ✅) |
| Accessibility | WCAG 2.2 AA for all candidate + reviewer surfaces |
| Privacy | Category retention clocks; no cross-customer identifiable reuse |
| Security | See docs/security/security-architecture.md baseline |
| I18n | UI strings externalised; framework data structure supports localisation (Phase 3) |

## 5. Business rules catalogue (extract; authoritative list grows with modules)

| ID | Rule | Enforcement |
|---|---|---|
| BR-01 | A session cannot start without disclosure acknowledgement | State machine (✅ tested) |
| BR-02 | An employer report cannot exist without finalised review | Guard + DB CHECK (✅ tested) |
| BR-03 | Critical criterion ≤2 → concern flag, never rejection | Engine (✅ tested) |
| BR-04 | Reviewer variance ≥2 → adjudication before decision support | Engine (✅ tested) |
| BR-05 | Coverage <0.9 (scores or notes) → "do not decide" route | Engine (✅ tested) |
| BR-06 | Raw keystrokes / full clipboard content rejected at ingestion | DB CHECK (✅) + API (CPF-24) |
| BR-07 | One live candidate record per (org, email); duplicates merge via workflow | Unique constraint (✅) + merge flow (Phase 2) |
| BR-08 | Expired invitations reissue with fresh token; token stored hashed only | Machine + schema (✅) |
| BR-09 | Accommodations recorded before timing comparisons | Session field (✅ schema); report rendering rule (Phase 2) |
| BR-10 | Legal hold suspends retention deletion | Schema (✅); deletion job honours holds (CPF-26) |

## 6. Out of scope (v1) — see also vision non-goals

Bulk psychometrics; proctoring video; placement marketplace; automated JD →
template generation; candidate-facing AI coaching during live assessment
(beyond the approved workspace assistant).

## 7. Open questions

1. A-02 commercial model; A-03 pilot template pair (founder decisions).
2. Candidate accounts vs token identity for repeat assessments (A-11).
3. Evidence-profile PDF export in pilot, or portal-only?
