# Design System & Experience Foundation

Status: specification (no UI code yet — honest boundary). This document is the
contract the first frontend build must satisfy.

## Visual direction

Brand attributes: **precise · calm · trustworthy · humane**.
Archetype: *quiet professional*. CPF handles careers; the interface must feel
like a well-run assessment centre, not a gadget. Explicitly avoided: neon
gradients, glassmorphism, purple-blue "AI glow", robot imagery, fake-confidence
visuals, decorative dashboards.

Primary visual principle: **evidence legibility** — hierarchy serves reading
claims, bands, and provenance quickly and calmly during long sessions.

## Tokens (source of truth for the future `packages/design-tokens`)

```
color.surface.default   #FFFFFF      color.surface.raised  #F7F8FA
color.surface.sunken    #EEF0F3      color.border.subtle   #D9DDE3
color.text.primary      #1A202C      color.text.muted      #5A6472
color.action.primary    #1F4E8C      color.action.hover    #17406F
color.status.info       #2C5F8A      color.status.success  #2F7D4F
color.status.warning    #A75F00      color.status.danger   #B3261E
color.focus.ring        #1F4E8C (2px offset 2px, always visible)

Bands (never red/green verdict coding — sequential neutral→deep scale):
band.limited #E8EAEE · band.mixed #C9D4E4 · band.supported #9DB6D9 · band.strong #5277A6

type.family        Inter, system-ui fallback; tabular numerals for data
type.scale         12 / 14 (body) / 16 / 20 / 24 / 32
line-height        1.5 body · 1.25 headings
space              4 8 12 16 24 32 48 64
radius             4 (inputs) · 8 (cards) · 999 (pills)
shadow             0 1px 2px rgba(16,24,40,.06) — single level; depth via borders
motion             120–200ms ease-out; respects prefers-reduced-motion
touch target       ≥44×44px · content max-width 72ch for prose
breakpoints        360 · 768 · 1024 · 1440 (container queries preferred)
```

Contrast: all text pairs ≥4.5:1 (verified at build with automated checks);
status/band colours always paired with text labels + icons — never colour-only.

## Application shell (all portals)

Left navigation (collapsible, role-filtered) · top bar: org switcher, global
search (`/`), help, profile · main content with breadcrumb · right-side detail
drawers for record preview · command menu (Ctrl/Cmd-K) Phase 3.

## Core component inventory (each specifies: anatomy, states — default/hover/
focus-visible/active/disabled/loading/error, keyboard map, ARIA)

DataTable (server pagination, saved views, bulk-select, column prefs) ·
FilterBuilder · RecordHeader + ActivityTimeline · EvidenceBandBadge (band label
+ tooltip with developer rule) · ConfidenceIndicator · ClaimCard (claim,
evidence links, counter-evidence, limitations) · RubricScorer (anchor
definitions inline, 1–5 with keyboard, evidence-note field, "insufficient
evidence" + "not assessed" options) · IntegrityTimeline (separate surface,
contextual-guidance banner: "signals inform review, never verdicts") ·
DisclosurePanel (versioned notices, scroll-completion, explicit acknowledge) ·
StageTimer (pause-aware, accommodation-aware) · EmptyState / ErrorState /
PermissionDeniedState / SessionExpiredState (all with recovery actions) ·
FormField (persistent labels, inline validation after blur, error summary).

## Key screens (specifications for Phase 2 build)

1. **Candidate: disclosure gate** — plain-language what/why/how-long/rights;
   acknowledge button disabled until notices opened; accommodation link;
   never dark-patterned.
2. **Candidate: assessment workspace** — stage rail with timebox, brief panel,
   approved-AI panel (clearly labelled, conversation retained as evidence),
   editor, verification-note field, auto-save indicator, pause, technical-help.
3. **Reviewer: review workspace** — three panes: evidence (prompts/edits/tests
   with source refs) · rubric scorer · ledger claims; integrity tab separate;
   finalisation modal requires rationale + confidence + limitations (mirrors
   the domain gate); adjudication banner when variance flagged.
4. **Employer: evidence profile** — reviewer summary; dimension bands with
   claim drill-down; interview probes; accommodations note; integrity context
   as reviewer narrative only; responsible-use acknowledgement on first access;
   **no numeric index, no comparison ranking**.
5. **Org admin: compliance centre** — retention config, DSR queue with due
   clocks, legal holds, audit search, export (audited).

## Accessibility specification (WCAG 2.2 AA)

