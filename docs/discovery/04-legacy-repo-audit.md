# Discovery — Legacy Repository Audit

Audited: `c:\Users\rudra\Desktop\CPF` (read-only) · 2026-07-25 ·
The legacy repository was **not modified** and **no code was copied** into
this repository.

## What the legacy system is

A Next.js 16 / Prisma / PostgreSQL investor-demo MVP ("Candidate Performance
Framework"), self-described in its own README as *"an internal MVP and
investor-demo system… not cleared for real candidate processing and must not
be described as GDPR compliant, EU AI Act compliant, SOC 2 compliant… or
production-ready."* It ships demo logins where **any password is accepted**.

Stack observed: Next.js 16.2.9, React 19, Prisma 6, next-auth v5 beta,
Radix UI, Tailwind, Resend, Upstash rate-limit. ~47 Prisma models. Docs folder
with compliance architecture, accessibility runbooks, pilot-readiness notes.

## Findings and classification

| # | Finding | Classification |
|---|---|---|
| L1 | Product concept: assess AI collaboration on real work samples, human-reviewed, evidence-first | **Preserve as product concept** — core of the new PRD |
| L2 | Disclosure-first flow (`AssessmentDisclosureRecord`), oversight record, DSR models, retention/legal-hold models — good conceptual shapes | **Redesign completely** — concepts kept, schema re-derived from first principles in migration 0002 |
| L3 | Demo authentication accepting any password; NextAuth beta dependency | **Reject** — named SOC 2 blocker in the co-founder document; new build will implement hardened auth (Argon2id, MFA, session revocation) as CPF-40 |
| L4 | Monolithic Next.js app mixing UI, API routes, and domain logic in `lib/` | **Reject** — replaced by modular monolith with a pure domain package (ADR-0001) |
| L5 | Scripted/demo AI responses presented in demo mode | **Requires validation** — acceptable for offline demos only if explicitly labelled; new build separates fixtures from product claims |
| L6 | Prisma schema: business logic (scoring, guardrails) not encoded as constraints; no RLS; tenant isolation only at query level | **Redesign completely** — new schema enforces RLS deny-by-default, append-only audit, CHECK-level guardrails |
| L7 | Audit chain concept (`audit-chain.ts`, hash-linked) | **Preserve as concept** — re-implemented as `audit_log` with `prev_hash`/`entry_hash` and DB-level append-only trigger |
| L8 | Event model `SessionEvent` (single table, mixed categories) | **Redesign completely** — categorised `evidence_events` per the co-founder document's five categories |
| L9 | Desktop agent (`desktop/`) for OS-level integrity signals | **Requires legal review** before any implementation — deferred (CPF-50); monitoring restrictions documented in compliance/monitoring-and-integrity-policy.md |
| L10 | Committed `.env` / `.env.local` files in the legacy app | **Reject / security lesson** — new repo gitignores all env files, commits only `.env.example`; if legacy secrets were real, rotate them (flagged to founders) |
| L11 | `sbom.json` present | **Preserve practice** — SBOM generation added to engineering-plan backlog (CPF-45) |
| L12 | Docs: TECHNICAL_OVERVIEW, COMPLIANCE_ARCHITECTURE, DEMO_SCRIPT etc. | **Reference** — business terminology reused; documents superseded by this repo's docs tree |
| L13 | No automated tests found for scoring or guardrails | **Reject as practice** — the new domain engine ships with 60 tests before any UI exists |
| L14 | Next.js build artefacts (`.next/`), `node_modules`, lockfiles committed alongside source in working tree | **Hygiene lesson** — new repo has strict ignores |

## Security problems observed (legacy, for the record)

1. Any-password demo authentication (by design, but a live risk if ever deployed).
2. Real `.env` files in the working tree.
3. No enforced tenant isolation below the application layer.
4. Guardrails (no auto-reject etc.) existed as UI copy, not as constraints.

## Conclusion

The legacy system validated the product idea and vocabulary. Its architecture,
security posture, and persistence design were not suitable as a foundation.
The new build preserves the *methodology* and rebuilds everything else from
first principles, as directed.
