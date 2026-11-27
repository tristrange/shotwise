# ADR-0006 (PROPOSED): adaptive automatic personal distance goals, and a consistency-curve calibration study

Status: **proposed 2026-11-27 — awaiting owner approval; no code, formula or
schema changes in this document's PR.** The visual/coverage presentation fixes
from the same review ship separately (PR #108).
Date: 2026-11-27
Related: ADR-0005 §4.5/§8.6 (`ratings-2`, `app/src/domain/ratings.ts`),
ADR-0002 (`strong-strike-1`), `app/src/domain/model.ts`
(`userReferenceValueSchema`), `supabase/migrations/20261129090000_reference_value_rating_metadata.sql`,
`docs/external-benchmark-sources.md`, `docs/ROADMAP.md` §13.6/§13.8

## 1. Context — audit findings from the owner's real data

Two limitations surfaced when the owner inspected ratings computed from their
own Inrange export:

1. **Distance ratings are withheld across the bag.** `resolveRatingReference`
   (ADR-0005 §4.5) needs a basis-compatible personal goal, then the automatic
   historical personal potential (which itself requires ≥2 prior sessions
   *outside* the evaluated window with n ≥ 10 carries each), and only then an
   external benchmark — and all researched external sources are link-only
   today. A golfer who has never typed a goal and whose recent window is their
   whole history therefore gets **no distance category at all**, even with
   hundreds of measured carries. The composite silently drops to 3/4
   categories.
2. **Consistency can read 0 despite large real improvement.** The current
   `consistencyScore` is a linear ramp between provisional role anchors
   (`excellent`/`poor` relative-IQR constants). Below the `poor` anchor the
   score is exactly 0, so a developing golfer who improves from relIQR 0.40
   to 0.32 (both ≥ `poor` = 0.25 for irons) still sees 0 — no feedback signal
   until they cross the anchor.

## 2. Goals and non-goals

**Goal.** Useful distance ratings *automatically*, including for beginner
golfers who do not know what their club-distance goals should be. Manual goal
configuration stays optional and never a prerequisite for any analytics.

**Non-goals / constraints (owner-set).**

- No fabricated default benchmarks, no circular self-comparisons presented as
  independent evaluation, no arbitrary replacement formulas.
- External population benchmarks stay an *optional* comparison feature, never
  a prerequisite for distance ratings; if numerical external references are
  added later they remain a distinct reference type and are never mixed with
  personal goals.
- Reference provenance is always visible: every reference says what it is, the
  statistic it represents, its basis, and when/how it was recorded.
- Real-world classifier uncertainty stays visible (assessed/unassessed counts,
  sensitivity bounds) — automatic goals must not launder unassessed shots into
  "evidence".
- Personal goal attainment is never presented as an objective skill percentile
  or handicap estimate.
- No change to consistency scoring in this ADR; §9 is an investigation request
  requiring separate approval.

## 3. Reference semantics — four concepts stay distinct

| Concept | Storage today | Proposed |
| --- | --- | --- |
| Manual personal goal | `user_reference_values` row, `referenceType='goal'`, `source='manual'\|'fitting'\|'chart'\|'estimated'` | unchanged; always wins over automatic (§7) |
| **Adaptive personal goal (new)** | none | automatic, persisted, versioned record per club+equipment, `referenceType='goal'`, `source='automatic'`, `statistic='p90'` (candidate) |
| Historical demonstrated potential | computed on the fly (`historicalPersonalPotential`, leave-evaluated-window-out) | unchanged; remains the fallback when no goal of any kind exists |
| External population benchmark | link-only (`docs/external-benchmark-sources.md`) | unchanged; optional future comparison, never mixed |

Ratings must keep labelling these distinctly (the existing
`REFERENCE_LABEL`/statistic/recorded-on display does this) and never present
attainment of different reference concepts as equivalent.

## 4. Proposed initial goal-generation formula (candidate, not approved)

All inputs come from the club's **existing distance-rating population**: the
broader full-swing cohort of the evaluated window on the fixed `premium-flat`
rating basis, suspected wrong-club rows excluded, zero/negative carries treated
as missing (never as distance), no range-ball pooling — the same eligibility and
anomaly rules `clubRating` already applies, plus the existing equipment
identity check (`distanceEquipmentId`).

Candidate: **goal₀ = P90 carry of that population** (robust upper-tail
statistic; P80 is already used for the measured potential, so P90 separates
"typical best" from "goal"), rounded to a whole metre.

- P90 is a *candidate* initial goal, not an approved final formula. Alternatives
  to evaluate on real data: P85, or a blend `max(P80, P90 of prior sessions)`;
  single maxima are explicitly rejected (one misread shot would set the goal).
- Initial attainment is **self-referenced**: the goal is derived from the same
  cohort it is first scored against, so early distance scores will cluster high
  by construction. The UI must label this ("initial self-referenced goal")
  and must not present it as independent evaluation (§8, §11).

## 5. Minimum evidence requirements (candidate thresholds)

Aligned with the existing progressive evidence levels (ADR-0005 §6):

| Evidence | Condition | Behaviour |
| --- | --- | --- |
| none | n < 10 measured carries | no goal, distance withheld (current behaviour, with the new reason label) |
| early / cold-start | 10 ≤ n < 20, any visits | **provisional goal** = P90, labelled provisional; distance score computed but flagged |
| established | n ≥ 20 **and** ≥ 2 visits | automatic goal = P90, persisted as a stable record |
| well supported | n ≥ 30 and ≥ 3 visits | goal eligible for upward revision (§6) |

## 6. Goal lifecycle and update rules

Automatic goals are **persisted, stable, evolving targets** — never values
recomputed on every render from the cohort currently being evaluated.

1. **Initial generation** when §5's "established" threshold is first met; a
   provisional goal is generated earlier (§5) and clearly labelled.
2. **Retention**: once persisted, the goal does not change just because new
   sessions arrive.
3. **Upward adjustment** only after *sustained* demonstrated improvement:
   candidate rule — the P90 of the trailing window exceeds the current goal by
   ≥ 2% for ≥ 3 consecutive visits with n ≥ 20 each, and the same single
   current equipment identity holds. The new goal is the trailing-window P90.
4. **No automatic downward adjustment** after isolated poor sessions —
   automatic goals never decrease; a lower goal requires a manual override.
5. **Equipment change**: a goal tagged with `equipmentId` applies only while
   that equipment is the single current assignment of the distance population
   (existing rule). On equipment change the club cold-starts: provisional goal
   from new-equipment shots, then a fresh established goal; history kept.
6. **History and provenance**: every goal record stores formula version,
   input window (session id range / dates), n, visits, equipmentId, generated
   date, and the reason for each change ("initial", "sustained improvement",
   "equipment change"). An append-only goal-history log (or a `supersededBy`
   chain) preserves progress tracking when goals change — attainment is always
   computed against the goal in force, and past attainment remains viewable.

## 7. Manual override precedence and UI

- Resolution order (extends ADR-0005 §4.5): **manual `goal` record > adaptive
  automatic goal > historical potential > (external, link-only)**. A manual
  goal always wins; this matches today's priority, so existing users see no
  change.
- The existing club-profile personal-reference section gains a compact
  automatic/manual control per club: view the current automatic goal (value,
  statistic, basis, generated-on), override with a personal carry goal, and
  return to automatic mode (which re-exposes the persisted automatic goal or
  regenerates one per §5/§6). No separate onboarding or goal-configuration
  workflow.

## 8. Circularity and leakage guards

- The leave-evaluated-window-out guard (ADR-0005 §8.6) stays: historical inputs
  never include the sessions under evaluation.
- A persisted goal is a **snapshot**: once generated it is not re-derived from
  the cohort being rated, so current shots can never set their own reference
  after the initial generation. The initial self-referenced attainment (§4) is
  explicitly distinguished in the UI from subsequent independent evaluation
  against the established goal.
- Future-data leakage: goal generation reads only sessions dated ≤ the
  evaluation "today"; regression tests must prove changing evaluated-window
  shots never changes an already-persisted goal.
- Equipment identity and basis compatibility rules are inherited unchanged; an
  `unknown`-basis or mixed-equipment situation withholds rather than guesses.

## 9. Consistency-curve calibration study (investigation only — separate approval required)

Finding (§1.2): the linear ramp zeroes everything below the `poor` anchor.
Options to evaluate on the owner's real data, **without fabricated benchmarks**
and keeping anchors as labelled provisional product constants:

1. **Softer floor**: any measured consistency gets a non-zero score (e.g. floor
   at 5–10 for relIqr below `poor`, tapering to 0 only at a hard physical
   ceiling) — preserves ordering, gives developing golfers a signal.
2. **Transform before ramp**: apply a concave transform (sqrt/log) to relIqr
   so the slope below `poor` is gentler instead of flat-zero.
3. **Recalibrated role anchors**: derive `excellent`/`poor` per role from real
   distributions (with uncertainty shown), still product constants, versioned
   `ratings-3` with regression fixtures like ADR-0005 §8.
4. **Piecewise curve**: keep 100 at `excellent`, keep the current slope between
   anchors, but continue a shallow slope below `poor` instead of clamping at 0.

Any change is versioned (`ratings-3`), keeps the fixed rating basis, keeps
mishits in the population, and ships with before/after examples on real data.
**No consistency-scoring change is made or approved by this ADR.**

## 10. Implications for distance and composite ratings

- The distance formula `min(100, 100 × P80 ÷ reference)` is **unchanged**; only
  the reference resolution gains the adaptive-goal tier. Composite weights are
  unchanged; composite coverage simply rises from 3/4 to 4/4 for most clubs.
- Because initial goals are self-referenced (§4), early distance scores
  cluster near 100 — the UI must label this and must not let it read as a
  skill measure. Watch-list metric for evaluation: distribution of
  self-referenced attainment should be high-but-varying, not a flat 100.
- Withholding reasons stay accurate: "no compatible distance reference" now
  only appears in cold-start (n < 10), which the UI explains with the exact
  count behind the contextual help.

## 11. Persistence and reference-history requirements (implementation sketch)

- Extend `userReferenceValueSchema`/`valid_reference_value` with
  `source='automatic'` (and keep all legacy defaults valid — same pattern as
  migration 20261129090000: validator-only change, jsonb shape unchanged, old
  rows remain valid; backup/restore round-trip tests required).
- Add an append-only goal-history table (or `goalHistory` array on the record):
  `{ goalValueM, statistic, basis, equipmentId, windowStart, windowEnd, n,
  visits, formulaVersion, reason, createdOn, createdBy: 'automatic' }`.
- `revision` optimistic-concurrency stays; automatic updates bump revision
  like manual saves so cross-device conflicts still surface.
- New migrations must be tested locally (`npm run test:db`) before any hosted
  application, per AGENTS.md.

## 12. Worked examples

**Beginner** (new golfer, 3 visits, 34 full-swing 7i shots on the rating
basis, single current equipment): n=34 ≥ 20, visits=3 → established
automatic goal = P90, say 128 m (statistic `p90`, formula version recorded).
Distance score = min(100, 100 × P80 118 ÷ 128) = 92, labelled "initial
self-referenced goal". Next month: 4 more visits, trailing P90 = 134 ≥ 128 ×
1.02 for 3 consecutive visits → goal raised to 134 with a history entry;
progress view shows "goal 128 → 134 on <date>" and attainment against the goal
in force. One poor session (P90 121) → **no change** (no downward adjustment).

**Intermediate** (has a fitting-session goal of 150 m for 7i): manual goal
wins; the automatic goal (say 146 m) is still computed and inspectable in the
profile ("automatic: 146 m · return to automatic" control), but the rating
uses 150 m. Distance score = min(100, 100 × P80 ÷ 150).

**Experienced** (200+ shots over a year, stable): automatic goal established
long ago at P90 = 165 m; sustained improvement lifts trailing P90 to 172 over
4 visits → goal raised to 172, history entry added; the rating for the
evaluated window still uses the **persisted** goal, not the window's own P90
(no circularity). Equipment change (new 7i): goal tagged to the old shaft
stops applying (equipment mismatch → withheld/cold-start), a provisional goal
forms from new-equipment shots, then a fresh established goal; all history
retained and labelled.

## 13. Regression and real-world evaluation tests (proposed)

Unit/regression (vitest, alongside `ratings.test.ts`):

- Goal generation boundaries: n = 9/10/19/20/29/30 × visits = 1/2/3.
- Wrong-club exclusion, zero/negative carry as missing, no range/premium
  pooling, basis compatibility, equipment identity (single-current-assignment
  rule), `unknown` basis never applies.
- Leakage: leave-evaluated-window-out; mutating evaluated-window shots never
  changes a persisted goal; goal regeneration is idempotent (same inputs →
  same goal).
- Update rules: upward only on sustained improvement (≥2% for ≥3 visits,
  n ≥ 20); isolated poor session → unchanged; manual override precedence at
  every tier.
- Persistence: schema/migration round-trip on legacy rows, backup/restore
  integrity, revision conflicts (`test:db`).

Real-world evaluation protocol (owner's Inrange export, read-only):

- Coverage uplift: clubs with a distance category before vs after (expect near
  4/4 once n ≥ 10, vs today's bag-wide withholding).
- Self-referenced attainment distribution: should cluster high but vary; any
  flat-100 pattern indicates a formula bug.
- Consistency floor behaviour under each §9 option (before/after scores on the
  same data; improvement ordering preserved; no fabricated anchors).
- Classifier uncertainty: unassessed-share sensitivity of automatic goals.

## 14. Open questions for the owner

1. Approve P90 as the initial-goal statistic, or prefer P85 / a blend?
2. Approve the §5 evidence thresholds and the §6 upward-revision rule (≥2% for
   ≥3 visits at n ≥ 20)?
3. Should self-referenced initial attainment be *displayed* as a distance
   score at all, or only as a labelled provisional indicator until the goal is
   established independently?
4. Which §9 consistency-curve option (or combination) to prototype first?
5. Confirm the manual-override UI shape (§7) fits the existing club-profile
   reference section without a separate workflow.
