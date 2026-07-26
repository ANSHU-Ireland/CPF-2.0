# User acceptance test pack

This document is an execution-first checklist for validating the implemented CPF platform flows locally. It is intended for another model to run against the real API and web app, not for production sign-off or legal certification.

## 1. Scope

Validate the main user journeys for these personas:

- Platform administrator
- Organisation administrator
- Hiring manager
- Reviewer
- Candidate
- Learner / learning administrator
- Support-style role

The cases below target the routes and flows already implemented in the codebase, including authentication, org setup, hiring, review, candidate portal, data rights, learning, and intelligence views.

## 2. Preconditions

Before starting, confirm the following:

- Node 22 is installed and active
- npm 10+ is installed
- Docker Desktop or Docker Engine is available for the local PostgreSQL and Mailpit stack
- Ports 5432, 4000, 5173, 8025, and 1025 are free
- The repository has been installed with npm install

## 3. Local startup sequence

Run these commands from the repository root:

```bash
docker compose up -d
npm install
npm run seed:generate
docker compose exec -T postgres psql -U cpf -d cpf < packages/db/seed/generated/seed.sql
```

Create a bootstrap administrator account:

```bash
BOOTSTRAP_EMAIL=you@example.eu \
BOOTSTRAP_PASSWORD='a-long-password' \
DATABASE_URL=postgresql://cpf_api:cpf_local_dev@localhost:5432/cpf \
node apps/api/scripts/bootstrap.mjs
```

Start the API:

```bash
DATABASE_URL=postgresql://cpf_api:cpf_local_dev@localhost:5432/cpf npm run api:dev
```

In a second terminal, start the web app:

```bash
npm run dev -w @cpf/web
```

Open http://127.0.0.1:5173 and sign in with the bootstrap credentials.

## 4. Suggested test data

Use a small, predictable dataset to keep the UAT run fast:

- Organisation name: UAT Labs
- Candidate one: candidate.one@example.eu
- Candidate two: candidate.two@example.eu
- Reviewer account: reviewer@example.eu
- Hiring manager account: hiring@example.eu
- Learning admin account: learning@example.eu
- Support account: support@example.eu

Keep the passwords simple and record them in the defect log for reuse.

## 5. Execution order

Run the cases in this order so the later flows have prerequisites:

1. Platform administrator creates an organisation and activates the first org administrator
2. Org administrator invites the other org roles and creates a job profile
3. Org administrator creates candidates and sends invitations
4. Candidate completes the portal flow
5. Org administrator assigns a reviewer and the reviewer completes scoring and finalisation
6. Org administrator checks the evidence profile and data-rights/compliance views
7. Learning and intelligence roles validate their scoped pages
8. Support-style access validates the role-limited views

## 6. Persona test cases

### P-01 Platform administrator

- Preconditions: Bootstrap admin is signed in.
- Entry point: Platform organisation view at /platform/organisations.
- Steps:
  1. Create a new organisation with a clear name.
  2. Capture the activation token or follow-up activation instructions returned by the platform flow.
  3. Confirm the organisation appears in the platform list.
- Expected result:
  - The organisation is created successfully.
  - The platform admin can see the new organisation in the list.
  - The activation path is available for the first org administrator.

### O-01 Organisation administrator

- Preconditions: The org exists and the first org admin has activated.
- Entry point: Org team view at /org/:orgId/team.
- Steps:
  1. Invite a hiring manager, reviewer, learning admin, and support role user.
  2. Confirm each invited user appears in the org membership list.
- Expected result:
  - Invitations or membership records are created successfully.
  - Each role is visible in the team view with the correct role label.

### O-02 Hiring manager

- Preconditions: The org admin has created the org and one or more users with the hiring manager role.
- Entry point: Job profile and candidate views at /org/:orgId/job-profiles and /org/:orgId/candidates.
- Steps:
  1. Create a job profile.
  2. Create a candidate record.
  3. Import a small CSV with two valid rows and one invalid row.
- Expected result:
  - The job profile is created and listed.
  - The candidate is created and visible in the candidate list.
  - The import returns a clear result for created, duplicate, and invalid rows.

### O-03 Invitation and candidate handoff

