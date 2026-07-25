# Contributing to CPF Enterprise Ecosystem

## Ground rules

1. **Documentation-first.** Material product or architecture changes require an
   updated PRD section or a new ADR in [docs/decisions](docs/decisions) before code review.
2. **No governance regressions.** Changes must not introduce employer-facing
   scores presented as hiring outcomes, automated rejection, hidden cutoffs, or
   raw-surveillance exposure. CI and code review both check for this.
3. **Tests are part of the change.** Domain logic changes without tests are not
   reviewable. Critical flows (scoring, tenancy, permissions, data rights)
   require tests before merge.
4. **Honest status.** Never mark a feature complete while its tests fail or its
   verification is pending. Use the status categories in
   [docs/status/completion-report.md](docs/status/completion-report.md).

## Branching

- `main` — protected; releasable at all times; PRs only, no direct pushes.
- `feat/<short-name>` — feature branches.
- `fix/<short-name>` — bug fixes.
- `docs/<short-name>` — documentation-only changes.

Configure branch protection on GitHub after pushing: require PR review,
require the `ci` check, forbid force pushes. (This cannot be configured from
the local repository; see docs/operations/environments.md.)

## Local workflow

```bash
nvm use                 # Node 22
npm install
npm run typecheck
npm test
```

## Commit style

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
Reference backlog IDs (e.g. `CPF-42`) where applicable.

## Coding standards

- TypeScript strict mode; no `any` without a written justification comment.
- Validate at every trust boundary with zod schemas.
- No secrets in source, tests, fixtures, or logs.
- Domain logic stays in `packages/` and must be testable without network or DB.
- SQL migrations are append-only: never edit a merged migration; add a new one.
- Every failure path returns the machine-readable error contract
  (see docs/api/api-standards.md).

## Definition of Done

See [docs/agile/definition-of-ready-done.md](docs/agile/definition-of-ready-done.md).
