# ADR-0002: Strong-strike carry ("distance potential") estimation

Status: accepted
Date: 2026-11-24
Related: `docs/ROADMAP.md` §6, `app/src/domain/potential.ts`

## Context

Roadmap §6 asks the app to separate what a golfer can achieve with a club from
what they normally achieve, and to investigate robust upper-tail estimators
(P75, P80, upper-quartile mean, median of high-performing strikes) for
distance potential, avoiding the maximum and arbitrary symmetric ranges.

## Decision

**Strong-strike carry is the P80 carry of the strong-strike population** per
club, implemented as `clubStrongStrike()` / `potentialCarry()` in
`app/src/domain/potential.ts` (`strong-strike-1`):

- Population: included shots in the current analysis cohort (Recent/All
  window) that resolve (ADR-0001) to a full swing with non-mishit contact
  under a known club, with carry measured on the selected basis. Suspected
  wrong-club labels are excluded so they cannot create false personal bests;
  partials and mishits (manual or automatic) never pollute full-swing
  potential.
- Estimator: `quantile(carry, 0.8)`, shown only at n >= 10 measured carries
  (`MIN_POTENTIAL_SAMPLES`); below that the estimate is `null` and the row is
  marked unreliable rather than guessed.
- No artificial upper ceiling: long legitimate shots count toward P80; the
  maximum is never used. A single wild reading moves P80 only slightly (see
  the estimator investigation in `potential.test.ts`), unlike the maximum.
- The gapping view exposes the identical number (`ClubGap.potential` from the
  same population via `metricStats.p80`), so the estimate is consistent across
  screens. Every row carries `shotIds` so analytics can link back to the
  contributing shots.

Naming follows roadmap §6.2: the metric is called **strong-strike carry** or
**distance potential**; it is not a measure of overall shot quality (a long
shot is not automatically a good shot — direction is evaluated separately).

Consistency (IQR) and mishit frequency remain computed from the broader
population, never from the strong-strike subset, to avoid artificially narrow
distributions (roadmap §6.3).

## Consequences

- PR 13 can add All / Typical / Strong-strike performance controls on top of
  this definition; PR 14 can show potential next to reliability in club
  summaries and profiles.
- Because the population follows the Recent/All window, early beginner
  history does not dominate potential when Recent is selected.
- Changing the estimator later (e.g. to upper-quartile mean) is a one-line
  change behind `POTENTIAL_QUANTILE`/the versioned rule, and the estimator
  comparison tests will need updating.
