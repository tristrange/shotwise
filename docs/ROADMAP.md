# Shotwise roadmap

## Session and practice intelligence

Shotwise should help the golfer understand current performance, see what has changed, and choose a focus for the next practice session. Keep historical data available and use recent, comparable evidence for current assessments. Show the measurements and sample sizes behind each finding.

## Starting point

- Sessions handles CSV previews, same-day imports, editable session metadata, and a log. The import response already returns the saved session ID. Progress reports carry and spread per club and session. The unused `mostImprovedClub` helper accepts three current shots and can compare them against stale or ambiguously ordered same-day history. The recap needs its own comparison rules. [Sessions](../app/src/components/Sessions.tsx) · [Progress](../app/src/domain/progress.ts)
- Shared analytics provides quantiles, metric summaries, and a Recent cohort. Overview, Gapping, Progress, and Shot Shape share the basis and optional unusual-shot filter. Gapping also drops known partials and mishits. Recent caps shots per club before applying review filters and can include part of a session. Whole-session comparisons need separate selection with visible cohort counts. [Shared analytics](../app/src/domain/analytics.ts)
- Gapping already surfaces median gaps, wide carry spread, and one-sided curve. Its rules can fire on evidence from a single visit. The next version adds recurrence, prioritisation, a practice task, and access to the supporting shots. [Gapping](../app/src/components/ClubGaps.tsx)
- Shot review already explains flags, displays raw cells, supports batch changes and undo, and selects source-row ranges within a session. The missing-club suggestions compare carry with candidate clubs and require confirmation. The bulk form currently stores selected IDs and reads the latest revisions at save time. A safer workflow needs a preview with pinned revisions. [Shot review](../app/src/components/ShotReview.tsx)
- The shot model stores target distance and proximity where available, and keeps intent, contact, club decisions, and exclusion independent. Dedicated wedge analysis and editable club profiles are future work. A synthetic targeted 30 m sand-wedge shot reproduced an unusual-shot flag because the rule includes uncertain wedge intent. [Shot model](../app/src/domain/model.ts)

React uses a versioned Supabase snapshot and pure TypeScript analytics. Reuse the existing domain functions and repository. Keep calculations out of presentation, preserve original CSV bytes and shot order, and use effective club labels for analysis. Derived analytics can ship using the existing tables and backup format. Preserve owner isolation, transactional writes, revision conflicts, and backup integrity. [Database guarantees](database.md)

## Product order and design

1. **Session recap.** Highest immediate value and the clearest portfolio demonstration of trustworthy comparisons. Use the existing Session Details view. Offer **View recap** beside each successful import, including a link to the saved session for duplicates, and make historical recaps accessible from the log. The golfer chooses when to open a recap.
2. **Practice insights.** Surface two or three focused actions on Overview once the recap can link to evidence. Reuse the existing Gapping rules and views. Start with a small rule set that can be maintained and explained.
3. **Wedge distance control.** High value for practice, with its scope governed by target coverage and what the CSV target represents. Bring the uncertain-intent wedge safeguard into the recap foundation.
4. **Review workflow.** Bring shot evidence links forward with the recap. Follow with focused review navigation and a separate improvement to bulk correction, where safeguards matter because the workflow changes saved decisions.
5. **Club profiles.** Derive the first profiles from trusted recent benchmarks and existing Progress data. Consider saved bag and equipment metadata once the profile proves useful.

The recap starts with date, venue if known, recorded and included shot counts, and clubs used. Show up to three noteworthy findings, with room for positive changes and areas to investigate. Club details explain the basis, measurements, sample sizes, baseline dates, and which shots contributed. Link to the supporting shots. Keep metadata and review below the recap. On Overview, place the latest recap and next practice action near the top. Keep the existing typography, colours, chart styling, and navigation. Keep primary actions visible during entry animations, provide text alternatives for charts, and make the measurement basis easy to select on a phone.

## Comparison rules

### Baseline selection

Use the three most recent comparable sessions per effective club and metric, within a 60-day window ending on the selected session date. The immediately previous session can be shown as labelled context when the baseline is thin. A rolling shot window stays useful for browsing recent performance, where its shot cap may split a visit. Longer history remains available in Progress. These choices keep early beginner sessions from dominating current comparisons.

