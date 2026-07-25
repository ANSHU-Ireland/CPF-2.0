# Assumptions Register (Assumption Ledger)

Classes: A0 harmless presentation · A1 ordinary reversible choice ·
A2 material architecture/business assumption · A3 legal/safety/irreversible.
A0/A1 proceed silently; A2 validated early; A3 requires explicit sign-off.

| ID | Class | Assumption | Why reasonable | Risk if wrong | Reversible? | Validation | Status |
|---|---|---|---|---|---|---|---|
| A-01 | A2 | CPF = "Candidate Performance Framework"; brand carries into learning/intelligence phases | Legacy README title; all sources use CPF | Rebranding cost only | Yes | Founder confirmation | Open |
| A-02 | A2 | Commercial model = **assessment decision-support platform** (not placement / managed talent) | Workbook flags the decision but the evaluation-method doc designs for decision support | Different contracts, economics, liability | Partially — framework is model-agnostic | Founder decision (workbook "Plan Assessment" demands a written wedge decision) | **Escalated to founders** |
| A-03 | A2 | Initial wedge: 2 templates (1 SE + 1 DM) selected by design-partner demand; SE1/SE5 + DM1/DM4 shortlisted | Explicit workbook recommendation | Wasted calibration effort | Yes | Paid design-partner interviews | Open |
| A-04 | A2 | 10-dimension workbook model = scoring instrument; 7-dimension profile = employer lens (layered, not conflicting) | Both sources co-exist deliberately; profile assembled from ledger claims | Reviewer/report mismatch | Yes — both are versioned data | Co-founder review of ADR-0004 | Open |
| A-05 | A1 | Small reviewer variances (<2) average to a final criterion score; ≥2 requires adjudication | Workbook specifies adjudication trigger but not sub-trigger resolution; averaging is standard practice | Minor scoring drift | Yes — pure function, versioned | Calibration study in alpha | Accepted for v0.1 |
| A-06 | A2 | EU-first deployment; data residency EU/EEA; English UI first, i18n-ready | Directive scope; sources cite GDPR/EU AI Act throughout | Market limits | Yes | Commercial roadmap | Accepted |
| A-07 | A1 | `CPF_Technical_Overview` PDF (referenced by docx) is superseded by the workbook + this repo's docs | Later-dated sources are more specific | Missed requirement | Yes | Founder review of discovery docs | Open |
| A-08 | A3 | CPF used for recruitment is a **high-risk AI system context under EU AI Act Annex III(4)** when AI features assist evaluation; design assumes high-risk obligations | Co-founder doc: "assume high-risk treatment"; Annex III includes employment/worker selection | Under-compliance if treated lighter | N/A — conservative default | Qualified EU counsel before pilot | **Requires legal review** |
| A-09 | A2 | Modular monolith on PostgreSQL is sufficient through Phase 3 scale | Team size, workload profile (assessment sessions are low-QPS, high-value) | Re-platform cost | Yes — module boundaries preserved | Capacity model at pilot | Accepted (ADR-0001) |
| A-10 | A1 | Node 22 LTS + TypeScript strict + Fastify + zod; plain-SQL migrations | Boring, supported, EU-deployable anywhere | Minor retooling | Yes | — | Accepted (ADR-0002) |
| A-11 | A2 | Candidate identity = invitation-token scoped (not full accounts) for Phase 2 | Minimises data; matches one-off assessment reality | Multi-assessment candidates need accounts later | Yes — `candidates` table already separate from `users` | PRD review | Open |
| A-12 | A3 | No camera/biometric proctoring in any phase without explicit legal approval; integrity signals limited to session-scoped metadata | Co-founder doc + directive monitoring restrictions; Art. 5 AI Act emotion-inference prohibition risk | Product gap vs. surveillance-heavy competitors — accepted trade-off | N/A | Legal review only if ever requested | Accepted as prohibition |
| A-13 | A1 | Retention defaults: evidence 180d, integrity 90d, audit 730d (org-configurable) | Proportionate starting points pending DPIA | Contractual/legal misfit | Yes — per-org config | DPIA + customer contracts | Open |
| A-14 | A2 | GitHub repo name `cpf-enterprise-ecosystem`; push + branch protection done by founders (no credentials in this environment) | Directive suggestion | Name collision | Yes | Founder creates repo | **Blocked by external access** |