- Preconditions: Candidate and job profile exist.
- Entry point: Invitation create flow from the org hiring views.
- Steps:
  1. Create an invitation for a candidate.
  2. Capture the candidate portal URL or access token returned by the API flow.
  3. Open the portal in a separate browser session.
- Expected result:
  - The invitation is created successfully.
  - The candidate receives a portal entry point that resolves to the candidate portal.
  - The invitation has a clear expiry and status.

### C-01 Candidate portal flow

- Preconditions: A candidate invitation exists and the candidate portal URL is available.
- Entry point: /candidate/:token.
- Steps:
  1. Open the portal URL.
  2. Accept the invitation.
  3. Acknowledge disclosure.
  4. Start the session.
  5. Submit a small evidence event and add an accommodation note.
  6. Submit a data-rights request.
- Expected result:
  - The candidate can progress through the invitation, disclosure, and session states.
  - Evidence submission is accepted while the session is active.
  - Accommodation and data-rights requests are accepted without breaking the flow.

### R-01 Reviewer workflow

- Preconditions: A candidate assessment session has been submitted for review and the reviewer has been assigned.
- Entry point: Reviewer queue at /org/:orgId/reviews and review workspace at /org/:orgId/reviews/:reviewId.
- Steps:
  1. Open the review queue.
  2. Open the assigned review.
  3. Review the evidence bundle.
  4. Save a score for at least one criterion.
  5. Save a second score if the review is configured for double-scoring.
  6. Use the preview endpoint or visible preview UI to inspect the decision-support output.
- Expected result:
  - The reviewer sees the assigned review and evidence.
  - Scores are persisted and available for preview.
  - The review can move from assigned to in-progress and eventually to finalisation when the required inputs are present.

### R-02 Finalisation and report issuance

- Preconditions: The reviewer has completed the review input.
- Entry point: Review workspace and session profile paths.
- Steps:
  1. Finalise the review with rationale, confidence, and limitations.
  2. Issue the report for the session.
  3. Open the evidence profile view.
- Expected result:
  - Finalisation succeeds only when the required fields are present.
  - The report issuance transition succeeds after the review is finalised.
  - The evidence profile is available only after the report is issued.

### L-01 Learning administrator and learner

- Preconditions: The org has learning modules or course content available.
- Entry point: Learning pages under /org/:orgId/learning.
- Steps:
  1. Open the learning admin view and create or inspect a course or pathway.
  2. Enroll a learner or open a learner-facing page.
  3. Start a lesson and mark progress.
- Expected result:
  - The learning admin and learner views load correctly.
  - The learner can progress through the lesson flow without hitting unexpected permission errors.

### I-01 Intelligence and workflow insights

- Preconditions: The org has the relevant module entitlement and role access.
- Entry point: Intelligence and workflow-insight pages under /org/:orgId/intelligence and /org/:orgId/workflow-insights.
- Steps:
  1. Open the intelligence settings page.
  2. Open the pain points or insights pages.
  3. Open the workflow insights page.
- Expected result:
  - The pages load with the expected role-scoped content.
  - No raw data is exposed beyond the intended access boundary.

### S-01 Support-style role

- Preconditions: A support-style user is assigned to the org with the relevant role.
- Entry point: The org-level support or intelligence views.
- Steps:
  1. Sign in as the support-style user.
  2. Open the available pages.
- Expected result:
  - The user can access the pages permitted by the role.
  - The UI blocks access to pages outside the support scope.

## 7. Exit criteria

A persona pass is considered successful when:

- The route loads without an unexpected 401, 403, 404, 409, or 422 error for the intended happy path
- The expected state transition is visible in the UI or API response
- The user can complete the core task without hitting a broken or misleading error state

## 8. Defect log template

Capture each issue with:

- Persona
- Route or page
- Preconditions
- Steps taken
- Expected result
- Actual result
- Severity
- Screenshot or note

Example:

```text
Persona: Reviewer
Route: /org/:orgId/reviews/:reviewId
Preconditions: Assigned review exists
Steps: Open review, save score, finalise
Expected: Review finalises successfully
Actual: 422 ADJUDICATION_REQUIRED
Severity: Medium
Evidence: Screenshot or API response snippet
```
