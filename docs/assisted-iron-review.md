# Automatic likely-mishit filter — experimental rule

The review queue and optional stats filter share rule `low-flight-2`. A flag is
an unusually short, slow shot, not a confirmed contact diagnosis. “Hide likely
mishits” is off by default, changes only the current analysis view, and never
writes reviews, changes measurements or permanently excludes shots.

## Rule

- Support recognised drivers, woods, hybrids, irons and wedges, using effective
  labels. Unknown/unrecognised clubs abstain. Only included, non-archived shots count.
- Assess uncertain contact. A reviewed typical decision overrides an automatic
  flag; reviewed typical shots can contribute baseline evidence. Existing reviewed
  partials and mishits are not evidence. The stats filter also hides reviewed
  mishits. Existing Gapping eligibility still excludes reviewed partials/mishits
  in both views; no partial-swing workflow is added.
- Require positive range-flat carry and range ball speed on the same shot. Never
  substitute premium estimates or combine disjoint measurement samples.
- Require 20 earlier paired shots of exactly the same effective club within 60
  calendar days ending on the shot date. Target the latest 50, retaining the full
  cutoff date. Unknown intent and unreviewed contact contribute.
- Earlier means an earlier date, an earlier source row in the same session, or a
  strictly earlier known time in another session on the same date. Equal/missing
  times, import order, shot numbers and UUIDs do not establish cross-session order.
- Reference each metric's 75th percentile. Flag only carry strictly below 65% of
  its reference AND ball speed strictly below 80% of its reference. Reference
  values need not belong to a single shot. Show medians, references, cutoffs and
  sample sizes beside flags.
- Missing, nonpositive or insufficient evidence abstains and stays included in
  stats. Future shots never classify earlier ones. Automatic flags themselves do
  not remove baseline evidence, so the filter does not change its own reference.

The old iron-only median-minus-MAD rule could abstain on broad distributions.
An upper-quartile reference can identify substantial joint losses even in a
wide mixture of short and longer shots, including rounded constant baselines.
These provisional thresholds are not calibrated probabilities or validated
contact classifications. A mostly poor baseline can hide real mishits. Flight
alone cannot establish intent or separate equipment, measurement and contact effects.

## Local evaluation

Run `npm run verify:unusual -- /absolute/path/to/exports` from `app/`. It checks
byte/shot preservation, input-order independence and earlier-assessment invariance
when later sessions are added, printing aggregate counts only. It writes no
exports and contacts no database. Filename dates are assumed only for this check.

On 17 November 2026, five supplied exports parsed without warnings: 517 shots,
510 eligible known-club shots, 312 assessed, 198 abstained and 34 flagged. Seven
unknown-club shots remained outside assessment. Exploratory sensitivity checks
flagged 25 with 60% carry / 75% speed and 38 with 70% / 80%. The selected 65% / 80%
rule includes driver/wedge candidates without aiming to remove all band overlap.

The exports have no independently labelled contact ground truth. Counts show
coverage and sensitivity, not precision, recall or accuracy. No personal rows,
filenames, measurements or exports are committed as fixtures.

## Analysis and verification

The toggle is shared across Overview, Gapping, Progress and Shot shape and resets
on reload/account changes with other analysis settings. Recent membership is
chosen before filtering; removed shots are not backfilled with older history.
The selected basis controls displayed carry; detection consistently uses the
named range-flat fields.

Gap flags/recommendations use medians, with ten measured carries per neighbour:
0–10 m prioritises the longer club, reversed medians identify the longer club
carrying less, and gaps over 30 m remain labelled large. Overlapping P10–P90 bands
alone produce no gap advice. Spread/directional insights remain separate.

Public tests cover joint losses, sparse/missing evidence, rounded/broad baselines,
chronology, review precedence, unchanged data, reversible filtering across views,
and the 5i 111 m / 6i 109 m example. No persistence/schema changes are required.
