# ADR-0005 (PROPOSAL — not yet accepted): normalized club ratings on a common 0–100 scale

Status: **proposed — blocked on owner review** (roadmap §13.6 approval scope)
Date: 2026-11-25
Related: reopens ADR-0004; `docs/ROADMAP.md` §13.5 item C3, §13.6 decisions 1/2/5/6; `app/src/domain/scores.ts` (`category-scores-1`), `app/src/domain/benchmarks.ts` (personal references)

This document is the review artifact the owner asked for before C3 is
implemented: the proposed normalization functions, tolerance anchors,
missing-data policy and illustrative scores. Nothing here is implemented yet.

## 1. What the ratings represent

A **designed performance index**, not a scientifically validated golf skill
rating and not a handicap equivalent. It answers: which clubs do I perform
well with, which should I practise, which aspect needs work, and am I
underperforming relative to reasonable expectations. No population
percentiles or handicap equivalents are invented anywhere.

## 2. Inputs (all on the canonical assessment basis, roadmap §13.6 decision 3)

Per club, from the resolved full-swing population (suspected wrong-club rows
excluded; mishits included in consistency/reliability, excluded from
strong-strike potential):

- **Distance potential** — strong-strike carry P80 (ADR-0002, mode-invariant).
- **Consistency** — carry IQR **relative to median carry** (IQR/median), so
  long and short clubs are comparable.
- **Directional control** — median |lateral finishing error| relative to
  median carry (corridor measure). Launch-direction error is reported
  **separately** when finishing-position data is unavailable and is never
  silently substituted. Curvature alone is never treated as landing
  dispersion.
- **Reliability** — 1 − mishit share over assessed full swings (manual or
  automatic contact), with a Wilson 95% interval shown as uncertainty.

## 3. Normalization to 0–100 (higher = better), versioned constants `ratings-1`

Linear ramps between a "good" and a "poor" anchor, clamped to [0, 100]:
`score = 100 × clamp01((poor − x) / (poor − good))`.

| Category | x | Anchors by club role (good, poor) |
| --- | --- | --- |
| Distance potential | P80 ÷ reference, **capped at 1.0** | attainment: 1.00 → 100, 0.80 → 0 (excess distance never compensates poor control; the measured P80 is still displayed) |
| Consistency | IQR/median | driver/wood (0.035, 0.10), iron (0.025, 0.08), wedge (0.03, 0.10) |
| Directional control | median \|fromCentre\| ÷ median carry | driver/wood (0.04, 0.12), iron (0.03, 0.10), wedge (0.04, 0.12) |
| Reliability | mishit share | 0.00 → 100, 0.25 → 0 (anchors fixed, not club-specific) |

**Reference for distance potential**, in priority order (each clearly
labelled in the UI, never mixed): (1) a basis-compatible personal reference
value — compatibility is checked against the **canonical assessment basis the
P80 is scored on** (range-preferred per shot), never against the display
selection, so switching the display basis cannot silently change the rating;
`unknown` is never silently compared (C1/C2 gating); (2) automatically
derived historical personal potential = the best per-visit P80 (n ≥ 10) in
the trailing 12 months — this measures attainment of previously demonstrated
ability, not a comparison with other golfers; (3) no reference → category
withheld.

Correlated-metric check: distance potential uses the strong-strike subset
while consistency/reliability use the full population, so a single mishit
cannot double-count against the same club; directional control is
orthogonal. Weights are applied only across these four distinct dimensions.

## 4. Composite

`composite = 0.20·distance + 0.25·consistency + 0.30·direction + 0.25·reliability`

Weights are the owner-approved provisional constants, versioned separately
from classification (`ratings-1` vs `intent-contact-3` / `sequence-2`), and
adjustable after seeing real results. Displayed on Overview beside each
club's main statistics; tapping reveals the four category bars; methodology
behind a disclosure.

## 5. Evidence levels and missing-data policy (progressive, §13.6 decision 5)

No hard 3-visit gate. Per category, by eligible n: **<10** no numerical rating
(raw measurements only); **10–19** early provisional (flagged); **20–29**
provisional; **≥30 across ≥3 visits** better-supported. Category minimums:
distance needs ≥10 strong-strike shots; consistency ≥4 measured (flagged
<20 for IQR stability); direction ≥10 with `fromCentre` measured (else
withheld, launch-direction shown separately); reliability ≥10 assessed full
swings. Deterministic per-shot missing policy from §13.6 decision 3: zero or
negative carry is missing, never a distance.

**Missing categories are withheld, and a composite is shown only when all
four categories are present.** A provisional composite with a materially
different category set is flagged with its coverage/weighting and is never
ranked against full composites. Sample sufficiency is labelled as evidence
strength, never as statistical validation.

## 6. Illustrative scores (synthetic fixtures, formulas from §3–§4)

48 full swings per club over 4 visits, premium basis, personal references
D 250 m / 7i 150 m / PW 120 m; PW includes partials and a mishit every 7th
shot:

| Club | P80 | cv (IQR/med) | rel. lateral | mishit share | distance | consistency | direction | reliability | composite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D  | 253.0 | 0.065 | 0.073 | 0.00 | 100 | 53 | 58 | 100 | **75.8** |
| 7i | 151.0 | 0.041 | 0.041 | 0.00 | 100 | 72 | 85 | 100 | **88.4** |
| PW | 122.0 | 0.070 | 0.044 | 0.08 | 100 | 43 | 95 | 68 | **76.2** |

(PW reliability uses the declared ramp: 100 × (0.25 − 0.08) / 0.25 = 68, so
composite = 0.20·100 + 0.25·43 + 0.30·95 + 0.25·68 ≈ 76.2.)

Reading: the driver's distance does not rescue its direction/consistency
(75.8 < 88.4), the balanced iron scores highest, and the wedge's partials and
mishits cost consistency and reliability. A longer club does not
automatically score higher and a shorter club does not automatically win
consistency — the anchors are role-specific but the scales are common.

## 7. What replaces what

Per §13.6 decision 2, the raw-metric within-bag standings (ADR-0004) are
**removed** once these ratings land; the underlying measurements stay. ADR-0004
is superseded by ADR-0005 on acceptance.

## 8. Open questions for the owner

1. Are the §3 tolerance anchors sensible for your game, or should they be
   per-club editable goals later?
2. Should historical personal potential (reference concept 3) be shown as
   its own reference row, or only used silently when no personal reference
   exists?
3. Confirm the 20/25/30/25 weights as the provisional v1.
