# Shotwise — Design System & Visual Experience Plan

**Status:** Phase 1 proposal. Awaiting owner approval before any broad redesign.
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

## 8. Component showcase (Phase 3 approval surface)

- **Route:** dev-only hash route `#showcase`, rendered before the Supabase auth gate in
  `App.tsx` (and also when the backend is unconfigured), lazy-loaded via `React.lazy` so the
  production bundle is unaffected. Not linked from any production navigation. No private
  data, no auth required.
- **Data:** `app/src/showcase/fixtures.ts` — a deterministic synthetic dataset (fixed seed /
  literal fixtures, no runtime randomness) covering: a full 4/4 rating, a provisional 3/4,
  an early single-visit club, a club with missing direction measurements, a club with no
  reference, limited-sample clubs, 8+ sessions for trend charts, and shot-level points for
  scatter/dispersion. Values are plausible golf numbers, clearly labelled "synthetic".
- **Sections:** theme toggle (light/dark), token wall (colour/type/spacing), all ds
  primitives incl. slider/range-slider/dialog/disclosure/help-popover states, ClubCards in
  all rating states, score rings/bars, distribution plots, benchmark bars, sparklines,
  trend chart (Recharts), dispersion + scatter plots, empty/loading/missing states, and the
  bottom navigation.
- **Screenshots:** a Playwright script (`app/scripts/screenshot-showcase.mjs`, run against the
  dev server) capturing 320 / 375 / 390 / 768 / 1280 px, light and dark, into
  `docs/design-system/shots/` — committed so the owner can review visuals in the PR without
  running anything. The same script doubles as a visual-regression baseline later.
- **Gate:** owner reviews screenshots + live showcase and approves/refines the direction
  before Overview (Phase 4) starts.

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
| D6 | Overview rebuild on the ds (compact hero, metric strip, controls, insight card, ClubCard list, disclosures) | owner feedback before Phase 5 |
| D7–D11 | Remaining screens one PR each: Clubs, Progress, Gapping, Sessions (+recap/compare), Shot shape + Explorer + Review/Settings | per-screen review |
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

## 13. Open questions for the owner

1. Approve the overall direction and token palette (hexes are starting points)?
2. Navigation: adopt Home / Clubs / Progress / Sessions / More as in §9, or keep the current
   Home / Analyse / Sessions / Review / More?
3. Typography: fully drop the serif (Newsreader/Lora) including the wordmark, or keep the
   expressive wordmark in the header only?
4. Hero: keep a compact animated hero on Overview, or replace it with the metric strip only?
5. Motion: is CSS-transition-only acceptable, or do you want Motion for ring/bar/expand
   animations?
6. Showcase: is a dev-only `#showcase` route (no auth) acceptable, or should it be gated behind
   a query flag / build flag instead?