Keyboard-complete flows (tab order documented per screen); focus always
visible; skip-links; screen-reader announcements for async state changes
(aria-live polite); no time-based failure without extension path (assessment
timers support documented accommodations and pause); drag alternatives; error
identification in text; form autocomplete attributes; 200% zoom reflow; forced-
colors support; language attributes; accessible PDFs for any exported profile.
Testing: axe automated in CI + manual screen-reader pass (NVDA + VoiceOver)
per release + disabled-user testing before pilot.

### Accessibility audit results (Delivery Plan Step 47, 2026-07-26)

**Automated axe coverage** — `apps/web/test/accessibility.test.tsx` now runs
`vitest-axe` against all 27 distinct page components in `apps/web/src/pages/`
(previously 12; extended this step to add the remaining 15 plus the
already-tracked `EvidenceProfilePage` acknowledgement-gate variant), each
rendered with realistic stubbed data (including empty/suppressed states).
**Result: 29/29 tests pass, zero axe violations** (colour-contrast rule
disabled only within this suite, since `happy-dom` does not compute real
layout/paint — contrast is verified separately below, not skipped).

**Contrast verification** — every documented token pair in the "Tokens" table
above was checked against the WCAG 2.2 AA 4.5:1 (normal text) threshold using
the real sRGB relative-luminance formula (not a visual estimate). Two failures
were found and fixed in this step:
- `color.status.warning` (`#B96A00`, 4.10:1 on white — fails) → **`#A75F00`
  (4.91:1)**. Not currently used as a text colour in `apps/web/src/styles.css`
  (only as an alert border), but the token is corrected so any future
  text-on-white usage is compliant by construction.
- `color.band.strong` (`#5B84B8` with white text, 3.86:1 — fails) → **`#5277A6`
  (4.62:1)**. This one **was** a live defect: `.band.strong { background:
  var(--band-strong); color: #fff; }` in `apps/web/src/styles.css` is the
  `EvidenceBandBadge`'s highest band, rendered with white text — fixed.
All other token pairs pass with margin (16.32:1 body text, 6.00:1 muted text,
8.31:1 action colour, 6.54/5.04/6.75:1 the remaining status colours, 7.87–
13.55:1 the other three band/text pairings). No visual-only status/band
indicator was found — every instance already pairs colour with a text label.

**Manual keyboard tab-order matrix** — verified by reading each page's DOM
structure and confirming a single logical source-order tab sequence with no
positive `tabindex` values anywhere in `apps/web/src` (`grep` confirmed zero
matches), meaning native DOM order governs focus order on every screen:
- Login → email field → password field → sign-in button.
- Candidate portal / assessment workspace → disclosure links (in reading
  order) → acknowledge checkbox → continue button; stage rail is not
  focusable (informational), consistent with the spec's stage-rail design.
- Reviewer workspace → evidence pane (top-to-bottom) → rubric scorer (one
  criterion row at a time: score buttons 1–5 → evidence-note field) →
  finalisation fields (rationale → confidence → limitations) → submit.
- Employer evidence profile → responsible-use acknowledgement gate (when
  unacknowledged, this is the *only* focusable content — verified by the
  existing `EvidenceProfilePage (responsible-use gate, unacknowledged)` axe
  test) → once acknowledged, reviewer summary → dimension list → interview
  probes.
- Org admin screens (compliance centre, team, job profiles, workflow
  insights, etc.) → page heading → primary action button → data table rows
  (each row's actions reachable via forward tab) → pagination/empty-state
  recovery actions.
No keyboard traps were found (every `Modal` in `ui.tsx` closes via a reachable
button and Escape is not required to exit since a visible close control always
exists).

**Known exception, disclosed** — an actual NVDA/VoiceOver screen-reader pass
was **not performed** in this step: this coding environment has no screen
reader available to drive interactively, and fabricating a "pass" result
would violate this project's own testing discipline. What **was** verified
instead, as a partial substitute: every async state change surfaced through
`aria-live="polite"` regions is exercised by axe (which flags missing
accessible names/roles, which a real screen reader would also fail to
announce), and `ui.tsx`'s `Loading`/`ErrorState`/`EmptyState` components were
confirmed (via `grep`) to consistently use `role="status"`/plain text content
rather than icon-only indicators. **A real NVDA/VoiceOver pass on the 4
priority screens (login, candidate portal full journey, reviewer workspace,
evidence profile) remains an open item and must be completed by a human
tester with real assistive technology before pilot**, per the existing spec
line above. This exception is tracked in
[docs/status/completion-report.md](../status/completion-report.md).
