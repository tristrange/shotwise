# ADR-0006 (PROPOSED v2): adaptive automatic personal distance goals, and a consistency-curve calibration study

Status: **proposed v2, 2026-11-27 — owner methodology feedback of 2026-11-27
incorporated (§2); still awaiting FINAL owner approval. No code, formula or
schema changes ship with this document's PR.** PRs #108 (semantic rating
colours) and #109 (v1 of this ADR) are merged.
Date: 2026-11-27 (v1 proposed → merged in #109 → owner feedback → this v2)
Related: ADR-0005 §4.5/§6/§8.6 (`ratings-2`, `app/src/domain/ratings.ts`),
ADR-0002 (`strong-strike-1`), `app/src/domain/model.ts`
(`userReferenceValueSchema`), `supabase/migrations/20261126090000_user_reference_values.sql`,
`supabase/migrations/20261129090000_reference_value_rating_metadata.sql`,
`docs/external-benchmark-sources.md`, `docs/ROADMAP.md` §13.6/§13.8,
reproducible fixture `docs/adr/adr-0006-worked-examples.mjs` (generates every
table in §10 and §12; run from `app/`: `npx tsx ../docs/adr/adr-0006-worked-examples.mjs`)

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
   (`excellent`/`poor` relative-IQR constants). At or beyond the `poor` anchor
   the score is exactly 0, so a developing golfer who improves from relIQR 0.40
   to 0.32 (both ≥ `poor` = 0.25 for irons) still sees 0 — no feedback signal
   until they cross the anchor.

## 2. Owner decisions — methodology feedback of 2026-11-27 (binding for this v2)

Answers to the five open questions of v1 §14:

1. **P90 approved** as the initial automatic goal statistic, computed on the
   existing eligible distance population (§4).
2. **Minimum of 10 eligible measurements for a provisional automatic goal
   approved**, with the progressive evidence thresholds of §5. The v1
   upward-adjustment proposal (20 eligible shots in each of 3 consecutive
   visits) is **replaced** by the revised rule in §6.3.
3. The initial self-referenced attainment **is displayed as a numerical
   distance score immediately**, with provisional evidence treatment; the
   provenance (statistic, basis, calibration window, self-referenced flag) is
   available through the methodology help (§4, §9).
4. **Smooth nonlinear consistency curves prototyped and compared before
   selecting a formula**: four candidates are evaluated against the current
   ramp on the required grid in §10; **C1 (log-anchored ramp) is the
   recommended candidate**, pending final approval (§14).
5. The **automatic/custom goal control lives in the existing club-profile
   reference interface**; **automatic is the default**, manual configuration
   optional (§8).

Lifecycle clarifications (all incorporated):

- Clubs with **20 or more eligible shots from only one visit still receive a
  provisional goal** (§5).
- Automatic goals **work without equipment registration or manual assignment,
  when there is no evidence of conflicting equipment** (§5.3).
- Explicitly known **mixed-equipment populations remain distinguishable** —
  they withhold with a distinct reason, never guess (§5.3).
- The initial goal is **persisted, not recomputed on render** (§6.1).
- **Upgrading evidence strength never silently resets the original goal**
  (§6.2).
- The goal is **preserved through isolated poor sessions** — no automatic
  downward adjustment (§6.4).
- **Manual override always takes precedence** (§8).
- **Returning to automatic mode restores the appropriate automatic goal and
  preserves its history** (§8, §11).

These thresholds are **candidate product thresholds, not validated statistical
constants**.

## 3. Goals and non-goals

**Goal.** Useful distance ratings *automatically*, including for beginner
golfers who do not know what their club-distance goals should be. Manual goal
configuration stays optional and never a prerequisite for any analytics.

**Non-goals / constraints (owner-set).**

- No fabricated default benchmarks, no circular self-comparisons presented as
  independent evaluation (§9), no arbitrary replacement formulas.
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
- No UI redesign in this ADR; the control is confined to the existing
  club-profile reference section (§8). Consistency-formula changes require the
  final approval requested in §14.

## 4. Reference semantics and the initial goal formula (approved statistic)

Four concepts stay distinct:

| Concept | Storage today | In this v2 |
| --- | --- | --- |
| Manual personal goal | `user_reference_values` row, `referenceType='goal'`, `source='manual'\|'fitting'\|'chart'\|'estimated'` | unchanged; always wins over automatic (§8) |
| **Adaptive personal goal (new)** | none | automatic, **persisted**, versioned record per club+metric+equipment-key, `referenceType='goal'`, `source='automatic'`, `statistic='p90'` (§6, §11) |
| Historical demonstrated potential | computed on the fly (`historicalPersonalPotential`, leave-evaluated-window-out) | unchanged; fallback when no goal of any kind exists |
| External population benchmark | link-only (`docs/external-benchmark-sources.md`) | unchanged; optional future comparison, never mixed |

**Initial goal (approved):** all inputs come from the club's **existing
distance-rating population**: the broader full-swing cohort on the fixed
`premium-flat` rating basis, suspected wrong-club rows excluded, zero/negative
carries treated as missing (never as distance), no range-ball pooling — the
same eligibility and anomaly rules `clubRating` already applies, plus the
equipment identity check (§5.3).

```
goal₀ = round( P90 carry of that population )        (whole metres)
```

P90 (robust upper-tail statistic) separates "typical best" from the P80 used
for measured potential; single maxima remain rejected (one misread shot would
set the goal, ADR-0002 rationale).

**Initial attainment (approved display):** the first distance score against
`goal₀` is shown immediately as the ordinary numerical
`distanceScore = min(100, 100 × P80 ÷ goal₀)`, flagged **provisional** with
its evidence level, and the reference row carries the provenance label
"automatic goal · P90 · premium-flat · generated on <date> from <window> ·
initial self-referenced". The methodology help explains that the goal was
derived from the same cohort it is first scored against, so early scores
cluster high by construction and are not an independent evaluation (§9).

## 5. Minimum evidence requirements (approved thresholds)

Aligned with the existing progressive evidence levels (ADR-0005 §6,
`evidenceLevel`):

| Evidence | Condition | Behaviour |
| --- | --- | --- |
| none | n < 10 eligible carries | no goal; distance withheld (existing behaviour, with the reason label) |
| early / cold-start | 10 ≤ n < 20, any visits | **provisional goal** = P90, persisted immediately, labelled provisional |
| provisional (incl. single-visit) | n ≥ 20, **any number of visits — including one** | provisional goal = P90, persisted; a single visit with 20+ eligible shots still gets a provisional goal (owner clarification) |
| established | n ≥ 20 **and** ≥ 2 visits | same persisted value; the **label** upgrades to established — the value is never reset (§6.2) |
| supported | n ≥ 30 and ≥ 3 visits | label "supported"; goal eligible for upward revision (§6.3) |

### 5.3 Equipment identity (clarified)

The club's distance population has one of three equipment states, computed
exactly as `distanceEquipmentId` does today over the shots that contribute to
the distance rating:

- **`single:<equipmentId>`** — every contributing shot has a current assignment
  to one physical club → the automatic goal is tagged with that equipment and
  applies only while the state stays `single:<same>`.
- **`none`** — no current assignments exist on the population (no equipment
  registered, or nothing assigned) → **no evidence of conflict**: the
  automatic goal is generated and applied **untagged**, labelled "equipment
  unverified". Automatic goals work without any equipment registration.
- **`mixed`** — more than one physical club currently assigned → explicit
  conflict: the automatic goal is **withheld with the distinct reason
  "mixed-equipment population"** (never guessed, never silently applied), and
  mixed populations stay visible as such in the UI.

## 6. Goal lifecycle and update rules

Automatic goals are **persisted, stable, evolving targets** — never values
recomputed on every render from the cohort currently being evaluated.

### 6.1 Initial generation, persistence and the provisional phase

When §5's minimum (n ≥ 10 eligible carries, any visits) is first met, a
provisional goal is generated and **persisted** (active record + append-only
history entry, §11). **Renders only read the persisted record — the goal is
never recomputed on render.** While the goal is still provisional (below the
established threshold), its value is re-derived **only at import/evaluation
boundaries**, deterministically over the full non-archived history in tuple
order (sessions with tuple ≤ the evaluation today) — never from the evaluated
window alone — and every distinct value is appended to the history with reason
`initial`. Repeated imports/refreshes of an unchanged dataset recompute the
same value and write nothing (idempotent, §11). Once n ≥ 20 **and** ≥ 2 visits
at a boundary, the current value **freezes as the established goal** (§6.2).

### 6.2 Establishment freezes the value; later evidence upgrades never reset it

Crossing the established threshold (n ≥ 20 and ≥ 2 visits) freezes the current
persisted value as the established goal: the evidence upgrade changes only the
**label/evidence level**, never the value. After establishment, only the §6.3
upward rule can change the goal, always via a new logged history entry —
upgrading evidence strength (more shots, more visits, "supported" level) never
silently resets the original goal.

### 6.3 Upward adjustment — REVISED rule (replaces the v1 "20 shots × 3 consecutive visits" proposal)

The v1 rule was judged too restrictive for ordinary range practice. The
approved candidate, made precise:

- **Origin.** Let T₀ be the establishment tuple `(date, time ?? '00:00', id)`
  of the last session in the current persisted goal's calibration window.
- **Qualifying visits Q.** All non-archived sessions with tuple **strictly
  greater than T₀**, each contributing n_v ≥ 10 eligible carries on the rating
  basis, with equipment state consistent with the goal record (§5.3; `mixed`
  sessions never qualify). Per-visit aggregate **u_v = P80(carries of visit v)**.
- **Trigger.** `|Q| ≥ 3` distinct visits **and** `Σ n_v ≥ 30` carries across Q
  **and** sustained improvement:
  `median(u_v over Q) ≥ g + max(3 m, 3% of g)`.
- **Effect.** New goal `g' = round(median(u_v))` (whole metres), recorded as a
  new history entry (reason `sustained-improvement`, with the session ids,
  per-visit u_v, n_v, the threshold used and the formula version). The new
  establishment tuple T₁ = max tuple over Q, so the increased goal becomes
  **effective for subsequent sessions** (tuple > T₁) and the triggering
  sessions are evaluated against the **previous** goal.

**Why the median of per-visit P80s (the robust aggregation):** a pooled P80
across Q would let one large visit dominate; a max would let one misread set
the goal (rejected, ADR-0002); a rolling window re-evaluated repeatedly could
accumulate triggers from the same shots. The median over ≥3 qualifying visits
requires **at least half of the visits to individually reach the threshold** —
one unusually strong session cannot raise the goal (worked example B, §12),
and because the origin T₀ is fixed at establishment (not a sliding window),
the same visits can never trigger twice (example F, §12). Per-visit P80 with
n_v ≥ 10 reuses the governed strong-strike minimum sample.

**Why max(3 m, 3%):** the absolute floor keeps short clubs meaningful (3% of an
80 m wedge goal is only 2.4 m), the relative term scales the demand with
distance (a 150 m goal needs 4.5 m). Both are candidate product thresholds,
not validated constants; worked values in §12.

### 6.4 No downward adjustment

Automatic goals never decrease. An isolated poor session leaves the goal
untouched (example E, §12); a lower goal requires a manual override (§8).

### 6.5 Equipment change

A goal tagged with `equipmentId` applies only while the population state is
`single:<same>`. On equipment change the club cold-starts: provisional goal
from the new equipment's shots (§5), then a fresh established goal; all
history is retained. A `mixed` state withholds with the distinct reason (§5.3).

### 6.6 History and provenance

Every goal record stores formula version, calibration window (session ids /
dates), n, visits, equipment key, generated date, establishment tuple, and the
reason for each change (`initial`, `sustained-improvement`, `equipment-change`).
Attainment is always computed against the goal in force; past attainment
remains viewable through the append-only history (§11).

## 7. View, import and session semantics (explicit definitions)

- **Recent vs All-time views.** There is exactly **one persisted automatic
  goal per club+metric+equipment-key**, independent of the view. Recent
  (60-day) and All-time rate their evaluated window against the *same*
  persisted goal; the views differ only in the evaluated window, exactly as
  they do for the historical-potential fallback. Upward-adjustment evaluation
  (§6.3) always uses the **all-time non-archived history**, not the 60-day
  display window, so infrequent practice still accrues qualifying visits. If
  the evaluated Recent window still contains the goal's calibration sessions,
  the UI flags the attainment as **partially self-referenced**; see §9 — a
  persisted goal is never claimed to provide independent evaluation of a
  rolling cohort that still contains its calibration shots.
- **Out-of-order imports.** Sessions are ordered by the tuple
  `(date, time ?? '00:00', id)`, never by import order. Import idempotency
  (file/content hash, existing `imports` table) prevents duplicate sessions.
  Goal re-derivation runs only at import/evaluation boundaries over the full
  tuple-ordered dataset, so **the same final dataset yields the same active
  goal regardless of import order** (worked example §12.4). Intermediate
  provisional values produced while the dataset was still partial are all
  recorded in the append-only history — nothing is silently reset. A
  late-imported older session sorts into history by its tuple; recorded
  history entries are never edited or deleted.
- **Same-day sessions.** Distinct visits; ordered by `time` (missing time =
  `00:00`), then `id`. The establishment-tuple comparison handles them: a
  later same-day session qualifies, an earlier/equal one does not (worked
  example, §12).
- **Archived sessions.** Excluded from calibration and from trigger
  evaluation; history entries that reference them are retained unchanged.
  Un-archiving a session makes it eligible again for future trigger
  evaluation (if tuple > T₀) and for replay.
- **Manual corrections** (club/intent/contact/exclusion) change the eligible
  populations going forward; they never edit recorded history entries, and
  corrections to evaluated-window shots never change an already-established
  goal (§9 leakage guard).
- **Goal-history replay.** Replay = recomputing the decision sequence from the
  current dataset in tuple order at an evaluation boundary. The active goal is
  the last replayed decision; the append-only history records every value that
  was in force, with its calibration inputs and reason. Replay must reproduce
  the latest recorded entry from the current dataset (regression-tested, §13).
  If manual corrections or late imports make an older entry non-reproducible,
  that is expected provenance: old entries stand, and any newly computed value
  is **appended** as a new entry. History entries are immutable (§11).

## 8. Manual override precedence and UI (approved)

- Resolution order (extends ADR-0005 §4.5): **manual `goal` record
  (`source` ≠ `automatic`) > adaptive automatic goal > historical potential >
  (external, link-only)**. A manual goal always wins, so existing users see
  no change.
- The existing club-profile personal-reference section gains a compact
  automatic/custom control per club: **automatic is the default**; the current
  automatic goal (value, statistic, basis, equipment state, generated-on,
  history) is inspectable; a manual override is optional; **returning to
  automatic mode restores the persisted automatic goal and preserves its
  history** (the automatic record is never deleted or overwritten by a manual
  one — §11 source-class slots). No separate onboarding or goal-configuration
  workflow, and no UI redesign beyond this control.

## 9. Circularity and leakage guards

- The leave-evaluated-window-out guard (ADR-0005 §8.6) stays for the
  historical-potential fallback.
- A persisted goal is a **snapshot**: once generated it is not re-derived from
  the cohort being rated, so current shots can never set their own reference
  after the initial generation. The initial self-referenced attainment (§4)
  is explicitly labelled and never presented as independent evaluation.
  **A persisted goal does not provide independent evaluation of a rolling
  cohort that still contains its calibration shots** — while the evaluated
  window overlaps the calibration window, attainment is flagged partially
  self-referenced (§7); once the window rolls past, the fixed persisted goal
  is independent of the evaluated cohort.
- Future-data leakage: goal generation and trigger evaluation read only
  sessions with tuple ≤ the evaluation "today"; regression tests must prove
  that mutating evaluated-window shots never changes an already-persisted
  goal.
- Equipment identity and basis compatibility rules are inherited unchanged;
  `unknown`-basis references are never silently compared, and a `mixed`
  equipment population withholds rather than guesses (§5.3).

## 10. Consistency-curve calibration study (candidates compared; recommendation pending final approval)

Finding (§1.2): the linear ramp zeroes everything at/beyond the `poor` anchor.
The owner asked for smooth nonlinear alternatives that remain responsive
beyond the current poor anchor, compared on a fixed grid before selecting a
formula. Preferred properties: bounded [0,100]; monotonically decreasing in
relIQR; meaningful differentiation at high variability; demanding enough to
distinguish genuinely consistent performance; no artificial flat floors; the
existing eligible full-swing population (mishits included) is unchanged; only
clearly documented provisional parameters (the existing role anchors plus one
declared ceiling), never fabricated population benchmarks.

**Candidates** (x = relIQR, e = `excellent` anchor, p = `poor` anchor, C = 1.0
declared hard ceiling — provisional product constant, not a benchmark):

- **current (ratings-2):** `100·clamp01((p−x)/(p−e))` — 0 for x ≥ p.
- **C1 log-anchored ramp (recommended):** `100·clamp01((ln C − ln x)/(ln C − ln e))`.
- **C2 exponential:** `100·clamp01(exp(−k(x−e)))`, k = ln4/(p−e) so the poor
  anchor still scores 25.
- **C3 reciprocal:** `100·clamp01(e/x)`.
- **C4 piecewise soft floor:** current slope between anchors with poor mapped
  to floor 25, then a shallow linear tail to 0 at C.

All tables below are generated by
[`docs/adr/adr-0006-worked-examples.mjs`](/Users/thomasstrange/Documents/projects/shotwise/docs/adr/adr-0006-worked-examples.mjs)
(current scores imported from `app/src/domain/ratings.ts`; candidates defined
in the fixture only, since they are not approved):

### 10.1 Comparison grid — score vs relative carry IQR

| Role | rel IQR | current (ratings-2) | C1 log-ramp | C2 exponential | C3 reciprocal | C4 piecewise |
| --- | --- | --- | --- | --- | --- | --- |
| driver-wood | 4% | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| driver-wood | 5% | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| driver-wood | 10% | 80.0 | 76.9 | 75.8 | 50.0 | 85.0 |
| driver-wood | 15% | 60.0 | 63.3 | 57.4 | 33.3 | 70.0 |
| driver-wood | 20% | 40.0 | 53.7 | 43.5 | 25.0 | 55.0 |
| driver-wood | 25% | 20.0 | 46.3 | 33.0 | 20.0 | 40.0 |
| driver-wood | 30% | 0.0 | 40.2 | 25.0 | 16.7 | 25.0 |
| driver-wood | 40% | 0.0 | 30.6 | 14.4 | 12.5 | 21.4 |
| driver-wood | 50% | 0.0 | 23.1 | 8.2 | 10.0 | 17.9 |
| driver-wood | 75% | 0.0 | 9.6 | 2.1 | 6.7 | 8.9 |
| driver-wood | 100% | 0.0 | 0.0 | 0.5 | 5.0 | 0.0 |
| hybrid-iron | 4% | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| hybrid-iron | 5% | 95.2 | 93.1 | 93.6 | 80.0 | 96.4 |
| hybrid-iron | 10% | 71.4 | 71.5 | 67.3 | 40.0 | 78.6 |
| hybrid-iron | 15% | 47.6 | 58.9 | 48.4 | 26.7 | 60.7 |
| hybrid-iron | 20% | 23.8 | 50.0 | 34.8 | 20.0 | 42.9 |
| hybrid-iron | 25% | 0.0 | 43.1 | 25.0 | 16.0 | 25.0 |
| hybrid-iron | 30% | 0.0 | 37.4 | 18.0 | 13.3 | 23.3 |
| hybrid-iron | 40% | 0.0 | 28.5 | 9.3 | 10.0 | 20.0 |
| hybrid-iron | 50% | 0.0 | 21.5 | 4.8 | 8.0 | 16.7 |
| hybrid-iron | 75% | 0.0 | 8.9 | 0.9 | 5.3 | 8.3 |
| hybrid-iron | 100% | 0.0 | 0.0 | 0.2 | 4.0 | 0.0 |
| wedge | 4% | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| wedge | 5% | 95.2 | 93.1 | 93.6 | 80.0 | 96.4 |
| wedge | 10% | 71.4 | 71.5 | 67.3 | 40.0 | 78.6 |
| wedge | 15% | 47.6 | 58.9 | 48.4 | 26.7 | 60.7 |
| wedge | 20% | 23.8 | 50.0 | 34.8 | 20.0 | 42.9 |
| wedge | 25% | 0.0 | 43.1 | 25.0 | 16.0 | 25.0 |
| wedge | 30% | 0.0 | 37.4 | 18.0 | 13.3 | 23.3 |
| wedge | 40% | 0.0 | 28.5 | 9.3 | 10.0 | 20.0 |
| wedge | 50% | 0.0 | 21.5 | 4.8 | 8.0 | 16.7 |
| wedge | 75% | 0.0 | 8.9 | 0.9 | 5.3 | 8.3 |
| wedge | 100% | 0.0 | 0.0 | 0.2 | 4.0 | 0.0 |

### 10.2 Beginner / intermediate / experienced examples (7i)

| Golfer | 7i rel IQR | current | C1 log-ramp | C2 exponential | C3 reciprocal | C4 piecewise |
| --- | --- | --- | --- | --- | --- | --- |
| Beginner | 18% | 33.3 | 53.3 | 39.7 | 22.2 | 50.0 |
| Intermediate | 8% | 81.0 | 78.5 | 76.8 | 50.0 | 85.7 |
| Experienced | 5% | 97.6 | 96.3 | 96.8 | 88.9 | 98.2 |

### 10.3 Recommendation — C1 log-anchored ramp (pending final approval)

C1 is recommended because it meets every preferred property at once:

- bounded [0,100], strictly decreasing between the anchors, smooth (no kink,
  unlike C4);
- 100 exactly at the `excellent` anchor, 0 **only at the declared ceiling C** —
  no artificial flat floor anywhere below it;
- differentiates across the whole grid, including high variability (irons:
  25%→43.1, 30%→37.4, 50%→21.5, 75%→8.9, 100%→0.0) where the current curve
  is a flat 0 beyond 25%;
- demanding at the consistent end (4%→100 vs 5%→93.1 vs 10%→71.5 for irons);
- ratio-fair: because it is linear in ln x, equal *ratios* of relIQR produce
  equal score steps (4%→5% and 40%→50% both drop ≈7 points for irons), which
  matches the meaning of a relative-spread metric.

C2 compresses the high-variability end (75%→0.9, 100%→0.2 — little
differentiation exactly where the owner wants responsiveness); C3 is steepest
at the good end but flattens the mid/high range (10%→40, 50%→8); C4 keeps a
kink at the poor anchor. Anchor semantics change under C1: `poor` no longer
maps to 0 but becomes a labelled mid-scale reference (irons: 43.1). All
parameters remain **provisional product constants**; the population
(full-swing, mishits included, positive carries only) is unchanged.

If approved, C1 ships as versioned `ratings-3` with regression fixtures
exactly like ADR-0005 §8 (the fixture switches from defining C1 locally to
importing it from `app/src/domain/ratings.ts`, so docs and app cannot drift).
**No consistency-scoring change is made or approved by this document alone —
see §14.**

### 10.4 Directional-control floor — evaluated, NOT changed

The directional-control curve has the **same floor problem**: `directionScore`
zero-clamps at/beyond its `poor` anchor (hybrid-iron: rel lat P80 ≥ 18% → 0.0,
whereas C1-for-reference would give 57.2 at 18% and 46.3 at 25%):

| rel lat P80 | current direction | C1 log-ramp (for reference) |
| --- | --- | --- |
| 5% | 100.0 | 100.0 |
| 8% | 76.9 | 84.3 |
| 10% | 61.5 | 76.9 |
| 15% | 23.1 | 63.3 |
| 18% | 0.0 | 57.2 |
| 25% | 0.0 | 46.3 |
| 40% | 0.0 | 30.6 |
| 60% | 0.0 | 17.1 |
| 100% | 0.0 | 0.0 |

The same candidate family would apply, but per the owner's instruction the
directional-control curve is **not changed without separate approval**.

## 11. Persistence and security design (implementation sketch — no changes yet)

Automatic goals, manual overrides and immutable goal history must coexist
without the current reference-record uniqueness constraints overwriting each
other:

- **Source enum:** extend `referenceSourceSchema` / `valid_reference_value`
  with `source='automatic'` — validator-only change in the same pattern as
  migration 20261129090000: jsonb shape unchanged, legacy rows remain valid,
  backup/restore round-trip tests required.
- **Source-class uniqueness:** replace the unique index
  `user_reference_values_owner_metric_club (owner_id, metric, lower(trim(club)))`
  with a source-class composite
  `(owner_id, metric, lower(trim(club)), source_class)` where `source_class` =
  `'automatic'` when `source='automatic'`, else `'manual'` (legacy rows land in
  the `manual` slot via `coalesce`). One **manual** slot and one
  **automatic** slot per club+metric: an automatic write can never overwrite a
  manual goal and vice versa. Returning to automatic mode = removing/ignoring
  the manual slot; the automatic record and its history were never touched.
- **Append-only goal history:** new table `public.user_reference_goal_history
  (id uuid, owner_id uuid, data jsonb, primary key(owner_id,id))`, insert-only
  (select granted to `authenticated` via an owner-read RLS policy; no
  update/delete granted to anyone — restore inserts as SECURITY DEFINER inside
  the single restore transaction). Entry shape (validated like
  `valid_reference_value`):
  `{ id, club, metric, valueM, statistic, basis, equipmentId, evidence,
  status, calibration: {sessionIds, windowStart, windowEnd, n, visits},
  establishment: {date, time, afterSessionId}, perVisitAggregates?,
  thresholdM?, reason: 'initial'|'sustained-improvement'|'equipment-change',
  formulaVersion, createdOn }`. A natural-key unique index
  `(owner_id, metric, lower(trim(club)), equipment, establishment, formulaVersion)`
  makes history inserts `ON CONFLICT DO NOTHING` — **idempotent under repeated
  imports, refreshes and multiple devices**.
- **Active goal record** keeps the existing `revision` optimistic-concurrency
  check. Automatic recomputation runs **only at import/evaluation boundaries**
  over the full dataset in tuple order; an unchanged dataset recomputes the
  same value and writes nothing, and the history natural-key
  `ON CONFLICT DO NOTHING` guard makes duplicate entries no-ops — **idempotent
  under repeated imports, refreshes and multiple devices**. A changed value is
  written in one SECURITY DEFINER transaction using the existing
  `private.lock_owner()` pattern, which validates, upserts the active record
  (`revision` bumped only on change) and appends the history entry atomically
  (transactionality). Cross-device conflicts still surface as
  `Reference value conflict`; the automatic path is deterministic in the
  dataset, so a re-read + retry converges to the same state.
- **Owner isolation** is unchanged: `owner_id` on every table, RLS owner
  policies, `revoke` from `public`/`anon`, grants to `authenticated` only.
- **Backup/restore compatibility:** `dataset_page` gains
  `'userReferenceGoalHistory'`; `restore_backup` accepts the key optionally
  (legacy backups without it still restore), validates every entry, enforces
  the same distinct-id and distinct-natural-key checks as
  `userReferenceValues`, and inserts everything in the existing single
  "Restore requires empty dataset" transaction.
- New migrations must be tested locally (`npm run test:db`) before any hosted
  application, per AGENTS.md.

## 12. Worked examples (generated by the reproducible fixture)

All tables generated by
[`docs/adr/adr-0006-worked-examples.mjs`](/Users/thomasstrange/Documents/projects/shotwise/docs/adr/adr-0006-worked-examples.mjs)
(seeded, deterministic; each visit contains exactly n carries, constructed so
the visit's sample P80 — computed with the app's real `quantile` — lands on
the stated value).

### 12.1 Cold start — minimum evidence and the establishment freeze

| Scenario | n | visits | result |
| --- | --- | --- | --- |
| One visit, n = 9 | 9 | 1 | no goal — distance withheld (n < 10) |
| One visit, n = 24 | 24 | 1 | provisional goal 131 m (P90 of 24 carries) — provisional even at n ≥ 20 single-visit, per owner clarification; logged and re-derivable while provisional |
| Two visits | 36 | 2 | provisional re-derived to 132 m over the full history (logged); n ≥ 20 and ≥ 2 visits → ESTABLISHMENT freezes 132 m — the evidence upgrade changes only the label, never the frozen value |

Initial self-referenced attainment: window P80 129.7 m vs established goal
132 m → distance score 98.2 (self-referenced while the evaluated window
overlaps the calibration window — labelled, never presented as independent
evaluation).

### 12.2 Upward adjustment — goal g = 130 m established at 2026-10-03T00:00#S2 (revised rule)

Threshold = max(3 m, 3% of g) = 3.9 m → trigger needs median per-visit P80 ≥
133.9 m across ≥ 3 qualifying visits (n ≥ 10 each) with ≥ 30 carries total.

| Example | post-establishment visits: per-visit P80 (n) | qualifying visits (n ≥ 10) | carries in Q | median u over Q | decision |
| --- | --- | --- | --- | --- | --- |
| A: sustained improvement (4th visit n=9 excluded from Q) | 134.2 (n=12), 135.8 (n=11), 133.9 (n=10), 136.5 (n=9) | 3 | 33 | 134.2 | TRIGGER → new goal 134 m, effective after 2026-11-07T00:00#V3 |
| B: one unusually strong session (max 138) | 131.0 (n=12), 130.5 (n=12), 138.0 (n=12) | 3 | 36 | 131.0 | NO trigger — median below 133.9 m; a single strong visit cannot raise the goal |
| C1: strong P80s but n < 10 in two visits | 136.0 (n=8), 137.0 (n=9), 138.0 (n=10) | 1 | 10 | 138.0 | NO trigger — only 1 qualifying visit (< 3) |
| C2: 30 carries but only 2 visits | 136.0 (n=15), 137.0 (n=15) | 2 | 30 | 136.5 | NO trigger — 2 distinct visits < 3 |
| E: isolated poor session | 118.0 (n=14) | 1 | 14 | 118.0 | NO change — goals never decrease automatically; the poor session is preserved, not hidden |
| F: re-evaluating the same visits after the goal became 134 m | 134.2 (n=12), 135.8 (n=11), 133.9 (n=10), 136.5 (n=9) | 0 | 0 | — | NO trigger — visits ≤ establishment tuple T1 are calibration history, not a re-evaluated rolling window |

Threshold is the greater of 3 m and 3% of the goal:

| Goal | 3% of goal | threshold used |
| --- | --- | --- |
| 80 m | 2.4 m | 3.0 m |
| 130 m | 3.9 m | 3.9 m |
| 150 m | 4.5 m | 4.5 m |

### 12.3 View, import-order, same-day and archived semantics

Sessions are ordered by the tuple (date, time ?? 00:00, id) — never by import
order. Goal replay processes sessions in tuple order, so a late out-of-order
import converges to the same decision sequence.

| Session | date | time | imported | archived | n | role in lifecycle |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | 2026-09-05 | 10:00 | first | false | 24 | calibration window of the initial provisional goal (T0 = 2026-09-05T10:00#S1) |
| S2 | 2026-09-05 | 18:30 | first | false | 12 | same day, later time → tuple > T0 → qualifying visit for upward evaluation |
| S3 | 2026-09-20 | 09:00 | LATE (imported 2026-11-20) | false | 11 | out-of-order import sorts by tuple → qualifying visit, not a rewrite of history |
| S4 | 2026-10-02 | 08:00 | first | true | 30 | archived → excluded from calibration and trigger evaluation; un-archiving makes it eligible again |
| S5 | 2026-10-17 | 07:45 | first | false | 12 | qualifying visit |

- **Recent vs All-time:** one persisted goal per club+equipment; both views
  rate their window against it. Upward evaluation always uses the all-time
  non-archived history. If the evaluated Recent (60-day) window still contains
  calibration sessions, the UI flags the attainment as partially
  self-referenced; it is never claimed to be an independent evaluation of a
  rolling cohort that still contains its calibration shots.
- **Manual corrections** change future eligible populations and replay, never
  recorded history entries; **manual override** occupies its own source-class
  slot and always wins; returning to automatic restores the persisted
  automatic goal and its full history.

### 12.4 Import-order independence — same final dataset, different import order

S1 (2026-09-01, 10 carries) and S2 (2026-09-20, 10 carries) imported in both
orders. While provisional, the goal is re-derived at each import boundary over
the full tuple-ordered history and every distinct value is logged; the value
freezes at establishment (n ≥ 20 and ≥ 2 visits).

| Import order | after 1st import | after 2nd import | established (frozen) goal |
| --- | --- | --- | --- |
| S2 then S1 | n=10, visits=1, goal 132 m — provisional, logged | n=20, visits=2, goal 130 m — establishment reached, value frozen | 130 m — identical for both import orders |
| S1 then S2 | n=10, visits=1, goal 102 m — provisional, logged | n=20, visits=2, goal 130 m — establishment reached, value frozen | 130 m — identical for both import orders |

The intermediate provisional values differ by import order and are both
recorded in the append-only history (nothing is silently reset); the
established goal is a deterministic function of the final dataset alone.

### 12.5 Longer-horizon examples

**Intermediate golfer with a fitting goal (7i = 150 m):** the manual record
wins (§8); the automatic goal (say 146 m) remains computed, persisted and
inspectable in the club profile ("automatic: 146 m · return to automatic"),
but the rating uses 150 m. Distance score = min(100, 100 × P80 ÷ 150).

**Experienced golfer (goal established at P90 = 165 m a year ago):** four
post-establishment visits with per-visit P80 169, 171, 170, 172 (n = 14, 12,
11, 13) → |Q| = 4 ≥ 3, Σn = 50 ≥ 30, median 170.5 ≥ 165 + max(3, 4.95) = 169.95
→ goal raised to round(170.5) = 171 m, effective for subsequent sessions; the
evaluated window's rating still uses the **persisted** goal in force, never
the window's own P90 (no circularity). One later poor session (P80 158) → no
change. Equipment change (new 7i): the tagged goal stops applying
(`single:<new>` ≠ goal tag), a provisional goal cold-starts on the new
equipment's shots, then a fresh established goal; all history retained and
labelled.

## 13. Regression and real-world evaluation tests (proposed)

Unit/regression (vitest, alongside `ratings.test.ts`; worked examples §12 as
fixtures via the shared calculation source):

- Goal generation boundaries: n = 9/10/19/20/29/30 × visits = 1/2/3, including
  the single-visit n ≥ 20 provisional case.
- Equipment states: `single` tags and applies; `none` generates untagged and
  applies; `mixed` withholds with the distinct reason.
- Wrong-club exclusion, zero/negative carry as missing, no range/premium
  pooling, basis compatibility, `unknown` basis never applies.
- Leakage/idempotency: mutating evaluated-window shots never changes an
  established goal; same dataset → same value at every boundary (nothing
  written); goal-history replay (tuple order, incl. out-of-order imports,
  same-day sessions, archived sessions, manual corrections) reproduces the
  latest recorded entry from the final dataset, with the §12.4 import-order
  example as a fixture.
- Upward rule: examples A–F of §12.2 as fixtures (trigger, single-strong-visit
  rejection, insufficient visits/carries, no-downward, no-retrigger); threshold
  = max(3 m, 3%) at goals 80/130/150 m.
- Manual override precedence at every tier; return-to-automatic restores the
  persisted goal and history.
- Consistency candidates (if approved as `ratings-3`): the §10.1 grid as a
  regression fixture imported from the app module; ordering preserved;
  bounded [0,100]; mishits stay in the population.
- Persistence (`npm run test:db`): source-enum validator round-trip on legacy
  rows; source-class uniqueness (automatic and manual coexist, neither
  overwrites the other); history natural-key idempotency (duplicate insert →
  no-op); revision conflicts across devices; backup/restore round-trip
  including `userReferenceGoalHistory` and legacy backups without it.

Real-world evaluation protocol (owner's Inrange export, read-only):

- Coverage uplift: clubs with a distance category before vs after (expect near
  4/4 once n ≥ 10, vs today's bag-wide withholding).
- Self-referenced attainment distribution: should cluster high but vary; any
  flat-100 pattern indicates a formula bug. Partially-self-referenced flag
  shown while the Recent window overlaps the calibration window.
- Consistency floor behaviour under each §10 candidate (before/after scores on
  the same data; improvement ordering preserved; no fabricated anchors).
- Classifier uncertainty: unassessed-share sensitivity of automatic goals.

## 14. Approval request

This v2 records the owner's 2026-11-27 methodology decisions and the precise
candidate formulas, lifecycle rules and worked examples above. **Final owner
approval is requested before any rating formula change (the `ratings-3`
consistency curve of §10.3, and any directional-control change, which needs
separate approval per §10.4) or any database functionality change (the
`source='automatic'` enum extension, source-class uniqueness, and the
goal-history table of §11).** No UI redesign is undertaken or proposed beyond
the approved automatic/custom control in the existing club-profile reference
interface (§8).
