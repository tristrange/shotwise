# ADR-0003: Category-score definitions for club ratings

Status: accepted
Date: 2026-11-26
Related: `docs/ROADMAP.md` §8, `app/src/domain/scores.ts` (`category-scores-1`)

## Context

Roadmap §8 asks for an intuitive assessment of which clubs a golfer performs
well with, built from four categories — distance potential, consistency,
directional control and reliability — with every score explainable and
reproducible, and no numerical rating where evidence is insufficient (§8.4).
Phase 6 PR 18 designs and validates the definitions; PR 19 puts them in the UI;
PR 20 decides whether an overall composite is defensible.

## Decision

Four category scores per club, versioned as `category-scores-1` and implemented
in `app/src/domain/scores.ts` as `categoryScores(data, basis, query, club)`.
Each category is reported as its **raw metric in a native unit** plus sample
size, sufficiency flag and a qualification note — never as a guessed number:

| Category | Value (unit) | Population | Estimator | Sufficient at |
| --- | --- | --- | --- | --- |
| Distance potential | strong-strike carry P80 (m), higher is better | full swings, non-mishit contact, suspected wrong-club excluded | `clubStrongStrike` P80 (ADR-0002) | n ≥ 10 measured carries |
| Consistency | carry IQR (m), lower is better; P10 shown alongside | all resolved full swings, mishits included | `metricStats` IQR / P10 from the reliability cohort | IQR needs n ≥ 4, P10 needs n ≥ 20 |
| Directional control | median abs launch direction (deg), lower is better; median abs from-centre (m) alongside | resolved full swings with launch direction measured | median of `\|launchDirection\|`, `\|fromCentre\|` | n ≥ 4 with launch direction |
| Reliability | mishit share of assessed full swings (0–1), lower is better | resolved full swings with manual or automatic contact assessment | mishits / assessed full swings; unassessed count always shown | n ≥ 10 assessed |

Rules that the validation tests in `scores.test.ts` pin down:

- **No double-counted statistics.** Every estimator reuses the existing modules
  (`clubStrongStrike`, `metricStats`, recap cohorts, `reviewCoverage`); nothing
  is reimplemented in `scores.ts`.
- **Potential never borrows from the strong-strike subset's opponents.**
  Consistency and reliability always use the broader reliability cohort
  (mishits and flagged shots included), so a potential view cannot make an
  inconsistent club look reliable (§8.2). The test proves this by population
  counts: 12 clean + 2 mishit shots give consistency n = 14 but potential n = 12.
- **Directional control is never inferred from curvature.** `curve` alone does
  not produce a score; sessions without launch direction get
  "not measured in this data" (§8.2: curvature ≠ landing dispersion).
- **Reliability accounts for classification uncertainty.** Automatic contact
  assessments from the validated classifier (PR 11, methodology in PR 11's
  `evaluation.ts`) count as assessed, but the number of still-unassessed full
  swings is always displayed next to the rate.
- **Insufficient data yields null, not zero.** A category below its sample
  minimum is marked insufficient with the requirement in the note.

## What is deliberately not decided here

- **No 0–100 composite and no normalization yet.** External benchmark datasets
  are link-only (ADR/research in `docs/external-benchmark-sources.md`), so
  there is no embedded reference population to normalize against. PR 19 shows
  raw metrics with within-bag standing; PR 20 decides the composite, and only
  if the normalization and weighting are defensible (§8.3).
- **No handicap-equivalent ratings** (§7: unsupported).
- **Range-ball bases get no external comparison**; category scores themselves
  stay available because they are computed from the golfer's own shots on the
  selected basis.

## Consequences

- PR 19 can render the four categories in the expanded club card and full
  profile straight from `categoryScores`, with `CATEGORY_SCORE_DEFINITIONS`
  supplying the methodology text.
- Changing an estimator or threshold is a one-line change behind the versioned
  constants (`MIN_RELIABILITY_SAMPLES`, …); bump `CATEGORY_SCORES_VERSION` when
  a definition changes so stored/displayed scores stay interpretable.
