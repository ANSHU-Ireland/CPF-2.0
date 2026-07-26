# Candidate-Facing Notices — DRAFT (Delivery Plan Step 49)

**Status: DRAFT. Not legal advice. Requires counsel review and sign-off
(legal-review item LR-04) before any real candidate sees this content.**
Every version below is bound to the `NOTICE_VERSIONS` constants in
[`apps/api/src/modules/constants.ts`](../../apps/api/src/modules/constants.ts)
(`"2026-07-25.draft-1"`); a disclosure record stores exactly which version a
candidate acknowledged, so changing this text requires bumping the version
constant, never silently editing it in place.

The product currently renders a one-line DRAFT summary of each notice in
[`apps/web/src/pages/CandidatePortalPage.tsx`](../../apps/web/src/pages/CandidatePortalPage.tsx)
and requires every notice to be opened before a candidate may proceed. The
fuller text below is the working draft this summary will expand to once
counsel approves final wording; it is written from what the platform
actually does today, not aspirational copy.

## 1. Privacy notice (`privacyNotice`, version `2026-07-25.draft-1`)

We (the employer using this platform) collect and process your personal data
to run this assessment: your name and email address, your work-sample
submissions and the AI-assistant conversation you have while completing
them, session timing and status, and a limited set of activity signals
described in the Telemetry notice below. We do not collect or infer your
emotional state, biometric data, or any special category of personal data.

Your work is reviewed by a human reviewer, who writes a rationale for their
assessment. No automated system scores, ranks, or decides pass/fail on your
submission — a human always makes the final call, and the employer remains
accountable for any decision made using this evidence.

Your data is stored for the retention period set by the employer for this
role (visible on request) and is deleted automatically once that period
ends, unless a legal hold applies. You can request access, correction,
deletion, or a copy of your data, or object to how it is processed, at any
time — see "Your rights" below.

*(DRAFT gaps for counsel: exact lawful basis wording per launch country;
controller/processor role statement; DPO contact details; cross-border
transfer statement if a non-EU sub-processor is later contracted.)*

## 2. AI-use notice (`aiUseNotice`, version `2026-07-25.draft-1`)

During this assessment you may use the approved AI assistant provided in
your workspace. Everything you and the assistant exchange is captured as
part of your evidence — this is by design, since how you work with AI is
what is being assessed, not a hidden or incidental recording.

You must not use any AI tool other than the one provided in your workspace.
Using an unapproved external AI tool, or pasting content from outside the
workspace without disclosure, may be flagged for the reviewer's attention as
an integrity signal — this is never treated as an automatic fail, and you
can always add your own note explaining any flagged activity.

The AI assistant itself is a fixed, version-pinned configuration — every
candidate assessed against the same role template in the same period uses
the identical AI assistant configuration, so no candidate has an AI-quality
advantage over another.

*(DRAFT gaps for counsel: precise scope of "approved AI tool" definition per
role template; wording for any Art. 50 AI-Act interaction-disclosure
requirement beyond what's above.)*

## 3. Telemetry notice (`telemetryNotice`, version `2026-07-25.draft-1`)

While your assessment session is active, the platform records a limited set
of activity signals: whether your browser tab or window loses focus, whether
you exit full-screen mode (if the assessment requires it), whether you paste
content shortly after returning from a focus change, periods of inactivity,
and whether the same session is opened from more than one device at once.

**We do not record your keystrokes, your clipboard contents, your camera or
microphone, or infer anything about your emotional state.** These signals
exist only to give your reviewer honest context about your working
conditions — for example, to distinguish a genuine interruption from a
pattern worth asking you about — and are shown to reviewers separately from
your actual work evidence, never combined into it. You can add your own
annotation to any recorded signal, and dispute it through the challenge
process described in "Your rights."

*(DRAFT gaps for counsel: exact retention period statement per jurisdiction;
any required works-council notice for monitoring in applicable countries.)*

## 4. Assessment rules (`assessmentRules`, version `2026-07-25.draft-1`)

This assessment is a work-sample exercise, not an interview or exam in the
traditional sense. You are expected to use the approved AI assistant as you
would in a real working context — the platform is designed to observe how
you direct, verify, and take responsibility for AI-assisted work, not to
catch you using AI.

Your session may be paused and resumed within the assessment window; you may
request an accommodation before starting if you need one. If you experience
a technical failure, report it immediately through the workspace — your
session can be recovered and your reviewer will see the incident report.
Your submission is reviewed by a qualified human reviewer; you will be
notified once a decision affecting you is communicated by the employer
outside this platform. You may request an explanation of the process,
challenge how a specific piece of evidence was interpreted, or request
additional human review, at any time — see "Your rights."

*(DRAFT gaps for counsel: role-template-specific rule variations, if any are
later introduced; exact challenge/appeal SLA wording.)*

## Your rights (all four notices point here)

You can request: access to your data, correction of inaccurate data,
erasure, restriction of processing, a portable copy of your data, or object
to processing — through the "Data rights" section of your candidate portal
or by contacting the employer directly. You can also request a human
explanation of how your evidence was reviewed, or challenge a specific
finding, through the same route. Requests are actioned within the timeframe
required by applicable law (design target: 30 days).

---

**Counsel review checklist (LR-04)**: confirm lawful-basis wording per
launch jurisdiction; confirm controller/processor allocation statement;
confirm DPO contact requirement; confirm this satisfies GDPR Art. 13/14 and
AI Act Art. 50 simultaneously without duplicative/contradictory text; confirm
retention-period disclosure format; sign off a final version and record the
approved version string as the new `NOTICE_VERSIONS` value (never edit
`"2026-07-25.draft-1"` in place once any real candidate has acknowledged it).
