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
color.status.warning    #B96A00      color.status.danger   #B3261E
color.focus.ring        #1F4E8C (2px offset 2px, always visible)

Bands (never red/green verdict coding — sequential neutral→deep scale):
band.limited #E8EAEE · band.mixed #C9D4E4 · band.supported #9DB6D9 · band.strong #5B84B8

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
