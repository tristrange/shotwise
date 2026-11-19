# Shotwise roadmap

## Comparisons, equipment, and ball-flight analysis

The previous phase delivered session recaps, practice recommendations, wedge distance control, focused shot review, safer bulk corrections, and derived Club Profiles. The next phase builds on those features in this order.

1. Compare two practice sessions in **Sessions & import**.
2. Manage the bag in **Clubs** and record equipment use in **Session Details**.
3. Explore measured relationships alongside **Shot shape**.

Keep the existing top-level navigation. Compute comparisons and explorer results from the loaded snapshot with pure domain functions. Equipment adds persistent records for physical clubs and their assignments. Original imports, recorded club labels, source row order, and measurements remain immutable.

## Session comparisons

Add **Compare sessions** to the logbook and **Compare with another session** to Session Details. Identify each visit by UUID and show its date, time when known, venue, and filename in the selector. Save the pair in the hash so reload and Back preserve the selection. Label the reference and comparison explicitly, and offer a swap action.

Start with a compact list of all common effective club labels and expand one club at a time. Show which clubs appear on only one side and give the user a way to change either selection when nothing overlaps. Stack controls and metric details on narrow screens.

- Use the complete eligible population of each selected visit. Apply the same intent and basis to both sides, honour club corrections and exclusions, and keep the pair independent of Recent. Same-day sessions can be compared by ID even when their order is unclear.
- Show recorded and included counts, observed median carry, and carry interquartile range (IQR). Keep manually reviewed mishits in the observed distribution. Show typical carry separately. Use reviewed full swings with typical contact when each side has at least 10 measured carries in that cohort. Otherwise use the same labelled broader recap cohort for both sides, where available. The full-swing benchmark is unavailable in a partial-only view.
- Show median ball speed, launch angle, and apex. Report left, straight, and right shares for recorded start direction, curve, and lateral offset. Give each metric its own measured count. Use the confirmed mishit count over reviewed full swings and show the share of full swings reviewed. Show counts when review coverage is thin. Keep automatic unusual-shot flags separate from contact review.
- Report signed changes in native units as comparison minus reference. Show percentage change for carry and speed when the reference is positive and coverage supports it. Use percentage points for direction shares. Mark sparse samples and show missing counts on the selected basis. Leave IQR unavailable below four measured shots. Identify differences in venue, shot mix, and measurement coverage. Treat observed changes as descriptive. The recap's historical finding rules depend on multiple prior visits.
- Reuse shot grouping, recap cohorts, metric and direction summaries, review coverage, and the existing basis definitions. Consider a shared-axis carry plot after reviewing the compact detail view. [Session recap](../app/src/domain/recap.ts) · [Shared analytics](../app/src/domain/analytics.ts) · [Session views](../app/src/components/Sessions.tsx)

## Personal bag and equipment

Add **Manage bag** to Clubs. Give each physical club a stable ID, an Inrange label, a display name or model, optional manufacturer and loft, and an in-bag or retired status. Allow optional dates when known. Two clubs may share a label and overlap in ownership. Show current equipment and assignment history beside the existing profile, performance, and gapping.

Use **Assign equipment** in Session Details to preview the exact shots for a club label. One confirmation can apply to the group. For a mid-session swap, select a source-row range and preview that subset. Store the confirmed shot IDs with the physical club ID. Show known, mixed, and unknown coverage in the history. Club Profiles and Compare still summarize by effective club label and show physical-club context where available.

- Old visits and backdated imports start with unknown equipment. Replacement, retirement, and date edits preserve prior assignments. Dates can help suggest a club in a later version. Confirm the proposed shots before saving any assignment.
- When a later club correction conflicts with an assignment, show **Needs review** and retain the previous assignment for repair. Undoing the correction can restore compatibility. A shot corrected into another group needs its own confirmation to adopt that group's equipment. Keep assignment changes separate from contact, intent, exclusion, and club review.
- Add owner-scoped equipment and shot assignment tables with owner-qualified foreign keys. Reuse select-only row-level security, authenticated RPCs, per-owner locking, and one dataset version bump per write. Use revision checks for metadata and reject stale assignment previews atomically. Keep retired equipment available for historical references.
- Page equipment within the version-checked snapshot. Restore v1 backups with empty equipment collections and use v2 for complete equipment backups. Include equipment in the empty-account check. Preserve IDs, CSV provenance checks, and assignments awaiting review in the same transaction. Stage the reviewed hosted migration before the Pages client requires it. Refresh open legacy tabs before taking an equipment-inclusive backup. [Club profiles](../app/src/domain/clubProfiles.ts) · [Database guarantees](database.md) · [Snapshot loader](../app/src/data/snapshot.ts) · [Backup parser](../app/src/domain/backup.ts)