- Exclude the selected session, later sessions, archived sessions, and manually excluded shots. A same-day candidate qualifies only when both session times are known and its time is strictly earlier. If the cutoff splits a group whose order is unresolved, keep that group together and show the actual number of sessions.
- Compute medians and carry IQR within each qualifying session. Use the median of those session summaries as the baseline so a long visit has the same weight as a short visit. Show the actual dates, measured counts, and missing counts per metric.
- Use the same selected measurement basis on both sides. The recap inherits the player’s basis and names it beside the comparison. Missing measurements stay missing. Direction metrics stay as recorded. Confirm the physical carry reference separately for wedge target error. [Measurement basis](../app/src/domain/model.ts)

### Potential, reliability, and evidence

- **Potential.** Use explicitly full shots with reviewed typical contact when there is enough evidence. Also show a clearly labelled broader estimate that includes unreviewed non-wedge shots and excludes known partials and manually marked mishits. Full-swing wedge comparisons require explicit full intent. Where unknown intent is included, show its coverage and offer a reviewed-only view when there is enough evidence for it.
- **Reliability.** Include known mishits and automatically flagged shots in the eligible population. Show the width of the middle half of carries and the lower carry tail when there are at least 20 measured shots. Report confirmed mishits over contact-reviewed full swings and show what share of full swings was reviewed. An empty reviewed denominator means the rate is unavailable.
- **Carry highlights.** Start with at least 10 measured current shots and 20 prior measurements across at least two dates, with at least five measurements in each qualifying prior session. Require the difference to reach both 5 m and 5% of the baseline, and the current median to fall outside the prior session medians’ range.
- **Spread highlights.** Start with at least 12 current and 24 prior measurements, retaining the same five-per-session and two-date guards. Require a change of at least 3 m and 20% of the baseline IQR, with the current IQR outside the range of prior IQRs. A tighter middle and worse lower tail are mixed evidence.
- **Flight details.** Show median ball speed, launch angle, and apex, and separate left, straight, and right shares for start direction, curve, and lateral offset. Use per-metric denominators. Keep these changes descriptive unless there is a practice goal against which to judge them.
- **When to withhold a finding.** Show observed values and sample sizes even if the comparison is unavailable. Withhold strong copy for sparse history, unresolved chronology, or substantial differences in recorded setup, shot mix, or measurement availability. The thresholds are provisional product rules. Use evidence counts and dates in the interface instead of confidence percentages.

### Review flags and practice rules

The unusual-shot rule uses short range-flat carry and low range ball speed. The club-label rule looks for unusually long and fast explicitly full shots. Both provide reasons to review. Keep flag status out of the recap’s core calculations, distinguish it from the golfer’s contact decisions, and preserve manual overrides. A missed tablet switch can be easier for the golfer to spot in context. The existing evaluation establishes coverage and threshold sensitivity. Require independent intent and contact labels before using export trials to judge classifier accuracy or adding new signals such as apex or launch. [Unusual-shot rule](../app/src/domain/unusualShots.ts) · [Existing evaluation](assisted-iron-review.md)

Promote practice patterns that recur on at least two dates. Start with recurring carry inconsistency, one-sided curve, and repeatedly small or reversed median gaps on comparable dates for both clubs. Carry-band overlap describes the data on its own. Rank by recurrence, coverage, size of the effect, and recency. Reduce priority when repeated newer evidence shows improvement. Each result identifies the club, measurements, evidence strength, and one concrete practice task. For example, alternate the 5i and 6i at the same aim line to see if a recurring small gap holds under comparable conditions. Derive insights on demand from the loaded snapshot and memoize if profiling demonstrates a need. Draw conclusions about observed ball flight and distance.

## Reviewable milestones

### 1. Comparison foundation

- Add pure recap calculations in `app/src/domain/`. Reuse quantiles, effective club labels, the basis mapping, and manual review state. Give recap comparisons an explicit earlier-session rule. In `unusualShots.ts`, require explicit full intent for wedge shots to be assessed or used as evidence.
- **Database** — no migration.
- **Acceptance** — deterministic unit tests cover small samples, missing measurements, no matching history, unordered input, same-day time ties, later-session invariance, manual club correction, exclusions, archived sessions, deliberate partials, extreme mishits, rapid improvement, and every basis. A 30 m targeted wedge remains available for practice analysis.

### 2. Session recap and post-import links

