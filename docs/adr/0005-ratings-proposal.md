# ADR-0005 (ACCEPTED v2): normalized club ratings on a common 0–100 scale

Status: **accepted 2026-11-25 with owner clarifications** (see §10; roadmap §13.6 approval scope, §13.8). Implementation proceeds in small PRs; formulas/anchors/weights stay provisional until the owner evaluates real ratings on their own data.
Date: 2026-11-25 (v1 proposed → owner feedback → v2 revised → accepted same day)
Related: reopens ADR-0004; `docs/ROADMAP.md` §13.5 item C3, §13.6 decisions 1/2/3/5/6; `app/src/domain/scores.ts` (`category-scores-1`), `app/src/domain/benchmarks.ts` (reference basis compatibility), `app/src/domain/potential.ts` (`strong-strike-1` P80); reproducible fixture `docs/adr/adr-0005-illustrative-scores.mjs`

v1 of this document was reviewed by the owner on 2026-11-25. The architecture
below is approved (four normalized 0–100 category ratings, composite index,
provisional weights 20/25/30/25, progressive evidence levels, no mandatory
three-visit gate, optional personal benchmarks, automatic historical personal
potential as a distinct labelled reference, removal of raw-metric standings,
Overview placement with expandable breakdown, separately versioned
classification and scoring methodologies). The exact scoring formulas were
revised per that feedback; this v2 is the review artifact for the revised
methodology. The canonical implementation of the §4 functions is
`app/src/domain/ratings.ts` as versioned constants `ratings-2` (PR #94); the
documentation fixture `docs/adr/adr-0005-illustrative-scores.mjs` imports that
single source (run from `app/`: `npx tsx ../docs/adr/adr-0005-illustrative-scores.mjs`)
and generates every illustrative table in §8, so docs and app share one
calculation source instead of maintaining two independent implementations.

## 1. What the ratings represent

A **designed performance index**, not a scientifically validated golf skill
rating and not a handicap equivalent. The objective is a useful and intuitive
club-performance index for everyday golfers: which clubs do I perform well
with, which should I practise, which aspect needs work, and am I
underperforming relative to reasonable expectations. No population
percentiles or handicap equivalents are invented anywhere.

## 2. Two measurement bases: classification vs rating (owner feedback §5)

The canonical **classification basis** and the **rating basis** serve
different purposes and are kept separate and stable:

- **Classification basis (unchanged, A7/#83):** range-preferred canonical
  values per shot; a display-basis switch never reclassifies club, intent or
  contact.
- **Rating measurement policy (new, `rating-basis-1`):** all ratings are
  computed on one fixed declared basis — **`premium-flat`** — because a
  premium-flat estimate exists for every shot and compatible premium-ball
  references (personal or external) are comparable with it. Range-ball and
  premium measurements are **never pooled into the same performance
  distribution**; range-ball bases measure the limited-flight range ball and
  stay out of distance ratings and numerical benchmark comparisons.
- Ratings read only the rating basis, never the display selection, so changing
  a display setting cannot silently change shot classification or any rating.
  Every rating row declares the basis it was computed on.
- Reference comparisons on the rating basis prefer an **exact** basis match;
  a family-level match (e.g. a `premium` reference vs the `premium-flat`
  rating basis) is allowed but labelled "family-level", and `flat`/unadjusted
  variants are never mixed. Carry references are never compared with total
  measurements. `unknown`-basis legacy references are shown but never
  compared (C1/C2 gating).

## 3. Inputs (per club, on the rating basis)

From the resolved full-swing population (suspected wrong-club rows excluded;
mishits included in consistency/reliability/direction, excluded from
strong-strike potential):

- **Distance potential** — strong-strike carry P80 (ADR-0002, mode-invariant).
- **Consistency** — carry IQR **relative to median carry** (IQR/median), full
  population including mishits.
- **Directional control** — **P80 of absolute lateral finishing error**
  (`fromCentre`) relative to median carry. The P80 (upper tail), not the
  median, is the scoring metric so that poor offline shots count, not only
  typical performance. Median |lateral| and corridor success rate are shown
  alongside (corridor = declared half-width per club role, §4). When
  finishing-position data is unavailable, launch-direction error is scored
  **separately** on its own anchors and labelled "launch basis" — never
  silently substituted, and the two bases are never mixed. Curvature alone is
  never treated as landing dispersion.
- **Reliability** — 1 − mishit share over assessed full swings (manual or
  automatic contact), with assessed/unassessed coverage and a sensitivity
  range (§4.4).

## 4. Normalization to 0–100 (higher = better), versioned constants `ratings-2`

### 4.1 Distance — capped target attainment (owner feedback §1)

```
distanceScore = min(100, 100 × P80 / reference)
```

A golfer at 80% of target scores **80**, not zero. Excess distance above the
reference is capped at 100 (it never compensates poor control), and the
measured P80 is always displayed alongside the reference.

### 4.2 Consistency — role-based relative-IQR anchors (owner feedback §2)

`score = 100 × clamp01((poor − x) / (poor − good))` with `x = IQR/median` and
the owner-proposed provisional anchors:

| Club role | excellent (100) | poor (0) |
| --- | --- | --- |
| Driver / woods | 5% | 30% |
| Hybrids / irons | 4% | 25% |
| Full-swing wedges | 4% | 25% |

These are **product constants, not validated population benchmarks**. The
owner's worked example: a 7 iron with median 120 m and IQR 10 m (rel IQR
8.33%) scored **0** under v1 anchors and **79.4** under these (§8.2). The
sensitivity sweep (§8.5) shows v2 keeps the scale informative across the
whole amateur range instead of compressing everything above ~10% rel IQR to
zero. Final anchors are selected after the sensitivity evaluation and real
data, not from this document alone.

### 4.3 Directional control — P80 lateral error (owner feedback §4)

Scored on `x = P80(|fromCentre|) / median carry` with provisional anchors:

| Club role | good (100) | poor (0) |
| --- | --- | --- |
| Driver / woods | 8% | 25% |
| Hybrids / irons | 5% | 18% |
| Full-swing wedges | 6% | 20% |

Corridor success rate (% of shots within the declared corridor half-width:
8% / 5% / 10% of median carry by role) is displayed alongside. Corridor rate
was evaluated as the scoring metric instead of P80-lateral: it is intuitive
but depends entirely on the corridor-width choice and saturates near 0/100;
P80-lateral is continuous and directly reflects the poor-offline tail, so it
is the proposed scoring metric with corridor rate as a complementary display.
Launch-direction fallback anchors (P80 |launch|, degrees, all clubs):
good 1.5°, poor 6° — provisional constants.

### 4.4 Reliability — acceptable-strike percentage (owner feedback §3)

```
reliabilityScore = 100 × clamp01(1 − estimatedMishitShare)
```

A 25% mishit rate scores **75**, not zero. Uncertainty is preserved and
labelled precisely:

- **Sampling uncertainty:** a Wilson 95% interval on the mishit share — it
  addresses *sampling* uncertainty only, under its i.i.d. assumptions. It is
  **not** presented as accounting for classifier uncertainty.
- **Classification uncertainty:** assessed vs unassessed coverage is always
  reported (assessed = manual or automatic contact), plus a missingness
  sensitivity range: the score range if all unassessed swings were mishits vs
  all clean (§8.4).
- **Correlated categories:** the four categories are *not* independent — a
  mishit typically lowers carry, widens dispersion and pushes the ball
  offline, so it penalizes consistency, direction and reliability at once.
  §8.3 quantifies this: at a 25% mishit rate the composite is 51.4 with
  mishits in all three populations vs 69.7 in the clean-only counterfactual
  (an ~18-point overlap). v2 keeps the full-population basis — mishits are
  real performance — and documents the overlap rather than double-discounting
  or silently removing it; the weights are revisited after real-data review.

### 4.5 Reference for distance potential (owner feedback §6)

Priority order, each clearly labelled in the UI and never mixed:

1. A basis-compatible **personal reference** value, matched against the
   *rating basis* (`premium-flat`), never against the display selection —
   exact match preferred, family-level labelled; `unknown` is never silently
   compared.
2. **Automatic historical personal potential** — shown as its own labelled
   reference row ("historical personal potential: best per-visit P80, n ≥ 10
   per visit, trailing 12 months"). It measures attainment of previously
   demonstrated ability, not a comparison with other golfers. **Leave-the-
   evaluated-window-out guard:** the window under evaluation is excluded from
   the historical reference, so current shots can never set their own
   reference and automatically score 100 (§8.6). Used as the distance
   reference only when no compatible personal reference exists — never
   silently applied.
3. A basis-compatible **external golfer benchmark**, when numerical data is
   available. Today all external sources are link-only (licensing, D1), so
   this is usually absent; external numerical benchmarking remains an active
   objective.

No reference at all → the distance category is **withheld** (the measured P80
is still displayed); the other three categories are unaffected, so useful
ratings exist without any user setup.

## 5. Composite and coverage policy (owner feedback §6 — resolves the v1 contradiction)

`composite = 0.20·distance + 0.25·consistency + 0.30·direction + 0.25·reliability`

- Each category rating is shown **individually** whenever its minimum sample
  is met — no mandatory user setup, no all-or-nothing gate.
- **All four categories present → full composite** on Overview beside each
  club's main statistics; tapping reveals the four category bars; methodology
  behind a disclosure.
- **2–3 categories present → provisional composite**, renormalized over the
  present categories, labelled with its coverage (e.g. "provisional, 3 of 4
  categories"), and **never ranked against composites with a materially
  different category set**.
- **Fewer than 2 → no composite** (raw measurements only).

Weights are the owner-approved provisional constants, versioned separately
from classification (`ratings-2` vs `intent-contact-3` / `sequence-2` /
`strong-strike-1`).

## 6. Evidence levels and missing-data policy (progressive, §13.6 decision 5)

No hard 3-visit gate. Per category, by eligible n: **<10** no numerical rating
(raw measurements only); **10–19** early provisional (flagged); **20–29**
provisional; **≥30 across ≥3 visits** better-supported. Category minimums:
distance needs ≥10 strong-strike shots; consistency ≥4 measured (flagged
<20 for IQR stability); direction ≥10 with `fromCentre` measured (else the
launch-basis fallback, or withheld when neither is measured); reliability
≥10 assessed full swings. Deterministic per-shot missing policy from §13.6
decision 3: zero or negative carry is missing, never a distance. Sample
sufficiency is labelled as evidence strength, never as statistical validation.

## 7. What replaces what

Per §13.6 decision 2, the raw-metric within-bag standings (ADR-0004) are
**removed** once these ratings land; the underlying measurements stay.
ADR-0004 is superseded by ADR-0005 on acceptance.

## 8. Illustrative scores — generated by the reproducible fixture

Every table below is computed by
[`docs/adr/adr-0005-illustrative-scores.mjs`](/Users/thomasstrange/Documents/projects/shotwise/docs/adr/adr-0005-illustrative-scores.mjs)
(`node docs/adr/adr-0005-illustrative-scores.mjs`, seeded and deterministic)
using exactly the §4 functions. Synthetic club distributions; references
D 250 m / 7i 150 m / PW 120 m; "lat P80" = P80 |fromCentre| / median carry;
"corridor" = share of shots within the declared corridor half-width.

### 8.1 Beginner, intermediate and highly consistent golfers

| Club | n (visits) | P80 carry | ref | mishit | rel IQR | lat P80 | corridor | distance | consistency | direction | reliability | composite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D | 40 (4) | 210.8 m | 250 m | 15% | 20.7% | 31.9% | 28% | 84.3 | 37.3 | 0.0 | 85.0 | 47.4 |
| 7i | 40 (4) | 117.3 m | 150 m | 13% | 16.4% | 11.5% | 35% | 78.2 | 41.1 | 49.8 | 87.5 | 62.7 |
| PW | 40 (4) | 90.0 m | 120 m | 20% | 21.2% | 16.5% | 60% | 75.0 | 18.0 | 24.8 | 80.0 | 46.9 |

| Club | n (visits) | P80 carry | ref | mishit | rel IQR | lat P80 | corridor | distance | consistency | direction | reliability | composite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D | 48 (4) | 255.3 m | 250 m | 6% | 10.8% | 9.5% | 77% | 100.0 | 76.9 | 91.3 | 93.8 | 90.0 |
| 7i | 48 (4) | 148.7 m | 150 m | 4% | 5.3% | 7.7% | 52% | 99.1 | 94.0 | 79.0 | 95.8 | 91.0 |
| PW | 48 (4) | 120.9 m | 120 m | 6% | 8.6% | 9.9% | 79% | 100.0 | 78.3 | 71.8 | 93.8 | 84.5 |

| Club | n (visits) | P80 carry | ref | mishit | rel IQR | lat P80 | corridor | distance | consistency | direction | reliability | composite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D | 60 (6) | 263.3 m | 250 m | 2% | 4.5% | 7.5% | 83% | 100.0 | 100.0 | 100.0 | 98.3 | 99.6 |
| 7i | 60 (6) | 154.1 m | 150 m | 0% | 4.8% | 4.6% | 87% | 100.0 | 96.0 | 100.0 | 100.0 | 99.0 |
| PW | 60 (6) | 124.3 m | 120 m | 2% | 4.1% | 9.1% | 85% | 100.0 | 99.5 | 77.6 | 98.3 | 92.7 |

Reading: the beginner's driver keeps a meaningful distance score (84.3 at
84% attainment) instead of collapsing to zero, while wild direction (0.0) and
mishits still pull the composite down; the intermediate golfer's balanced
7i scores highest; the highly consistent golfer saturates near 100 without
any category being uninformative. A longer club does not automatically score
higher and a shorter club does not automatically win consistency — the anchors
are role-specific but the scales are common.

### 8.2 Owner's worked example — 7 iron, median 120 m, IQR 10 m (rel IQR 8.33%)

| Methodology | consistency score |
| --- | --- |
| v1 anchors (iron 2.5% / 8%) | 0.0 |
| v2 anchors (irons 4% / 25%) | 79.4 |

### 8.3 How scores change (intermediate 7i baseline unless stated)

| Scenario | distance | consistency | direction | reliability | composite |
| --- | --- | --- | --- | --- | --- |
| Baseline | 99.1 | 94.0 | 79.0 | 95.8 | 91.0 |
| Distance improves (every carry +15 m) | 100.0 | 96.4 | 84.6 | 95.8 | 93.5 |
| Carry variability increases (rel IQR 6.5% → 20%) | 100.0 | 38.5 | 81.2 | 95.8 | 77.9 |
| Frequent mishits (PW mishit share ~7% → 25%) | 99.0 | 30.3 | 17.6 | 75.0 | 51.4 |
| Same PW, mishits excluded from consistency/direction (counterfactual) | 99.0 | 86.8 | 31.4 | 75.0 | 69.7 |
| Directional coverage missing (no fromCentre) | 100.0 | 86.2 | — | 95.8 | 93.6 (prov. 3/4) |
| New club, one session (5i, n = 12, 1 visit, no reference) | — | 86.2 | 46.0 | 91.7 | 72.9 (prov. 3/4) |
| No personal/external benchmark, historical potential 148 m exists | 100.0 | 90.0 | 70.9 | 95.8 | 87.7 |

Notes: with finishing-position data missing, direction is withheld (launch
score 72.3 shown separately on the launch basis) and the composite is a
provisional 3/4 — visibly higher than the full baseline here, which is exactly
why provisional composites are never ranked against full ones. A new club in
a single session gets early-provisional category ratings immediately; without
any reference the distance category is withheld but the other three still
rate. With no personal or external benchmark but prior history, the labelled
historical personal potential (148 m) serves as the fallback reference.

### 8.4 Reliability uncertainty (intermediate PW)

- mishit share 6% of n=48 assessed → reliability 93.8
- Wilson 95% interval (**sampling uncertainty only**): [2%, 17%] → reliability range [83.2, 97.9]
- missingness sensitivity over the **full-swing** population (90% assessed, 10% unassessed): if all unassessed were mishits, full-population share 16% → reliability down to 84.4; if all clean, share 6% → reliability 94.4. Classifier uncertainty is reported via assessed coverage and these bounds, not the Wilson interval.

### 8.5 Consistency anchor sensitivity (score vs relative carry IQR)

| rel IQR | driver v1 (3.5/10%) | driver v2 (5/30%) | iron v1 (2.5/8%) | iron v2 (4/25%) | wedge v1 (3/10%) | wedge v2 (4/25%) |
| --- | --- | --- | --- | --- | --- | --- |
| 2% | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| 5% | 76.9 | 100.0 | 54.5 | 95.2 | 71.4 | 95.2 |
| 8% | 30.8 | 88.0 | 0.0 | 81.0 | 28.6 | 81.0 |
| 11% | 0.0 | 76.0 | 0.0 | 66.7 | 0.0 | 66.7 |
| 14% | 0.0 | 64.0 | 0.0 | 52.4 | 0.0 | 52.4 |
| 17% | 0.0 | 52.0 | 0.0 | 38.1 | 0.0 | 38.1 |
| 20% | 0.0 | 40.0 | 0.0 | 23.8 | 0.0 | 23.8 |
| 23% | 0.0 | 28.0 | 0.0 | 9.5 | 0.0 | 9.5 |
| 26% | 0.0 | 16.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 29% | 0.0 | 4.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 32% | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 35% | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

v1 compresses everything above ~8–11% rel IQR to zero — exactly the
"technically calculable but unhelpfully harsh" failure the owner flagged. v2
spreads the amateur range across the scale; the residual compression above
~26% is intentional (genuinely wild ball flight should score near zero).

### 8.6 Historical personal potential — leave-current-window-out guard

Per-visit P80 (m): 140.1 | 145.3 | 147.7 | 152.3 | 157.9 (current window last).

- naive historical potential (includes current window): 157.9 m → raw ratio 100.0% → distance 100.0 — circular: the evaluated shots set their own reference, so the ratio is 100% by construction
- guarded (excludes the evaluated window): 152.3 m → raw ratio 103.7% → distance 100.0 after the cap — attainment vs previously demonstrated ability

With the 100 cap the score is unchanged when the current window is the best,
but the displayed reference is honest and independent of the evaluated data,
and any uncapped use of the reference (comparison bars, future metrics) is not
self-inflated.

## 9. Open questions for the owner (answered 2026-11-25 — see §10)

## 10. Owner acceptance and clarifications — 2026-11-25

ADR-0005 v2 is **accepted** with the following binding clarifications:

1. §4.2/§4.3 anchors approved as provisional, versioned product constants,
   reevaluated after real golfer data; **no editable per-club tolerances yet**.
2. Direction scores on P80 |lateral| / median carry; corridor success rate and
   median lateral error are complementary measurements only.
3. Provisional composites **renormalize over the available categories**,
   require **at least two** categories, always display category coverage, and
   are never ranked as directly comparable across different category sets.
4. Weights confirmed: distance 20%, consistency 25%, direction 30%,
   reliability 25% (provisional, `ratings-2`).
5. Fixed `premium-flat` rating basis approved, independent of the canonical
   range-preferred classification basis and the display basis. Premium-flat
   measurements are **not** assumed to exist for every shot: missing stays
   missing, with no silent range-ball substitution.

Additional implementation clarifications:

- **Reference types stay distinct:** personal goal attainment vs historical
  personal potential attainment vs external benchmark attainment are labelled
  separately and never presented as directly equivalent. Historical potential
  uses a **robust high percentile of eligible per-session P80 values** (not the
  single highest session) over the trailing 12 months, retaining the
  leave-evaluated-window-out guard (§8.6). Recent window is the primary
  Overview rating; Historical/All-time views must define reference selection,
  including the case where no independent historical reference remains.
- **Launch-direction ratings never enter the main composite**, even when
  separately labelled; they display separately only when finishing-position
  data is unavailable. This policy is stated identically in this ADR,
  `app/src/domain/ratings.ts` and the tests.
- **Evidence levels:** the normalized consistency rating needs a justified
  minimum above the 4-measurement raw-IQR minimum (v2: ≥10, flagged <20). n ≥
  30 across only one or two visits is still useful — evidence level
  "provisional (high sample)"; "better-supported" requires ≥30 across ≥3
  visits. Category-specific minimums and coverage are maintained.
- **Reliability uncertainty:** sampling uncertainty (Wilson), unassessed-shot
  sensitivity, and classifier accuracy stay distinct; the missingness range
  does not cover errors among assessed shots; automated reliability is not
  presented as independently validated until real-world evaluation supports it.
- **UI:** overall rating directly on Overview club rows; tapping a club/rating
  reveals the four category bars with measurements and benchmark context; full
  vs provisional composites visibly but unobtrusively distinguished;
  methodology/uncertainty on demand; no growing text density; the visual
  simplification milestone (D2) lands alongside.
- **Verification:** the ADR formulas and illustrative examples are regression
  fixtures; app implementation and documentation share one calculation source
  (`app/src/domain/ratings.ts`; the docs fixture imports it) rather than two
  implementations. Regression tests cover: missing measurement coverage, no
  reference configured, different reference types, club roles, partial PW
  shots, severe mishits, new club with one session, display-basis changes,
  historical reference stability, category/composite consistency, and removal
  of raw-metric standings. Synthetic verification stays distinct from
  real-world classifier validation.