## Ball-flight explorer

Add **Shape** and **Explorer** views to the existing Shot shape destination. Keep existing Shape links valid. Open Explorer with one effective club and ball speed versus carry. Offer carry, total distance, ball speed, launch angle, and apex for both axes. Keep the same axes when changing clubs so the user can inspect another club in the same way.

Reuse the shared cohort and measurement basis. Offer Recent, All-time, or one named session, with an intent filter and All contact or Reviewed typical. A named session uses its complete eligible population. Build the plot in a pure domain function and emit a point only when both selected measurements exist. Preserve zero values and report plotted shots, omitted shots, and missing counts by axis.

Use the shot UUID for selection. Show the session, source shot number or row, measured values, and a link to review. Follow Shape's plot, selected-shot detail, and table patterns. Provide tap selection and a keyboard-operable table that gives access to every shot, including points that overlap. Name units and the selected basis on the chart.

Start with descriptive exploration. Defer correlation, trend lines, and automatic interpretation. If correlation is added later, use paired values for one club and a clear intent cohort, check the sample size and variation, and show which sessions contributed. Use per-session spread in Progress for a later view of launch consistency over time. [Shot Shape](../app/src/components/ShotShapes.tsx) · [Measurement bases](../app/src/domain/model.ts)

## Reviewable pull requests

| PR | Acceptance |
| --- | --- |
| 1. Compare two sessions | Open Compare from the logbook and a visit. Verify same-day IDs, reload, Back, and phone layout. Cover one-sided and no-common-club cases, corrected labels, exclusions, full and partial intent, missing or sparse data, all bases, and independence from Recent. |
| 2. Add comparison details | Verify the shared typical-carry cohort, flight and directional measurements, reviewed mishit coverage, and neutral deltas. Exercise sparse review, zero references, and basis changes. |
| 3. Add equipment persistence | Verify owner isolation, foreign keys, stale writes and atomic rollback, snapshot paging, v1 and v2 restore, and original CSV provenance against local Supabase. |
| 4. Manage the bag in Clubs | Register, edit, and retire a club. Allow the same label on two clubs and overlapping ownership. Preserve a draft after a conflict and verify reload and backup round-trips. |
| 5. Assign equipment in Sessions | Confirm, revise, or clear a group or range. Cover replacement, historical imports, unknown and mixed use, and corrections and undo. Verify equipment context in Clubs and Compare. |
| 6. Explore ball-flight measurements | Verify axis mapping, missing X and Y, sparse data, corrected clubs, exclusions, intent and contact filters, basis changes, and exact shot mapping. Cover touch, keyboard, overlapping points, and review links. |

## Decisions to confirm

| Decision | Recommended default |
| --- | --- |
| Default comparison scope | Show all common clubs and all included shots, with intent filters and typical carry separate. A focused club default saves a step for users who usually compare the same club. |
| Archived visits | Start with unarchived visits to match Recap and Progress. Add an explicit archive selector if archived visits need to be comparable. |
| Equipment confirmation | Confirm a group once per session and use a row range for a swap. Revisit suggestions if repeated assignments take too much time. |
| Explorer time scope | Offer Recent, All-time, or one session. Bring forward a custom date range if comparing groups of visits around a lesson or equipment change is a priority. |

Defer a dedicated equipment comparison and additional equipment fields such as shaft details and notes until their use is clear.

## Verification

Use deterministic synthetic fixtures. For application PRs, run the unit suite, typecheck, lint, and the Pages build from `app/`. Run local database tests for persistence changes and Chromium and phone-sized WebKit tests for changed flows. Check keyboard focus, readable counts, and narrow layouts. [Repository verification](../AGENTS.md#verification)
