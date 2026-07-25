# Definition of Ready & Definition of Done

## Definition of Ready (a story may enter a sprint when)
1. User, need, and business value are explicit ("As a… I need… so that…").
2. Acceptance criteria are testable and enumerate main flow + alternatives +
   edge cases (expired, duplicate, permission-denied, failure, recovery).
3. Permissions row exists or is updated in the permission matrix.
4. Audit events and analytics events are named.
5. Compliance impact assessed (new personal data? AI? retention? monitoring?)
   — if yes, register updates are part of the story.
6. Dependencies and blocking decisions (assumption ledger IDs) are listed.
7. Sized to fit within one sprint; spikes split out explicitly.

## Definition of Done (a story is done when)
1. All acceptance criteria demonstrably pass.
2. Tests: new/changed domain logic unit-tested; API changes have inject tests;
   tenant-touching code has isolation tests; critical flows keep e2e coverage.
3. `npm run typecheck`, `npm test`, lint, and CI are green.
4. UI work ships all states (loading/empty/error/permission/expired) and
   passes axe + keyboard walkthrough; API work follows the error contract.
5. Audit events emitted and visible in the log for material actions.
6. Migrations are additive with rollback notes; seed updated when needed.
7. Documentation updated: PRD/FR delta, ADR if architectural, runbook if
   operational, registers if compliance-relevant.
8. Honest status: anything partial, mocked, or unverified is recorded in
   docs/status/completion-report.md — never silently omitted.
9. No P0/P1 defect open against the story; security-relevant changes reviewed
   by a second engineer.
