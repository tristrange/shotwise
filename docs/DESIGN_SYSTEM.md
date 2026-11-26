# Shotwise — Design System & Visual Experience Plan

**Status:** Owner-approved 2026-11-26. D2–D5 (tokens, ds primitives, chart kit,
ClubCard + dev showcase) are implemented on `feat/design-system-foundation` and the
showcase direction was approved after owner inspection (badge/distribution-bar/score-bar
refinements applied at the component level). D6 (Overview rebuild) is implemented and
merged (PR #100). D7 (Club Profiles) is merged (PR #101): the full profile is a deeper
ClubCard composition (rating ring + evidence badges in the header, headline carry
metrics, category bars, shared-scale distribution band, benchmark bars vs the personal
reference, directional graphics only where measured, interactive session-history chart,
reference editing, facts, methodology behind disclosures), plus the Overview
refinements — readable club names beside badges, measurement-coverage text moved into
contextual popovers, a shorter mobile hero, and one shared distribution scale across
club cards. D8 (Progress) is implemented on `feat/progress-redesign`: one interactive
`PerformanceTrendCard` per page (club selector, metric segmented control over median
carry / strong-strike potential / carry IQR / ball speed / launch / apex, headline value
with change vs the first measured session, first/latest/best session tiles, tappable
Recharts trend with an optional P80 comparison series and session-recap links), a
concise cross-club carry-trend comparison with the no-proof caveat, and the detailed
per-club session tables behind disclosures; Club Profiles refinements — a deep-linked
`#clubs/<club>` shows that one profile (picker gains an "All clubs" link), the history
table sits behind a disclosure, and facts render as compact metric rows. D9 (Gapping) is
implemented on `feat/gapping-redesign`: the gapping screen is now controls card + one
unified shared-scale chart (`GappingChart`) with selectable views — carry distribution
(P10–P90 + IQR + median + dashed P80 marker per club on one axis), distance potential
(selected-cohort median vs strong-strike P80 bars), and simple median carry bars — with
touch-friendly club chips and tappable rows/bars driving a concise detail panel (carry,
potential, spread, sample coverage), a compact adjacent-club gap card using the approved
`clubGaps` flags (small/large/reversed, methodology behind a HelpPopover, no equipment
recommendations from overlap), and a ds-rebuilt Wedge practice section (target-vs-median
carry comparison bars with the unverified-carry-reference caveat, per-group distribution
plots on a shared scale, an intent mix bar separating full swings from partial practice,
per-group shot-level scatter, shot tables behind disclosures). Presentation consumes
`clubGaps`/`wedgePractice` via `gappingView` (`ClubGap` gained `q1`/`q3` from the same
band cohort); the legacy `.gap-*`/`wedge-*` styles were removed. D10 (Sessions and
comparisons) is implemented on `feat/d10-sessions-comparisons`: the session history is a
ds-card logbook of compact `.session-card`s (date/time + venue + filename, shot count as
the main link, clubs/median-carry summary, Archived badge, unassessed pill, per-session
compare icon-link, file facts behind a disclosure) beside a ds-rebuilt import panel; the
session recap keeps its domain functions but renders headline carry, club-participation
share bars, carry-vs-baseline and reliability/coverage metric grids, and per-club
details behind ds disclosures with a baseline methodology popover; session comparison uses
compact ds selectors (reference/comparison/intent), A/B side cards with a chip legend,
a shared-scale `CarryCompareChart` (A/B bars on one 0-based axis, tap a bar or club chip
for that club's accordion), and side-by-side tables with Reference (A) / Comparison (B) /
Difference columns where absolute differences are metres and relative ones are labelled
percentages (percentage-point differences for direction shares). Wedge practice metrics
gained compact direction bars. Review fixes landed in the same branch: visible ds icon
buttons, an upward-opening help popover near the viewport bottom, a Club Profile header
that wraps badges below the name at 320 px, true-scale distribution bands with coincident
endpoint ticks, honest zero-gap rendering, theme-token chart ticks with reserved label
space, session-ID-keyed trend selection with a keyboard/touch picker, withheld deltas
when chronology is unknown, per-series tooltip names/counts, P80-only clubs kept in the
Potential view, distinct P10–P90 vs IQR sample labels, and Progress computed once and
passed down with on-demand disclosure bodies. Screenshots: `docs/design-system/shots/sessions-*.png`.
D11 (Shot shape + Explorer + Review/Settings) is implemented on `feat/d11-explorer-review-settings`:
the shot-shape screen is one ds card with a compact club `Select`, the shared window/mishit/basis
controls, a single launch-direction × curve `PerformanceScatterPlot` (symmetric domains, dashed zero
lines, directional `° L / 0° / ° R` and `m L / 0 / m R` tick labels), selected-shot metric tiles,
paired-measurement coverage text and the full shot table behind a `Disclosure`, with the methodology
in a HelpPopover; the explorer makes the scatter central with ds `Select`s for club and both axes, a
compact `Time scope` segmented control plus session picker, intent/contact filters behind a secondary
`Disclosure`, paired/missing/omitted counts, the paged shot table and the `Review shot` link, and
semantic dashed-warn point styling for automatic likely mishits (provisional — unassessed shots are
never marked as good strikes); Review renders ds cards for the summary (flag/auto counts, guidance,
methodology disclosure, filter segmented control), the focused shot, the batch controls and the
correction preview, with solid `manual review` badges versus dashed `provisional` automatic badges;
Settings groups Manage bag, club suggestions and Backups into ds cards, and equipment assignment in
session details uses ds fields — no settings, analytics, classification or database changes.
Screenshots: `docs/design-system/shots/d11-*.png`.

## 0. Approval record — 2026-11-26

The owner approved the architecture, visual direction and phases, with these
decisions:

1. **Tokens/palette:** approved as provisional starting points; exact colours
   refined through the showcase and the automated contrast test
   (`app/src/tokens.test.ts`, WCAG AA guarded).
2. **Navigation:** Home / Clubs / Progress / Sessions / More approved with the
   grouping Home = overview + practice focus + club summaries; Clubs = profiles,
   gapping, shot shape, ball-flight explorer; Progress = trends; Sessions =
   import/history/recap/compare/optional review; More = equipment, settings,
   backups, secondary Review. **Implementation deferred to Phase 5** — all
   existing routes and deep links must keep working. Not part of D2–D5.
3. **Typography:** Instrument Sans throughout, tabular numerals for statistics;
   the expressive Newsreader wordmark may stay in the header; editorial serif
   removed from headings/content (done in D2).
4. **Hero:** keep the animated identity, much more compact on mobile; analytics
   early in the first phone viewport (D6).
5. **Motion:** CSS transitions first; Motion approved where it materially
   improves an interaction.
6. **Showcase:** unauthenticated dev-only showcase approved, but it must be
   **excluded from production by a build-time guard**, not just hidden —
   implemented as `import.meta.env.DEV` + lazy import in `App.tsx`, so the
   production bundle contains no showcase code (verified: `grep -ri showcase
   dist/` is empty after `npm run build`; guarded by
   `app/src/showcase/fixtures.test.ts`).

Additional requirements applied in D2–D5: dense information hierarchy (category
ratings as labels/numbers/bars; sample counts, evidence, uncertainty and
reference metadata behind contextual help/disclosure); interactive chart
compositions (heading + club select + metric segmented control + headline value
+ delta + tappable chart — see `PerformanceTrendCard`); sliders with immediate
feedback; benchmark bars with target markers; visual correctness (selected-cohort
median vs typical carry distinguished, P80 labelled as strong-strike potential,
percentile band vs IQR distinct, missing = `—` never zero, fixed premium-flat
rating basis labelled next to selected-basis measurements, no fabricated
historical rating series).
**Scope guard:** This plan changes presentation only. Statistical formulas, classification
methodology, club-rating weights/normalization (`ratings-2`, ADR-0005 v2), measurement-basis
policies, database models and analytics eligibility rules are out of scope and untouched.
Presentation components must consume the existing tested domain functions in
`app/src/domain/` — no analytics is reimplemented in components.

Visual references (supplied by the owner, copied into this repo):

- [reference-club-cards.png](design-system/reference-club-cards.png) — expandable club list with
  score ring, metric tiles and rating breakdown (primary target for the ClubCard).
- [reference-interactive-charts.png](design-system/reference-interactive-charts.png) — chart card
  with club selector, metric segmented control, headline metric + delta, and a trend chart.
- [reference-design-tokens.png](design-system/reference-design-tokens.png) — typography scale and
  the illustrative semantic colour palette.

---

## 1. Current-state assessment

Stack: React 19 + TypeScript + Vite + Supabase (`app/package.json`). Styling is a single
hand-written stylesheet, `app/src/styles.css` (575 lines), with a light/dark theme driven by
`:root` / `:root[data-theme='dark']` custom properties (`app/src/theme.ts`,
`app/src/components/ThemeToggle.tsx`). Lucide React is used for icons. **Recharts is installed
but not used anywhere yet** — all current charts are hand-rolled SVG.

| Area | Current state | Files |
| --- | --- | --- |
| Shell / navigation | Hash routes in `App.tsx`; desktop sidebar (8 items) + mobile 5-tab bottom nav (Home / Analyse / Sessions / Review / More) with an Analyse sub-nav; safe-area handling present | `app/src/App.tsx`, `styles.css` |
| Overview | Animated editorial hero (dark, dotted texture, SVG lanes) + 4-stat strip; club rows as a "gap list" with P10–P90 band, expandable detail via a small "Details" button; two raw stat tables; rating chip + breakdown on expand | `components/Analysis.tsx`, `components/Hero.tsx`, `components/FlameCanvas.tsx`, `components/ClubRating.tsx` |
| Controls | Pill buttons + segmented controls for performance mode (All/Typical/Strong-strike), window (Recent/All-time), basis cycler, mishit toggle | `components/AnalysisControls.tsx` |
| Ratings UI | `RatingChip` (composite + provisional/early markers) and `RatingBreakdown` (4 bars, measurements, reference context, methodology `<details>`) | `components/ClubRating.tsx` |
| Charts | Hand-rolled SVG only: gapping bands (`ClubGaps.tsx`), progress bars (`ClubProgress.tsx`), accessible scatter (`ScatterPlot.tsx` used by `ShotShapes.tsx` / `BallFlightExplorer.tsx`) | `components/*.tsx` |
| Visual language | Editorial: Newsreader/Lora serif headings, Instrument Sans UI, JetBrains Mono numbers, paper `#fbfaf6` background with a global SVG noise texture (`body::after`), dark sidebar `#0f1016`, violet accent | `styles.css`, `index.html` (font import) |
| Motion | Scroll-entry reveal via Web Animations API | `app/src/reveal.ts` |
| Domain layer (reuse, do not touch) | `analytics.ts` (`selectCohort`, `metricStats`, `summarize`, `benchmarkClubGroups`, `clubGaps`, `practiceInsights`), `ratings.ts` (`clubRatings`, `clubRating`, weights/anchors, `resolveRatingReference`), `potential.ts` (`clubStrongStrike`), `progress.ts` (`clubProgress`), `benchmarks.ts` (`compareWithReference`, `referenceBasisCompatible`), `explorer.ts`, `shotShapes.ts`, `compare.ts`, `recap.ts`, `assessment.ts` (`resolveShots`) | `app/src/domain/*` — all unit-tested |
| Tests | `npm test` (344 unit tests), Playwright e2e 88 tests (desktop Chromium + iPhone-13 WebKit) in `app/tests/app.spec.ts`, relying on accessible names/roles (e.g. list "Median carry by club", buttons "All"/"Typical"/"Strong-strike", "Hide likely mishits") | `app/tests/app.spec.ts`, `playwright.config.ts` |

**Gaps vs. the target look:** serif editorial typography, noise texture, uppercase eyebrow
labels, square buttons/inputs, text-heavy panels and duplicate raw tables on Overview, tiny
"Details" expansion target, no score ring, no trend/sparkline components, no design-token
layer, Recharts unused.

## 2. Design principles (agreed direction)

1. Show, don't tell — numbers, charts, comparisons, hierarchy over paragraphs.
2. Compact by default; analytical depth behind interaction (progressive disclosure).
3. Methodology behind contextual disclosures (`<details>` / HelpPopover), never inline walls of text.
4. Native-app feel on iPhone: bottom nav, safe areas, 44px touch targets, first-viewport value.
5. Keep Shotwise identity (brand green, wordmark) without the editorial serif/noise baggage.
6. Preserve analytical depth — simplify presentation, never remove meaningful functionality.
7. Colour communicates meaning; never colour alone (pair with label/icon/shape — provisional =
   dashed ring, early = dotted ring, missing = `—`, per current `ClubRating.tsx` semantics).

## 3. Design tokens

Single source of truth in a new `app/src/styles/tokens.css`, imported first from `main.tsx`.
Semantic names only in components; the existing `styles.css` aliases (`--text`, `--border`, …)
keep working during the transition and are re-pointed at the semantic tokens.

```css
:root {                      /* light */
  --bg: #f5f5f4;             /* light neutral surface (from reference palette) */
  --surface: #ffffff;
  --surface-2: #ececea;
  --border: #e3e3e0;
  --text: #242726;           /* dark neutral (from reference palette) */
  --text-2: #55585a;
  --text-3: #83868a;
  --brand: #237b65;
  --data: #7299bf;           /* primary chart series */
  --compare: #9482c6;        /* comparison series / references */
  --pos: #26966c;  --warn: #b6a055;  --neg: #c67c58;
  --ring-track: #e3e3e0;
  --focus: #237b65;
  --radius-s: 8px; --radius-m: 12px; --radius-l: 16px; --radius-pill: 999px;
  --space-1..8: 4px-based scale (4,8,12,16,20,24,32,40);
  --shadow-1: 0 1px 2px rgb(0 0 0 / .05);
  --dur: 160ms; --ease: ease-out;
  --font-sans: 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  color-scheme: light;
}
:root[data-theme='dark'] {
  --bg: #1b1e1d;             /* slightly darker than surface */
  --surface: #242726;        /* dark neutral surface (from reference palette) */
  --surface-2: #2e3231;
  --border: #383d3c;
  --text: #f5f5f4; --text-2: #c9ccc9; --text-3: #94989a;
  --brand: #3fa98c;           /* lightened for contrast on dark */
  --data: #8fb0d8; --compare: #b0a3dd;
  --pos: #3cb37f; --warn: #cbb26a; --neg: #dd9070;
  --ring-track: #383d3c;
  --focus: #6fc7ac;
  color-scheme: dark;
}
```

Notes:

- The hex values are starting points (per the brief), finalized with a contrast check:
  every `--text*`/semantic pair must meet WCAG AA (4.5:1 normal, 3:1 large); a small script or
  unit test asserts the key pairs so tokens can't silently regress.
- Typography: Instrument Sans (already loaded) for everything; metric values get
  `font-variant-numeric: tabular-nums`. Drop Newsreader/Lora from the UI and JetBrains Mono
  from metrics; keep the expressive wordmark only in the compact header/hero. Type scale:
  12/14/16/20/28 with `-0.01em` tracking on headings; no uppercase eyebrow labels (muted 12px
  sentence-case labels instead).
- Remove the global `body::after` noise texture. Surfaces: flat `--surface` cards with 1px
  `--border`, `--radius-m`, optional `--shadow-1`; avoid nested cards.
- Spacing: 4px-based scale; 16px screen padding on phones (plus safe-area insets); 44px min
  touch targets.
- Motion: 120–200ms ease-out transitions for expansion/hover; all animation disabled under
  `prefers-reduced-motion` (including the existing `reveal.ts` scroll reveal and hero lanes).

## 4. Architecture

- Keep React + TS + Vite + Supabase, single hand-written CSS (no Tailwind migration). Split
  `styles.css` progressively: `styles/tokens.css` (new), `styles/base.css` (element defaults,
  focus states) and per-area component CSS migrated screen-by-screen in Phase 5 PRs. During
  the transition everything stays in `styles.css`, sectioned by comment banners.
- New presentation layer in `app/src/components/ds/` (primitives) and
  `app/src/components/charts/` (visualization). Existing screens import from there; no
  duplicate implementations across screens.
- Charts: adopt **Recharts** (already a dependency, currently unused) for conventional charts
  (trend lines/areas, bars) and keep **custom SVG** for golf-specific graphics (score rings,
  dispersion corridors, gapping bands, percentile bands). One shared `ChartContainer` +
  `ChartTooltip` so axes, gridlines, series colours, missing-data and reduced-motion rules live
  in exactly one place.
- Motion: plain CSS transitions; add Motion (framer-motion) only if a specific interaction
  (e.g. ring/bars animating on expand) materially improves it — decided at showcase review.
- Accessible primitives: prefer native elements (`button`, `select`, `input[type=range]`,
  `<details>`, `dialog`) styled by the ds. Evaluate Base UI / Radix only where a native element
  is insufficient (e.g. Slider with two thumbs, Dialog with focus trap, Select with rich
  options) — shadcn/ui as the reference pattern, port only the needed component, no full
  framework install.
- Showcase: dev-only, see §8 — lazy-loaded so it costs nothing in the production bundle path.

## 5. Component inventory

### Reuse as-is (adapt styling only)

| Existing | Becomes |
| --- | --- |
| `AnalysisControls.tsx` segmented/pill controls | ds `SegmentedControl`, `Select`, `Switch` — same accessible names so e2e keeps passing |
| `ClubRating.tsx` `RatingChip` / `RatingBreakdown` | charts `ScoreRing` (collapsed) + `RatingBreakdown` (expanded); provisional/early/withheld semantics unchanged |
| `ScatterPlot.tsx` (accessible SVG points) | charts `PerformanceScatterPlot` + `ShotDispersionPlot` wrappers |
| `ClubGaps.tsx` band+dot rows | `DistributionPlot` (inline band) + gapping corridor graphic |
| `ClubProgress.tsx` SVG bars | Recharts-based trend via `ChartContainer` |
| `Hero.tsx` / `FlameCanvas.tsx` | compact `Hero` variant (mobile much shorter); keep animation, respect reduced motion |
| `reveal.ts` scroll reveal | keep, verified against `prefers-reduced-motion` |
| `ThemeToggle.tsx`, `theme.ts` | unchanged mechanics, new token values |

### New ds primitives (`components/ds/`)

Card, SectionHeader, Metric, MetricGrid, Badge, Divider, EmptyState, LoadingState,
HelpPopover (icon button + popover with methodology text), Disclosure (styled `<details>`),
Button, IconButton, SegmentedControl, Select, Slider, RangeSlider, Accordion, Tabs, Dialog,
BottomNavigation (extracted from `App.tsx`).

### New chart components (`components/charts/`)

ChartContainer, ChartTooltip, Sparkline, ScoreRing, ScoreBar, RatingBreakdown, DistributionPlot,
BenchmarkBar, ShotDispersionPlot, PerformanceScatterPlot.

### Golf analytics components

`ClubCard` (the signature component, §6), plus screen-level compositions reusing the above.

## 6. ClubCard — specification (maps to reference-club-cards.png)

Data (all from existing domain functions; ratings always on the fixed premium-flat rating
basis, ADR-0005):

- `benchmarkClubGroups` + `metricStats` → typical/selected-cohort carry median, P10–P90, IQR, n, missing (`analytics.ts`)
- `clubStrongStrike` → strong-strike potential (P80) + sample sufficiency (`potential.ts`)
- `clubRatings` → composite + 4 category ratings, evidence levels, reference context (`ratings.ts`)
- `compareWithReference` / `resolveRatingReference` → benchmark bar where a compatible reference exists (`benchmarks.ts`)
- `directionStats` / `summarize` → directional summary where measured

**Collapsed row** — the whole header is one `<button aria-expanded aria-controls>`:
club-code badge (D, 5i, PW…), club name, `137 m carry · 151 m potential` (muted, tabular),
`ScoreRing` with composite value (dashed ring = provisional n/4, dotted = early — never a
bare number), small evidence badge when sample-limited, chevron. Tapping navigates nowhere;
a separate "profile" icon-link is the distinct accessible action to the full club profile
(no nested interactive controls).

**Expanded panel** (animated height, `aria-expanded` semantics, keyboard + touch):

1. MetricGrid: ball speed, launch, apex (each `—` + "x of y measured" when missing — never 0).
2. RatingBreakdown: four ScoreBars with score, measurement sub-line, n · visits · evidence.
3. DistributionPlot: carry percentile band (P10–P90 + IQR + median marker) with sample note.
4. BenchmarkBar where a basis-compatible reference exists; reference type labelled
   (personal goal / historical personal potential / external benchmark — never mixed silently).
5. Directional line only where measured (`—` otherwise).
6. Footer row: "Full club profile →" link + HelpPopover ("How this rating is calculated",
   the existing ADR-0005 methodology text).

Consolidates today's duplicated raw-score sections: measurements appear once, ratings once.
Missing categories show as withheld (`—`), not zero. Expansion is smooth, responsive,
reduced-motion aware, and independently toggleable per card (accordion behaviour configurable,
default: multiple open).

## 7. Overview hierarchy (target order)

1. Compact branded header (existing mobile header / slim desktop brand; hero reduced to a
   compact variant — animated lanes kept but much shorter on phones; no noise texture).
2. Metric strip: shots in view, sessions, clubs, date range (compact `Metric`s, tabular nums).
3. Shared window controls: Recent / All-time segmented + All / Typical / Strong-strike
   segmented + basis `Select` (same labels/roles as today so e2e holds).
4. One practice-insight card (from `practiceInsights`) when supported.
5. ClubCard list ("Your clubs") — carry, potential, score ring, expandable details.
6. On-demand: distribution summary (compact chart/table), directional summary — behind
   disclosure, replacing today's two always-visible raw tables.

Everything useful within the first phone viewport; desktop keeps the sidebar.

## 8. Component showcase (Phase 3 approval surface) — implemented in D5

- **Route:** dev-only hash route `#showcase`, rendered before the Supabase auth gate in
  `App.tsx` (also when the backend is unconfigured). Build-time guard:
  `const Showcase = import.meta.env.DEV ? lazy(() => import('./showcase/Showcase')) : null`
  plus an `import.meta.env.DEV && location.hash.startsWith('#showcase')` render check, so
  production builds drop the module, its CSS and its chunk entirely (verified against
  `dist/`; guarded by a unit test). Not linked from any production navigation. No private
  data, no auth required.
- **Run locally:** `cd app && npm run dev`, then open
  `http://127.0.0.1:5173/#showcase` (any port Vite picks works — use the printed URL +
  `#showcase`). Toggle light/dark with the header button. To re-capture screenshots:
  `npm run shots:showcase`.
- **Data:** `app/src/showcase/fixtures.ts` — a deterministic synthetic dataset (seeded
  PRNG, no runtime randomness) shaped to show every rating state, verified by
  `app/src/showcase/fixtures.test.ts`: full well-supported 4/4 composites (D, 7i — 7i with
  seeded mishits), a full composite on early evidence (5i), a provisional 3/4 composite
  with launch-only direction (PW), and no rating (<10 shots, 9i). Ratings are computed by
  the real `ratings-2` domain module; nothing is mocked.
- **Sections:** token wall (live values from `tokens.css` in the active theme), type scale,
  spacing scale, all ds primitives (buttons, icon buttons, badges incl. provisional/early,
  segmented controls, select, slider, range slider, help popover, disclosure, dialog), club
  cards in all rating states (one expanded), `PerformanceTrendCard` (club select + metric
  segmented control + headline + delta + tappable Recharts trend), score rings, distribution
  plots, benchmark bars with target markers, sparklines, dispersion plot with corridor,
  ball-flight scatter (via `explorerPlot`), empty/loading states, metric grid.
- **Screenshots:** `app/scripts/screenshot-showcase.mjs` (`npm run shots:showcase`) captures
  320 / 375 / 390 / 768 / 1280 px × light/dark full-page into
  [docs/design-system/shots/](design-system/shots/) — committed for review:
  `showcase-{320,375,390,768,1280}-{light,dark}.png`. Verified no horizontal overflow
  (scrollWidth == viewport at every width).
- **Gate:** owner reviews screenshots + live showcase and approves/refines the direction
  before Overview (Phase 4 / D6) starts.

## 9. Navigation proposal — owner decision required

Current mobile tabs (shipped in PR #56): **Home / Analyse / Sessions / Review / More**, with
Clubs, Gapping, Progress, Shot shape in the Analyse sub-nav; Ball-flight explorer under Shot
shape. The brief proposes **Home / Clubs / Progress / Sessions / More** (Review demoted to
secondary under Sessions or More; Gapping and ball-flight must stay discoverable).

Recommendation: adopt Home / Clubs / Progress / Sessions / More — Gapping becomes a section of
Clubs, shot-shape + explorer become sections of Progress (or a "More analyses" row on Clubs),
Review moves under More — **but this changes existing navigation and deep links, so it needs
explicit owner approval**; all existing hash routes (`#clubs/7i`, `#shape/explorer`, …) keep
working regardless. Desktop sidebar mirrors the same grouping.

## 10. Proposed implementation PRs (small, independently reviewable)

| PR | Content | Gate |
| --- | --- | --- |
| D1 | This document + reference images (`docs/DESIGN_SYSTEM.md`, `docs/design-system/`) | owner approval of direction |
| D2 | Design tokens + base layer: `styles/tokens.css`, semantic light/dark tokens, Instrument Sans + tabular numerals, remove noise texture, focus states, reduced-motion, contrast test | visual snapshot review |
| D3 | ds primitives in `components/ds/` with render/a11y tests (roles, names, keyboard, 44px targets) | unit tests + showcase section |
| D4 | Chart kit in `components/charts/`: ChartContainer/ChartTooltip (Recharts), ScoreRing, ScoreBar, RatingBreakdown (moved from ClubRating), Sparkline, DistributionPlot, BenchmarkBar, dispersion/scatter wrappers; shared axis/grid/missing-data/reduced-motion rules | chart rules review |
| D5 | `ClubCard` + dev-only `#showcase` route with synthetic fixtures + Playwright screenshot script; screenshots committed under `docs/design-system/shots/` | **owner visual approval** |
| D6 | Overview rebuild on the ds (compact hero, metric strip, controls, insight card, ClubCard list, disclosures) — **merged as PR #100** | owner feedback before Phase 5 |
| D7 | Club Profiles redesign on the ds — **merged as PR #101** | owner review |
| D8 | Progress redesign on the ds — **implemented on `feat/progress-redesign`** (see status above) | owner review before D9 |
| D9 | Gapping redesign on the ds — **implemented on `feat/gapping-redesign`** (see status above) | owner review before D10 |
| D10 | Sessions (+recap/compare) redesign on the ds — **implemented on `feat/d10-sessions-comparisons`** (see status above) | owner review before D11 |
| D11 | Shot shape + Explorer + Review/Settings redesign on the ds — **implemented on `feat/d11-explorer-review-settings`** (see status above) | owner review before D12 |
| D12 | Final polish: navigation decision applied, obsolete CSS removed, full verification (§11) | final sign-off |

Phases map to the brief's Phase 1–6; D1–D5 ≈ Phases 1–3, D6 ≈ Phase 4, D7–D12 ≈ Phases 5–6.

## 11. Accessibility & quality gates (every PR)

- Keyboard navigation, accessible names, visible focus (`--focus` ring), correct
  expanded/collapsed semantics on every interactive component; 44px touch targets where
  practical; no horizontal overflow at 320 / 375 / 390 px, tablet and desktop.
- Light + dark, `prefers-reduced-motion`, safe-area insets, existing routes/deep links, PWA.
- Status never by colour alone (provisional/early/withheld/missing all have shape+text).
- Charts: accessible data alternative (table or sr-only summary) per chart.
- Verification per AGENTS.md: `npm test` (do not weaken existing tests — components must keep
  the accessible names the e2e suite relies on, or tests are updated deliberately with equal
  or stronger assertions), `npm run typecheck`, `npm run lint`, `npm run build`
  (incl. `--base=/shotwise/`), `npm run test:e2e` (88 tests, Chromium + WebKit phone),
  plus Playwright screenshots at the required widths for changed screens.
- Performance: `npm run verify:performance` unaffected (ratings already ≈14–16 ms warm at
  12k shots); new components memoized like `clubRatings` in `Analysis.tsx`.

## 12. Explicitly not changing

- `app/src/domain/*` analytics, classification, ratings formulas/weights/anchors (ADR-0005 v2),
  measurement-basis and rating-basis policies, eligibility rules.
- Database schema, Supabase migrations, backup/restore, owner isolation.
- Hash routes and deep links; PWA manifest; auth flow.
- Existing e2e/unit test intent.

## 13. Owner questions — all resolved 2026-11-26 (see §0 approval record)

The six questions originally listed here were answered by the owner on 2026-11-26; they are kept
as the consolidated decision record, not as open items:

1. **Direction + palette:** approved as provisional starting points; colours refined through the
   showcase and the automated WCAG-AA contrast test (`app/src/tokens.test.ts`).
2. **Navigation:** keep the current Home / Analyse / Sessions / Review / More shell for now; the
   proposed Home / Clubs / Progress / Sessions / More regrouping stays **scheduled for D12** (§9),
   with all existing hash routes and deep links preserved until then.
3. **Typography:** Instrument Sans throughout with tabular numerals; the expressive Newsreader
   wordmark stays in the header only.
4. **Hero:** keep the animated identity as a much more compact hero on Overview (done in D6).
5. **Motion:** CSS transitions first; Motion only where it materially improves an interaction.
6. **Showcase:** dev-only `#showcase` approved, gated by a build-time guard (`import.meta.env.DEV` +
   lazy import), verified absent from production `dist/`.