- Extend `Sessions.tsx` and hash navigation in `App.tsx`. Use saved session IDs and share one recap view between imports and the logbook. Add the summary, carry and spread findings, collapsed metric details, and links to matching shot evidence. Distinguish an empty dataset, sparse baseline, and no noteworthy changes.
- **Database** — no migration. Use existing import and refresh calls.
- **Acceptance** — desktop Chromium and phone-sized WebKit tests cover new, multiple, duplicate, and historical imports, same-day session identity, refresh and Back, and a recap recalculating after a review edit. Verify basis selection, meaningful focus when opening details or evidence, readable sample counts, and responsive layout without horizontal page overflow.

### 3. Next-practice recommendations

- Extend the Gapping rules in `analytics.ts` to return structured evidence and supporting shot IDs. Reuse the recap’s cohort logic where it matches the rule. Surface the capped, ranked recommendations on Overview and link to the existing detail views.
- **Database** — no migration. Compute from the current snapshot.
- **Acceptance** — unit tests verify recurrence, one-off suppression, comparable-date gapping, stable ranking, reduced priority for an improving pattern, and no promoted recommendation from overlap alone. Browser tests verify the cap of three distinct actions and that evidence links open the relevant shots.

### 4. Wedge target practice

- Inspect aggregate target coverage and confirm the units and carry reference in representative Inrange exports. Use exact recorded targets first. Show counts and typical carry, carry spread, optional launch, speed and apex, and recorded directional evidence where the aim line is known. If the carry reference is verified, add signed carry error, median absolute error, and short/long counts. If it remains unclear, show target and carry side by side. Use existing full, partial, and unknown intent tags for untargeted shots. Add a target-versus-carry chart only if it answers a question the summaries leave open.
- **Database** — no migration. Any later manual target entry should have separate provenance from the recorded CSV.
- **Acceptance** — synthetic fixtures cover missing and zero targets, sparse target groups, corrected wedge labels, known partials, and mixed intent. Inspect exact measured shot groups in a browser. A targeted 30 m sand wedge is outside full-swing benchmarks unless explicitly marked full. Show coverage before adding target-specific practice recommendations.

### 5a. Focused review

- Extend `ShotReview.tsx` with next/previous navigation, neighbouring source rows, and filters for open flags, manually reviewed shots, and all shots. Reuse current explanations, save, and undo. Keep contact and club-label decisions separate.
- **Database** — no migration.
- **Acceptance** — browser tests cover reviewing consecutive flags, staying in context as a flag clears, session boundaries, keyboard navigation, and visible busy and failure states.

### 5b. Safer consecutive correction

- Preview the exact session, source rows, old effective labels, proposed label, and any skipped decisions. Skip confirmed or corrected club choices by default. Apply only the club change after explicit confirmation. Pin the previewed shot IDs and revisions and use the atomic batch repository call. Offer immediate undo for that batch with the expected post-save revisions.
- **Database** — no migration for immediate undo. Durable batch history and undo across intervening edits would require a separate persistence design.
- **Acceptance** — verify that a ten-row correction preserves original labels, measurements, and unrelated review fields. A stale row rejects the batch atomically. Exact-batch undo restores the earlier decisions or surfaces a newer edit.

### 6. Derived club profiles

- Build read-only profiles from the recap, Progress, and Gapping calculations. Show recent typical carry and spread, sample sizes, and historical trends. Qualify any personal best by session and coverage. Defer loft, equipment model, current bag, and notes to a separate persistence decision.
- **Database** — no migration for derived profiles. Saved metadata would require owner-scoped storage and versioned backup and restore.
- **Acceptance** — profile statistics agree with the recap given the same inputs, and historical performance remains accessible. A later persistence PR must verify owner isolation and backward-compatible restore.

## Verification

Run the project checks appropriate to each PR. Analytics work needs deterministic unit tests, typecheck, lint, and the GitHub Pages build. Run focused browser tests on desktop Chromium and phone-sized WebKit for changed user flows, including touch targets, narrow layout, keyboard navigation, loading, and error recovery. Run local database tests for changes to persistence. Use synthetic fixtures in Git and report only aggregate results from private exports.

The review baseline passed 83 unit tests, typecheck, lint, a GitHub Pages build, and six focused browser cases. The build produced a 629 kB JavaScript entry bundle, about 180 kB gzip. Treat this as a baseline. If first load feels slow on a phone or the recap materially increases startup work, profile JavaScript and the initial data fetch before changing the loading strategy.
