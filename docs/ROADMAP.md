# Shotwise — Development Roadmap vNext
## Mobile Experience, Automatic Shot Intelligence & Performance Benchmarking

**Project:** Shotwise  
**Repository:** https://github.com/tristrange/shotwise  
**Live application:** https://tristrange.github.io/shotwise/#overview

## 1. Project direction

Shotwise is a golf performance analytics application built around shot-level data exported from Inrange Golf.

The application already supports session imports, historical tracking, shot review, club profiles, equipment management, gapping, session comparisons, shot-shape analysis, ball-flight exploration, wedge analysis and practice recommendations.

The next development phase should focus on three overarching goals:

1. **Improve the mobile experience.** Make Shotwise feel like a polished, installable iPhone app with intuitive navigation, responsive layouts and more visual presentation.
2. **Make analytics more automatic and useful.** Reduce manual shot review, distinguish typical performance from potential, and provide more accessible club-level information.
3. **Introduce meaningful performance benchmarks.** Compare golfers against relevant amateur and professional reference data, eventually supporting explainable club-performance scores.

The application should remain statistically trustworthy, accessible and understandable to relatively new golfers.

### Guiding principles

- Prioritize features that improve the actual user experience.
- Prefer visual communication over long explanatory paragraphs.
- Use progressive disclosure: show important information first, details on demand.
- Reduce mandatory manual work wherever possible.
- Preserve original Inrange measurements and club labels.
- Keep automatic classifications distinct from user-confirmed facts.
- Never silently reassign a club based on an inferred classification.
- Respect statistical uncertainty and insufficient sample sizes.
- Reuse existing domain logic, analytics and components.
- Avoid introducing unnecessary infrastructure, languages or dependencies.
- Keep features independently testable and suitable for small pull requests.

---

# 2. Mobile experience and PWA support

## 2.1 Installable Progressive Web App

### Goal

Allow users to add Shotwise to their phone's Home Screen and use it with an experience resembling a native application.

The existing GitHub Pages and Supabase architecture should remain in place.

### Requirements

- Add a valid web app manifest.
- Support standalone display mode.
- Provide appropriate app icons, including an Apple touch icon.
- Configure application name, short name and theme colours.
- Support iOS status-bar and safe-area behaviour.
- Ensure the GitHub Pages `/shotwise/` deployment path works correctly.
- Provide an appropriate launch experience.
- Investigate optional service-worker caching for static assets.
- Handle missing network connectivity gracefully.

### Important limitations

Installability and offline operation are separate features.

Shotwise currently depends on Supabase authentication and persisted data. Full offline access to private shot history is not a requirement for this phase.

Avoid caching sensitive data unnecessarily or introducing stale-data problems.

Assess whether a service worker is needed immediately or whether basic installability should ship first.

### Acceptance criteria

- Shotwise can be added to the iPhone Home Screen.
- Launching from the Home Screen opens the application in standalone mode on supported iOS versions.
- Icons, titles, theme and safe areas render correctly.
- Existing authentication works.
- Existing GitHub Pages deployment continues working.
- The app communicates network errors clearly.

## 2.2 Fix mobile hero sizing

### Current problem

On an iPhone, the Overview hero does not fit correctly at the default zoom level.

The user currently needs to pinch out to make the full hero visible. After doing so, the rest of the application appears to fit.

### Requirements

Investigate and fix the root cause.

Potential issues to inspect:

- Horizontal overflow.
- Hero child widths.
- SVG dimensions and scaling.
- Negative margins.
- Typography and text wrapping.
- Minimum heights.
- Grid or flex item minimum widths.
- Responsive breakpoints.
- Animated elements.

Do not fix the issue by artificially reducing the viewport scale or disabling user zoom.

The hero should fit naturally at the phone's default viewport.

Also evaluate whether the mobile hero should be shorter than the desktop version. It should remain visually impressive without forcing the user to scroll excessively before reaching the statistics.

### Acceptance criteria

- No pinch-zoom adjustment is necessary.
- No unintended horizontal page overflow.
- The animated graphic remains correctly clipped and responsive.
- Text stays readable.
- The hero works across common iPhone viewport sizes.
- Reduced-motion preferences are respected.

## 2.3 Five-tab bottom navigation

### Current problem

The mobile application has too many top-level navigation destinations.

Navigation currently scrolls horizontally at the top of the screen.

This is less convenient than a typical mobile app navigation pattern.

### Proposed navigation

Replace the current mobile navigation with five primary destinations:

| Tab | Main content |
|---|---|
| Home | Overview, key club information, practice insights |
| Analyse | Clubs, Gapping, Progress, Shot Shape, Ball-Flight Explorer |
| Sessions | Import, session history, recaps, comparisons |
| Review | Optional shot review and corrections |
| More | Equipment management, settings, backups |

These names and groupings are initial proposals.

Evaluate whether Review deserves a permanent primary tab now that the product is moving toward automatic classification. It may ultimately belong under More, leaving room for a more frequently used destination.

### Requirements

- Fixed bottom navigation on mobile.
- Maximum five primary tabs.
- Clear active state.
- Icons and concise labels.
- Comfortable touch targets.
- Correct iPhone safe-area spacing.
- No sideways-scrolling primary navigation.
- Existing routes and deep links remain functional.
- Nested analysis screens remain discoverable.
- Do not lose access to any existing features.

Desktop can retain a sidebar, ideally with consistent information architecture.

### Acceptance criteria

- Five or fewer primary mobile tabs.
- All existing features remain reachable.
- No content is hidden behind the bottom navigation.
- Navigation works correctly in standalone PWA mode.
- Back navigation and deep links continue functioning.

---

# 3. Overview and club information redesign

## 3.1 Expandable club summaries

### Goal

The Overview currently emphasizes median carry distance.

Users should be able to access additional performance measurements directly without navigating to a separate detailed page.

### Proposed interaction

Tapping a club expands an inline detail area.

Collapsed state:

- Club name.
- Typical median carry.
- Compact carry distribution.
- Optional score or reliability indicator once implemented.

Expanded state:

- Ball speed.
- Launch angle.
- Apex height.
- Carry consistency.
- Strong-strike carry once available.
- Shot count.
- Data coverage or uncertainty.
- Relevant shot-shape or directional measurements.
- Link to the full club profile.

The expanded content could also contain compact visualizations.

### Requirements

- Reuse existing club analytics rather than introducing duplicate calculations.
- Respect measurement basis and shared filters.
- Support keyboard and touch interaction.
- Keep expansion smooth and responsive.
- Allow users to expand and collapse clubs independently or with sensible accordion behaviour.
- Avoid overcrowding the Overview.
- Continue supporting full club profile navigation.

## 3.2 Include pitching wedge in iron-style performance analysis

### Goal

The pitching wedge should generally appear alongside irons in the main performance and gapping views.

Currently, wedge handling is deliberately conservative because many wedge shots are intentional partial swings.

This remains appropriate for short-game analysis, but PW deserves slightly different treatment.

### Proposed approach

- Treat PW as eligible for the iron-style club overview and gapping.
- Keep explicit partial shots outside full-swing carry benchmarks.
- Allow the automatic classifier to distinguish likely partial PW shots from likely full shots.
- Keep PW available in wedge distance-control analysis too.
- Preserve the distinction between normal PW performance and intentional PW distance-control drills.

Do not assume that every PW shot is full simply because PW appears alongside the irons.

Consider making club analysis roles configurable rather than permanently hardcoding treatment for PW, GW, SW and LW.

---

# 4. Visual redesign: show more, explain less

## Goal

Reduce the amount of text presented throughout the application.

Shotwise currently provides extensive statistical explanations, but the result can feel overwhelming.

The desired direction is a clean, visual, information-dense interface that remains approachable.

Use the principle:

**Show the result first. Explain it when requested.**

### Proposed changes

Replace suitable text-heavy sections with:

- Compact metric cards.
- Small trend charts and sparklines.
- Carry distribution plots.
- Box plots and percentile bands.
- Visual club comparisons.
- Progress indicators.
- Concise badges indicating data limitations.
- Contextual help icons.
- Expandable methodology explanations.

### Information hierarchy

Use three levels:

**Level 1 — At a glance**

Display the most important measurements, comparisons and insights.

**Level 2 — Exploration**

Allow the user to expand sections, open charts and inspect individual clubs or sessions.

**Level 3 — Methodology**

Make statistical explanations and calculation details available on demand.

### Design considerations

- Preserve the existing Shotwise visual identity.
- Avoid decorative charts that do not communicate useful information.
- Keep exact numerical data accessible.
- Maintain readable labels and accessible text equivalents.
- Use consistent measurement units and terminology.
- Consider mobile-first information density.
- Prefer compact layouts over long sequences of explanatory paragraphs.

Treat this as an incremental design improvement across affected screens, not necessarily a single large redesign PR.

---

# 5. Automatic shot classification

## 5.1 Product direction

### Goal

Make Shotwise useful immediately after importing an Inrange session, without requiring the user to review or manually categorize shots.

Manual review should become optional.

The user should be able to import a CSV, open their analytics, and trust that the application has made reasonable, conservative assessments automatically.

### Core requirement

**Automatic classification becomes the default interpretation layer, while manual decisions remain authoritative.**

The original Inrange data must remain immutable.

Manual classifications should override automated decisions.

The application must retain uncertainty instead of forcing unreliable classifications.

## 5.2 Classification dimensions

Keep three independent dimensions.

### A. Shot intent

Possible values:

- Likely full swing.
- Likely partial swing.
- Unknown.

### B. Strike quality

Possible values:

- Typical strike.
- Likely mishit.
- Uncertain.

### C. Club identity

Possible values:

- Plausible recorded club.
- Suspected incorrect club.
- Unknown club.

These dimensions must remain independent.

For example, an intentional partial shot can be a perfectly reasonable strike.

A mishit can still have a correctly recorded club.

A long and well-struck shot can have an incorrect club label.

## 5.3 Use multiple shot measurements

Evaluate classification using a combination of:

- Carry distance.
- Ball speed.
- Launch angle.
- Apex height.
- Carry-to-total relationship.
- Recent club-specific distributions.
- Recorded target information.
- Shot order.
- Neighbouring shots.
- Historical data and changing player ability.

Avoid relying exclusively on fixed launch-angle thresholds or distance cutoffs.

For example:

A short, very low-launch 6 iron is probably a mishit.

A short, high-launch 60-degree wedge may be intentional.

These are probabilistic interpretations, not guaranteed facts.

## 5.4 Sequence-aware club inference

**This is an important new requirement.**

At a driving range, golfers commonly hit several consecutive shots using the same club.

The initial user typically hits at least 10 shots with a club before switching, although this is a tendency rather than a strict rule.

Shotwise should take advantage of this behaviour.

### Example 1 — Missing club label

Consider the sequence:

| Shot range | Recorded club |
|---|---|
| 1–10 | 7i |
| 11–13 | ? |
| 14–20 | 7i |

If the three unidentified shots have measurements compatible with the surrounding 7 iron shots, the application can infer that 7 iron is a plausible club.

### Example 2 — Forgotten tablet switch

| Shot range | Recorded club |
|---|---|
| 1–10 | 9i |
| 11–20 | 9i |
| 21–30 | D |

Suppose shots 11–20 have ball speeds, launch characteristics and carry distances much closer to the driver's profile.

This may indicate that the golfer switched clubs at shot 11 but forgot to update the Inrange tablet until shot 21.

The application should detect this as a possible sequence-level labelling problem.

### Example 3 — Ambiguous transition

| Shot range | Recorded club |
|---|---|
| 1–10 | 7i |
| 11–14 | ? |
| 15–25 | 5i |

The unidentified shots may belong to the end of the 7 iron block, the beginning of the 5 iron block, or both.

The application should examine shot characteristics and possible transition points rather than blindly assigning the entire unknown block to one club.

### Proposed inference approach

Investigate a sequence-aware model that combines:

1. Individual shot compatibility with candidate clubs.
2. Nearby recorded club labels.
3. Consecutive shot runs.
4. The likelihood of club changes.
5. The number of observations supporting each inference.

Potential techniques include:

- Rule-based sequence segmentation.
- Change-point detection.
- Dynamic programming over possible club sequences.
- Hidden Markov Models, if the additional complexity is justified.

Start with the simplest approach that works reliably.

Do not automatically introduce machine learning solely because the problem resembles a sequence-classification task.

### Important safeguards

- A golfer may intentionally alternate clubs.
- Club transitions may occur inside blocks of missing labels.
- The first or last shots of a session may have little contextual information.
- Mishits should not automatically be mistaken for club changes.
- New golfers improve rapidly.
- Equipment changes may affect measurement distributions.
- Recorded club labels are useful evidence but not infallible.

**Never silently overwrite the recorded or manually corrected club.**

For high-confidence suspected errors, the application may exclude affected shots from club-specific benchmarks or mark them as provisionally unassigned under a documented policy.

For an unknown club, a high-confidence inferred club may be displayed as a provisional assignment, but it must remain distinguishable from a confirmed assignment.

Manual corrections always take precedence.

The analytics should distinguish between recorded, inferred and confirmed club identities.

## 5.5 Personal calibration and improving golfers

The classifier should adapt to the golfer's recent ability.

A beginner's driver may improve substantially across several sessions.

Historical poor performance should not indefinitely influence current classification thresholds.

Consider:

- Recent sliding windows.
- Robust per-club baselines.
- Minimum sample sizes.
- Multiple-session evidence.
- Gradual adaptation.
- Safeguards against incorrect baselines.
- Conservative fallback behaviour for new users.

Avoid creating circular dependencies where incorrect automatic classifications continually reinforce themselves.

## 5.6 Confidence and uncertainty

Every automated assessment should have a reason and evidence.

Possible internal states:

- High-confidence classification.
- Low-confidence classification.
- Abstention due to insufficient evidence.

Avoid displaying unsupported numerical confidence percentages.

Prefer labels such as:

- Likely mishit.
- Likely partial.
- Possible wrong club.
- Not enough information.

Show uncertainty when it materially affects statistics.

## 5.7 Optional review workflow

The existing review system should remain available.

However:

- It should not be required after import.
- Automatic analytics should work without review.
- Import summaries should prioritize viewing results.
- Optional review should be visually secondary.
- Manual corrections should remain reversible.
- Original data and audit history must remain intact.

Consider simplifying navigation if Review becomes a less frequently used feature.

### Evaluation

Assess classification accuracy using representative labelled test data.

Do not evaluate only shots previously flagged by the algorithm, because that would introduce selection bias.

Track false positives, false negatives, abstentions and classification coverage.

Use a versioned classifier so new algorithms can be compared fairly and old manual decisions remain stable.

---

# 6. Strong-strike potential and performance filtering

## 6.1 Goal

Separate what a golfer can achieve with a club from what they normally achieve.

This is particularly important for beginners.

A golfer may occasionally hit excellent drives while also producing many severe mishits.

The app should communicate both the upside and the reliability.

### Proposed performance modes

**All shots**

Show legitimate full-swing outcomes including mishits.

Best for evaluating real-world reliability.

**Typical shots**

Exclude sufficiently well-supported mishits while retaining normal variation.

Best for expected carry and club gapping.

**Strong strikes**

Focus on higher-performing full swings to estimate realistic distance potential.

Best for evaluating what the club can produce when struck well.

Review how these modes interact with existing filters before implementation. Avoid multiple overlapping controls that produce confusing results.

## 6.2 Estimating potential

Investigate robust upper-tail statistics such as:

- P75 carry.
- P80 carry.
- Upper-quartile mean.
- Median of high-performing eligible strikes.

Evaluate which estimator is most stable and meaningful.

The initial recommendation is to investigate P80 as a potential-distance indicator.

Avoid relying exclusively on the maximum recorded carry.

Avoid arbitrary symmetric ranges around the overall median, especially for highly inconsistent clubs.

### No artificial upper ceiling

An exceptionally long, legitimate shot should not be discarded merely because it exceeds a predetermined upper carry limit.

However, extreme positive outliers should still be checked for incorrect club labels or measurement anomalies.

### Important distinction

A long shot is not automatically a good golf shot.

For the initial implementation, call this measurement **distance potential** or **strong-strike carry**, rather than claiming it captures overall shot quality.

Directional accuracy and other characteristics should be evaluated separately.

## 6.3 Keep consistency independent

Do not measure consistency exclusively from the filtered set of strong strikes.

Doing so would produce artificially narrow distributions.

Instead, show potential alongside reliability and carry variability calculated from the appropriate broader population.

For example:

- Typical carry: 160 m.
- Strong-strike carry: 195 m.
- Carry IQR: 35 m.
- Severe mishit frequency: reported when supported by adequate evidence.

This indicates both high potential and poor reliability.

### Acceptance criteria

- Potential is not dominated by early beginner history.
- Intentional partial shots do not pollute full-swing benchmarks.
- Suspected incorrect clubs cannot silently create false personal bests.
- Strong-strike calculations remain consistent across screens.
- Small samples are marked clearly.
- Reliability remains visible when a potential filter is selected.
- Analytics retain links to contributing shots.

---

# 7. External golf performance benchmarks

## 7.1 Goal

Allow golfers to compare their performance against relevant external populations, rather than only their own historical results.

A golfer can be consistent relative to their own history while still underperforming in distance or another measurable dimension compared with similar golfers.

External benchmarks can help reveal this.

## 7.2 Research promising data sources

Investigate sources such as:

### Shot Scope

Golf performance data by handicap, including club distances and performance averages.

Potentially useful for amateur club-distance references.

### Arccos Golf

Large-scale amateur shot tracking, including driving distance and accuracy by handicap, age and gender.

Potentially useful for driving benchmarks.

### TrackMan

PGA Tour and LPGA Tour averages for ball speed, carry, launch angle and other launch-monitor measurements.

Useful for professional reference comparisons.

Also investigate additional high-quality sources if appropriate.

### Data requirements

Before integrating a benchmark dataset, establish:

- Source and publication date.
- Sample size where available.
- Population represented.
- Club type.
- Measurement units.
- Carry versus total distance.
- Whether results represent averages, medians, percentiles or filtered performance.
- Whether data is from the range or golf course.
- Whether measurements are directly comparable to Inrange.
- Terms of use and redistribution permissions.

Do not assume that publicly viewable statistics may be freely copied into the application.

If data licensing is unclear, propose a compliant alternative.

## 7.3 Handicap-based comparison

Prefer actual amateur reference data grouped by handicap rather than applying arbitrary scaling factors to professional statistics.

Potential groups:

- Beginner/high handicap.
- Handicap 20–29.
- Handicap 10–19.
- Handicap 0–9.
- Scratch.
- LPGA Tour.
- PGA Tour.

These groups are illustrative and should follow available data.

Allow the user to select a comparison group even if they do not have an official handicap.

Do not infer an official handicap from range data.

## 7.4 Measurement compatibility

This is critical.

Inrange exports include:

- Range-ball carry.
- Premium-ball estimated carry.
- Flat carry.
- Total distance.
- Launch characteristics.

External sources may report substantially different quantities.

Never silently compare on-course total distance with Inrange carry distance.

Where a meaningful comparison is impossible, omit the benchmark or explain the mismatch.

Tour-level data should not be used as an automatic definition of optimal launch angle for amateurs.

Club loft, model, swing speed, environmental conditions and measurement methodology can all affect comparability.

## 7.5 User interface

Introduce optional benchmark overlays in club profiles and potentially Overview.

Users should be able to compare:

- Their current performance.
- Their historical performance.
- A selected external benchmark.

Use concise visual comparisons with clear source attribution.

Keep benchmark comparisons separate from personal improvement trends.

### Initial scope

Start with trustworthy, comparable distance benchmarks.

Expand to launch, ball speed, accuracy and consistency only where suitable data exists.

Avoid presenting unsupported handicap-equivalent ratings.

---

# 8. Club performance scores

## 8.1 Goal

Provide an intuitive assessment of which clubs a golfer performs well with and which clubs deserve attention.

Users should be able to tap a club's overall score and inspect the underlying category scores and measurements.

## 8.2 Proposed categories

Investigate four core dimensions.

### Distance potential

How effectively the golfer generates carry with a club.

Where suitable external benchmarks exist, compare against relevant golfers.

Otherwise, show the raw potential metric or a clearly identified personal benchmark.

### Consistency

How predictable the club's carry distance is.

Use appropriate distribution statistics such as IQR or lower-tail performance.

Avoid artificially inflating consistency scores by looking only at strong strikes.

### Directional control

Evaluate shot direction and curvature relative to the intended line where measurements support it.

Do not treat curvature alone as landing dispersion.

Consider whether relevant metrics are missing in sessions without target tracking.

### Reliability

Evaluate the frequency of severe mishits or otherwise poor full-swing outcomes.

Account for automatic-classification uncertainty and manual-review coverage.

Avoid displaying precise reliability percentages if the classifier has not been sufficiently validated.

## 8.3 Overall score

A composite score could be useful, but only if it is defensible.

Do not arbitrarily combine unrelated numbers just to produce a rating out of 100.

The planning phase should establish:

- What the score represents.
- How categories are normalized.
- What reference populations are used.
- How categories are weighted.
- Whether weights differ by club type.
- How uncertainty affects the score.
- What happens when a category has insufficient data.
- How historical improvement affects current scores.

Do not treat increased carry or increased launch angle as universally better.

A golfer's most reliable club is not necessarily their longest or most improved.

Consider whether separate category scores and a potential-versus-reliability visualization should launch before the overall composite.

## 8.4 Detailed score breakdown

The desired experience is:

**Overview**

A compact club card with a score and basic performance summary.

**Expanded club card**

Distance potential, consistency, directional control and reliability.

**Full club profile**

Underlying measurements, reference benchmarks, data coverage, historical development and scoring methodology.

All scores must be explainable and reproducible.

Do not introduce numerical ratings where the underlying evidence is insufficient.

---

# 9. Architecture and data integrity

Review the existing React, TypeScript and Supabase implementation before proposing changes.

Important requirements:

- Preserve original imported CSV data.
- Preserve recorded club labels.
- Keep effective club assignments distinct from originals.
- Separate automatic assessments from manual decisions.
- Preserve equipment identity and existing equipment assignment semantics.
- Maintain owner isolation and database security.
- Maintain backward-compatible backup and restore.
- Respect archived sessions and exclusions.
- Avoid duplicated statistical implementations.
- Reuse existing measurement basis mapping.
- Keep business logic in testable domain modules.
- Version classification algorithms and benchmark datasets where needed.
- Preserve manual corrections across classifier upgrades.

### Shot assessment model

Consider a model similar to:

- Original shot measurements.
- Recorded club.
- Effective manually corrected club.
- Optional inferred club.
- Recorded or inferred shot intent.
- Recorded or inferred contact classification.
- Assessment provenance.
- Confidence or abstention reason.
- Classifier version.
- Manual override state.
- Exclusion state.

Do not introduce unnecessary schema complexity before reviewing how the current shot review model works.

Prefer a clearly defined resolution policy for combining manual and automatic classifications.

### Performance

Avoid introducing Python, Rust, machine-learning services or additional backend infrastructure without a demonstrated need.

The current TypeScript analytics architecture should remain the default.

Profile performance before optimizing.

---

# 10. Proposed development milestones

These are the proposed milestones, not an instruction to implement everything at once.

## Phase 1 — Mobile foundation

**PR 1:** PWA installability and icons.

**PR 2:** Mobile hero responsiveness and overflow fixes.

**PR 3:** Five-tab bottom navigation and information architecture.

Outcome: Shotwise feels like a properly designed mobile application.

## Phase 2 — Accessible club analytics

**PR 4:** Expandable club summaries on Overview.

**PR 5:** Pitching wedge integration with iron-style analytics.

**PR 6:** Incremental visual cleanup of Overview and club details.

Outcome: Users can understand more without navigating through text-heavy pages.

## Phase 3 — Automatic classification foundation

**PR 7:** Audit existing review models, classification rules and eligibility calculations; define automatic-versus-manual precedence.

**PR 8:** Automatic shot-intent and contact assessment, with uncertainty handling.

**PR 9:** Sequence-aware club inference, including unknown labels and suspected forgotten club switches.

**PR 10:** Integrate automatic classifications into analytics and make review optional.

**PR 11:** Evaluate classifier behaviour and add a representative testing methodology.

Outcome: Imported sessions produce useful analytics immediately with minimal manual effort.

Consider smaller PRs if needed, particularly for sequence inference and persistence changes.

## Phase 4 — Performance potential

**PR 12:** Define and implement strong-strike carry estimation.

**PR 13:** Add clear All / Typical / Strong-strike performance controls.

**PR 14:** Show potential and reliability together in club summaries and profiles.

Outcome: Users can distinguish their distance potential from their normal reliability.

## Phase 5 — External benchmarking

**PR 15:** Research and document suitable reference datasets and usage permissions.

**PR 16:** Introduce a source-aware benchmark data model.

**PR 17:** Add optional benchmark comparisons to club profiles.

Outcome: Golfers can understand their performance relative to relevant external references without misleading comparisons.

## Phase 6 — Explainable club ratings

**PR 18:** Design and validate category-score definitions.

**PR 19:** Introduce category scores with breakdowns.

**PR 20:** Add an overall club score only if the data and normalization justify it.

Outcome: An intuitive assessment of club strengths and weaknesses, grounded in explainable measurements.

## Continuous work — Design simplification

Throughout all phases:

- Replace repetitive text with concise charts where appropriate.
- Improve mobile interactions.
- Consolidate duplicated interface patterns.
- Maintain accessible explanations on demand.
- Test usability on phone-sized screens.
- Keep charts and ratings consistent across views.

---

# 11. Verification and testing

Follow the repository's existing standards.

### UI and PWA tests

Verify:

- Common iPhone viewport widths.
- Standalone PWA launch behaviour.
- Safe-area spacing.
- Bottom navigation and keyboard accessibility.
- Deep-link preservation.
- Hero responsiveness.
- No horizontal page overflow.
- Reduced-motion behaviour.
- Light and dark themes.

### Classification tests

Use synthetic fixtures covering:

- Legitimate full swings.
- Severe mishits.
- Intentional partial wedges.
- Ambiguous low-launch shots.
- Unknown club labels.
- Consecutive runs of the same club.
- Forgotten tablet changes.
- Club switches inside unknown blocks.
- Alternating clubs.
- Single-shot anomalies.
- Sparse new-user history.
- Rapid improvement.
- Equipment changes.
- Manually corrected clubs.
- Multiple sessions on the same date.
- Missing measurements.
- Revision conflicts and backup compatibility.

Include tests ensuring that manual overrides remain authoritative.

### Analytics tests

Cover:

- Different measurement bases.
- Strong-strike percentile calculations.
- All-shot reliability.
- Small samples.
- Partial versus full intent.
- Positive club-label outliers.
- External benchmark compatibility.
- Missing benchmark categories.
- Score decomposition and consistency.
- Stable calculations across Overview, club profiles and other relevant screens.

Use deterministic fixtures and avoid committing private Inrange exports.

---

# 12. Instructions for Mistral

## First task: review and plan

**Do not immediately implement the entire roadmap.**

Start by inspecting the actual repository, including:

- Current project instructions.
- Existing architecture.
- Analytics and classification implementations.
- Review persistence.
- Equipment management.
- Current navigation and CSS.
- Charting infrastructure.
- Existing tests.
- Current roadmap documentation.

Identify which requirements:

1. Already exist.
2. Are partially implemented.
3. Are genuinely missing.
4. Conflict with existing architecture or assumptions.

Then recommend necessary changes to this roadmap.

## Planning deliverables

Provide:

1. A current-state assessment referencing relevant files.
2. An architectural proposal for the next phase.
3. A detailed design for the automatic assessment and sequence-inference system.
4. An approach to trustworthy strong-strike and reliability statistics.
5. A benchmark-data research and integration plan.
6. A principled approach to club scoring.
7. A mobile UI and navigation proposal.
8. A refined implementation roadmap with small, testable PRs.
9. Important unresolved decisions, with recommendations.

Do not assume all 20 proposed PRs are necessary. Consolidate or split milestones where this improves implementation quality.

## Implementation workflow

After the plan is approved:

- Implement one reviewable milestone at a time.
- Reuse existing architecture.
- Add tests with each feature.
- Verify the application locally.
- Avoid unrelated refactoring.
- Summarize changes, limitations and test results.
- Keep documentation synchronized with implemented behaviour.

## Final objective

Shotwise should become a polished, low-friction golf analytics application that:

- Works naturally as a mobile Home Screen app.
- Communicates information primarily through clear visuals.
- Automatically interprets shot data while preserving uncertainty.
- Makes manual review optional.
- Distinguishes typical performance, distance potential and reliability.
- Compares performance against meaningful personal and external references.
- Helps golfers identify their strongest clubs and their biggest opportunities for improvement.

**The most important principle is that Shotwise should make sophisticated analytics feel simple to the golfer, without making the underlying statistics simplistic or misleading.**

## Owner's emphasis

Two points the owner wants emphasized when working from this roadmap:

1. **Sequence-aware inference should be central to automatic classification, not just an optional enhancement.** The habit of hitting many consecutive balls with the same club is valuable information; a model that uses shot order, measurements and probable club transitions should handle missing labels much better than per-shot classification. But the model must learn or allow for different practice patterns rather than assuming everybody always hits 10 balls per club.
2. **Treat club scoring as the final milestone, not the first analytics feature.** Once automatic classifications, robust strong-strike estimates, reliable consistency measurements and suitable external benchmarks exist, scores will rest on a much stronger foundation.

Intended working style: hand the agent the entire roadmap, have it compare the roadmap against the current repository and propose the first few PRs. Then use a separate targeted code review (e.g. Codex) for the more consequential changes — particularly classification, database migrations and scoring.

---

# 13. vNext completion audit — 2026-11-25

Targeted audit of merged PRs #52–#74 against this roadmap. A merged PR number is not treated as a completed objective; status below reflects the implemented behaviour, verified against the code.

## 13.1 Fully delivered

- §2.1 PWA installability (#54), §2.2 mobile hero fit (#55), §2.3 five-tab bottom navigation (#56) — Phase 1 complete.
- §3.1 Expandable club summaries on Overview (#57).
- Phase 3 classification foundation: precedence audit + ADR-0001 (#59), automatic intent/contact assessment `intent-contact-1` (#60), sequence-aware club inference `sequence-1` (#61), analytics consuming resolved assessments so review is optional (#62), labelled-scenario evaluation methodology (#63).
- Phase 4: strong-strike carry P80 / ADR-0002 (#64), All / Typical / Strong-strike controls (#65), potential shown alongside reliability from the broader cohort (#66).
- §7.2 benchmark research with licensing verdicts (#67) and the source-aware link-only benchmark model + club-profile link-outs (#68, #69).
- Phase 6 definitions: category scores `category-scores-1` + ADR-0003 (#70), category breakdown UI (#71), no-composite decision + within-bag standings + ADR-0004 (#72).
- Personal reference values: persistence + migration (#73), editing UI in club profiles (#74). Storage and display only — see 13.2.

## 13.2 Partially implemented

- §8 club ratings: categories exist as **raw metrics** with within-bag standings (ADR-0004). No normalized 0–100 category ratings, no provisional composite. Within-bag standings on raw metrics are confounded by club type: raw carry ranks the driver first by construction; raw carry IQR in metres favours shorter clubs. ADR-0004 should be revisited (normalization, reference-relative potential, relative variability, documented weights) now that personal reference values exist — see 13.5.
- §7.5 personal benchmark comparisons: reference values are persisted and displayed, but there is no comparison (typical vs reference, strong-strike vs reference, absolute difference, % of reference, visual bars), and reference records carry no measurement-basis/provenance metadata (`userReferenceValueSchema` has only metric carry|total, valueM, note). Not yet usable by the distance-potential rating.
- §7.3–7.5 external numerical benchmarks: link-only registry only. No embedded numerical dataset; see 13.3.
- §5.3 classifier signals: `classify.ts` uses carry and ball speed only. Launch angle, apex, carry-to-total, target and sequence signals are not used; a severe low-launch mishit with retained ball speed is classified `typical` (mishit requires carry **and** speed below thresholds).
- §3.2 / §5.2 PW handling: PW participates in iron-style analytics (#58), but intent for PW is always `full` when unresolved — partial PW shots are not distinguished and can be flagged as mishits.
- §5.4 sequence inference: implemented, but with correctness issues — see 13.4.
- §5.7/§11 evaluation: synthetic labelled scenarios only; no evaluation on real Inrange exports yet.
- Phase 2 PR 6 (incremental visual cleanup of Overview and club details): not performed as a milestone; Overview and profiles still risk becoming text-heavy as analytics are added.

## 13.3 Deferred

- Numerical external benchmark integration (§7): every researched source is link-only under its terms (docs/external-benchmark-sources.md); no written license exists. Deferred until a licensable, measurement-compatible source is found; personal reference values are the functional alternative. Do not copy restricted datasets.
- Composite 0–100 overall club score: declined by ADR-0004 pending defensible normalization. To be re-proposed as a new ADR (provisional composite with documented weights) once reference-relative normalization exists; not marked complete.
- Handicap-equivalent ratings: unsupported by design (§7.5).

## 13.4 Known limitations and outstanding correctness issues

Reconciled audit of PRs #52–#74 plus an independent Codex review (2026-11-25); every item verified against the merged code.

1. **Manual club decisions can still be excluded.** `suspectedWrongClub` is set regardless of a manual confirm/correct, and club-scoped cohorts drop such shots; the Review badge is suppressed on reviewed rows (`assessment.ts:141`, `analytics.ts:197`, `ShotReview.tsx:858`).
2. **Historical inference is not append-stable.** The sequence window is anchored to the latest session date (including archived sessions), so adding a later import or archive can remove or change earlier inferences; profiles are pooled across the whole window, so later shots influence earlier ones (`sequence.ts:137-142`, `sequence.ts:63`).
3. **Sequence references can be contaminated and self-training.** Profiles include mishits, partials and wrong-label blocks; a suspect switch block contributes to its own reference; alternative candidates overwrite each other in iteration order (`sequence.ts:63`, `sequence.ts:232-280`).
4. **Evidence minima are inconsistently enforced in sequence inference.** A global-profile fallback can rest on one labelled shot; exact distance ties resolve to the previous club; the reported evidence count can name the local sample while the global profile supplied the evidence (`sequence.ts:154-186`).
5. **Intent and contact are coupled through carry.** Partial wedges always get `typical` contact; PW is always assumed full and a short PW can be flagged `mishit`; the mishit rule needs both low carry and low speed, so low-launch strikes with retained ball speed pass as `typical`; launch, apex, carry-to-total, target and sequence signals are unused (`classify.ts:144-192`).
6. **Inferred clubs get no intent/contact assessment**, and an unresolved unknown club passes `isFullSwingResolved` (`classify.ts:56-161`, `assessment.ts:106`).
7. **Baseline chronology is not total-ordered.** Same-date sessions tie at the 50-shot cap (input-order dependent) and earlier same-day visits are discarded (`classify.ts:68-105`).
8. **Club-benchmark eligibility differs across screens.** Progress, wedge analysis and Overview club figures can include suspected-wrong-club rows that club-scoped views, recap, gapping and profiles exclude (`progress.ts:12`, `wedgePractice.ts:61`, `Analysis.tsx:72`).
9. **P80 is not invariant across performance modes.** Gapping recomputes P80 on the strong-filtered subset while Clubs uses the full eligible cohort; the strong view is labelled "Typical carry" (`analytics.ts:546-573`, `ClubGaps.tsx:80`).
10. **Cohort contract inconsistencies.** "Typical" includes partial shots with typical contact in Overview/Progress/Explorer, while Gapping excludes partials and mishits even in All mode; Hide-likely-mishits stays active but hidden in Strong mode; switching basis reclassifies shots while Review badges are always premium-flat (`analytics.ts:174`, `analytics.ts:507`, `Analysis.tsx:91`, `ShotReview.tsx:70`).
11. **Reliability denominators mix manual and resolved counts** across recap/compare/scores; the `reviewed` cohort name accepts fully automatic classifications; an automatically flagged best shot is labelled "confirmed mishit" (`analytics.ts:252`, `recap.ts:311`, `compare.ts:265`, `scores.ts:226`, `ClubProfiles.tsx:530`).
12. **Potential reporting hides weak evidence.** `missing` is always zero in the strong-strike population, zero carries count as measured, `reliable` only means n ≥ 10, and a single unreviewed outlier can set the personal best (`potential.ts:61`, `clubProfiles.ts:221`).
13. **Stale reference delete succeeds.** Delete takes only the ID — no expected revision — through UI, repository and RPC (`ClubProfiles.tsx:624`, migration `20261126090000_user_reference_values.sql`).
14. **Write/restore boundary mismatch.** Restore enforces ≤1000 reference rows but save does not; DB validation accepts `unknown` club labels the form rejects; the Settings emptiness check omits references (migration, `App.tsx:556`).
15. **Rollout skew risk.** The client unconditionally reads `userReferenceValues` in the snapshot, so it cannot load against a pre-migration RPC, while GitHub Pages deploys independently of the hosted Supabase migration (`snapshot.ts:17`, `.github/workflows/ci.yml`).
16. **Evaluation metrics can conceal misses.** Abstentions are not counted as errors and club accuracy credits unchanged recorded labels; synthetic fixtures largely mirror the decision rules (`evaluation.ts:81-156`).
17. **Cold assessment is O(n²)** (per-shot full-history scan), the resolve cache holds one basis, Review runs both classifiers separately, and Progress re-scans the cohort per club/session (`classify.ts:69`, `assessment.ts:119`, `ShotReview.tsx:70`, `progress.ts:26`).
18. **Standings rank raw metrics**, confounded by club type: raw carry ranks the driver first by construction; raw IQR in metres favours short clubs (`standings.ts:28`).
19. **Reference records lack basis/type/provenance metadata**, are displayed on every basis, and no comparison is computed yet (`model.ts:177-191`, `ClubProfiles.tsx:198`).
20. **Real-world classifier accuracy is unevaluated**; synthetic scenarios do not establish it.

## 13.5 Remaining implementation work (consolidated plan, 2026-11-25)

Priorities follow the owner's direction: correctness and statistical reliability before new scoring. Small, independently reviewable PRs; no implementation starts until the owner approves this plan.

### Phase A — correctness and data integrity (before any new scoring)

- **A1 Manual precedence over suspicion** — a manually confirmed/corrected club clears automatic `suspectedWrongClub` for eligibility (observation kept for diagnostics); Review badge explains reviewed-but-flagged rows. Tests: confirm and correct through the actual club cohort.
- **A2 Append-stable sequence inference (`sequence-2`)** — per-visit anchored reference windows; archived sessions must not move the window anchor; later visits excluded from earlier visits' references; total-ordered chronology (session id tiebreak) at the baseline cap. Tests: append-future invariance, input-permutation invariance, exact ties.
- **A3 Classifier signals and independence (`intent-contact-2`)** — decouple intent from contact; low-output (short carry + low speed) signal; launch/apex/carry-to-total corroboration where measured; target evidence only when trustworthy; PW partial detection without assuming all PW full; resolve club identity (manual, then provisional sequence inference) before intent/contact assessment; unknown clubs never pass the full-swing predicate. Tests: paired partial / partial-mishit / low-flight-retained-speed / missing-input cases.
- **A4 Sequence evidence quality (`sequence-2`)** — minimum sample enforced on whichever profile source is used; separation margin handling exact ties; evidence count reports the actual source; candidate blocks excluded from their own reference; reviewed mishits/partials excluded from profiles; alternatives ranked together with abstention on overlap; shorter switches advisory, not exclusionary.
- **A5 One club-benchmark eligibility rule** — shared predicate applied before the Recent cap across Overview, Progress, wedge analysis, recap, compare, gapping, explorer and profiles; suspected rows stay in session totals with a reason. Test: one fixture asserting contributing shot IDs per screen.
- **A6 One P80** — P80 computed once per window/visit from the untrimmed eligible cohort, invariant under performance mode; strong-view labels named explicitly. Tests: P80 equality across modes and visit scopes.
- **A7 Cohort contract and filter visibility** — separate descriptive shot views from full-swing benchmark populations; every active filter discoverable (no hidden Hide-mishits in Strong mode); declared assessment-basis policy so a display basis switch does not silently reclassify; Review shows the basis used.
- **A8 Reliability and evidence reporting** — one derived full-swing population; manual/automatic/unassessed counts reconcile across recap, compare and category scores; rates named by provenance; mishit rate shown with a missingness sensitivity range; potential exposes measured/missing/zero/uncertain-contact/assumed-intent/provisional-club counts; `reliable` renamed to sample sufficiency; isolated suspect maxima qualified in personal best.
- **A9 Reference-value persistence fixes** — revision-checked delete through UI, repository, RPC and a backward-compatible migration; align write/parse/restore limits (incl. the 1000-row bound); reject `unknown` labels in DB validation; include references in the Settings emptiness check. DB tests: save-then-stale-delete, boundary round trip, reference-only account.
- **A10 Rollout compatibility** — database-first release order documented in `docs/database.md`; tolerant snapshot load (or versioned table list) so old clients keep working; RPC contract smoke test in CI.
- **A11 Measured performance pass** — index chronological evidence by club and visit; bounded baselines; walk each unknown run once; multi-basis resolve cache; group Progress/profile inputs once per query. Test: identical documented results and paired cold/warm timings at fixed sizes.

### Phase B — evaluation (after A3/A4 land)

- **B1 Evaluation contract** — abstentions reported by truth class; end-to-end recall over labelled positives counting abstained positives as misses; missing-label inference, wrong-label detection and alternative identification scored separately against a recorded-label baseline; permutation and future-append invariance tests.
- **B2 Real-world pilot harness** — opt-in, local-only: block-level practice capture, randomized labelled sample across flagged/unflagged/abstained rows with an explicit unsure option, challenge blocks (low flight, partial PW, equipment change, alternating clubs, masked labels), whole visits held out for threshold checks, aggregate-only reports; raw exports never committed. Reports coverage, false positives, false negatives and abstentions without overclaiming.

### Phase C — personal comparisons and ratings (after A and B)

- **C1 Reference compatibility metadata** — backward-compatible migration adding measurement basis, metric, reference type (goal vs observed vs historical personal potential), statistic (median/P80/…), source, date and optional equipment id; legacy rows stay displayable with unknown compatibility; comparison eligibility matrix tests. The three reference concepts (external benchmark / personal goal / automatic historical potential, §13.6) must be visually distinguished and never mixed silently.
- **C2 Personal reference comparisons** — typical and strong-strike carry vs compatible reference, absolute difference, % of reference, compact bars; carry↔carry / total↔total and basis-compatible gating only. Comparisons must remain optional; analytics are useful with no reference configured.
- **C3 Normalized ratings (new ADR-0005, then `category-scores-2`)** — target-relative category scores on a common 0–100 scale (P80/reference capped at target, measured distance still shown; IQR/median relative variability against declared spread tolerances; directional control vs a declared corridor with launch-direction error separate, curvature never treated as dispersion; mishit rate vs declared tolerances with coverage and sensitivity range), provisional composite with the owner-approved weights 20/25/30/25 as versioned constants, progressive evidence levels per §13.6 decision 5 (no hard 3-visit gate; leave-one-visit-out sensitivity at the top level), missing categories withheld with the composite suppressed or flagged when the category set differs materially. Replace raw-metric standings per decision 2. **Gate: the owner reviews the proposed normalization functions, tolerance anchors, missing-data policy and illustrative scores for several clubs before implementation.**

### Phase D — deferred and process

- **D1 External numerical benchmarks** — independent re-verification of licensing conclusions (copyrighted presentation vs published aggregate facts vs contractual restrictions); unless a written license exists, §7 numerical comparison stays formally deferred with link-only references and personal references as the alternative. Link-only is a reference resource, not the completed benchmarking feature; the limitation must be documented explicitly if numerical comparison stays blocked.
- **D2 Visual simplification (roadmap PR 6), split** — (a) early visual cleanup of existing pages and club profiles, independent of classification/scoring; (b) comparison/rating visualizations integrated as C2/C3 land: compact metric grids, comparison bars, category-score breakdowns, carry distribution plots, sparklines, contextual help behind disclosure, mobile-first pass.

## 13.6 Owner product decisions — 2026-11-25

Approved after reviewing the consolidated plan and the independent Codex review. These decisions govern implementation.

1. **Composite club score.** ADR-0004 is reopened through a new ADR-0005. The product wants an overall club performance rating plus four category ratings on a common 0–100 scale — a designed performance index, not a validated golf-skill or handicap measure. Approved provisional weights, as versioned methodology constants: distance potential 20%, consistency 25%, directional control 30%, reliability 25%. Normalization functions and tolerance anchors must be proposed for owner review before C3 is implemented, and must account for the different roles and natural distances of different clubs. Mixed units are not a reason to abandon the composite. No external population percentiles, no handicap equivalents.
2. **Raw standings.** Remove misleading raw-metric standings (especially raw-carry distance and absolute-carry-IQR rankings) once normalized ratings exist; retain the underlying raw measurements. A longer club must not automatically score better; a shorter club must not automatically win consistency.
3. **Assessment basis.** A canonical classification basis independent of the selected display basis. Prefer directly measured range-ball data over premium-ball estimates where appropriate, with a documented deterministic per-shot missing-measurement policy. Changing the display basis must never silently alter club identity, intent or contact classification.
4. **Rollout policy.** Database-first release discipline **and** client/database version compatibility (both).
5. **Progressive evidence levels, not a hard visit gate.** <10 eligible shots: raw measurements, usually no numerical rating. 10–19: early provisional estimates. 20–29: more informative provisional ratings. 30+ shots across ≥3 visits: better-supported ratings. Categories may have different minimums where justified; multiple visits strengthen evidence rather than block early ratings (40 balls with a new club in one session is useful). Sample sufficiency is never presented as statistical validation.
6. **Directional control.** Corridor-based / lateral-error measures where the export supports them, accounting for club role, shot distance and measurement compatibility. Launch-direction control is shown separately when finishing-position data is unavailable — never silently substituted as equivalent. Curvature alone is never landing dispersion.

**Purpose of ratings.** Help the golfer see which clubs they perform well with, which to practise more, which aspects need work, whether they have distance potential but poor reliability, and whether they underperform relative to reasonable expectations. Overall score displayed on Overview beside each club's main statistics; tapping the club/score reveals the four category ratings as compact bars; methodology on demand only.

**Benchmarks stay optional.** Three reference concepts, clearly distinguished: (1) compatible external golfer benchmarks when available; (2) user-defined personal goals/references; (3) automatically derived historical personal potential (shows attainment of previously demonstrated ability, not comparison with other golfers). Consistency, direction and reliability ratings must be useful without any external benchmark or manually entered target. Provisional composites with missing dimensions must show coverage/weighting and must not be ranked against composites with materially different category sets. Personal references are never mandatory setup. External numerical benchmarking remains an active objective.

**Classification.** Manual review stays optional; useful descriptive analytics from the first imported session; abstention must not make the app unusable for new golfers. Club identity, intent and contact stay independent. Sequence context applies to poor shots too — a very short mishit between confirmed 7i blocks may still be a 7i shot; never infer identities only for well-struck shots (that would bias reliability estimates). Chronological sorting must be deterministic without treating arbitrary session-id order as real-world chronology. Real-world evaluation stays lightweight, opt-in and independent of normal use. Distinguish synthetic test correctness, real-world evaluation results and unvalidated product assumptions.

**Visuals.** Mobile-first; compact club cards; expandable metrics; minimal permanently visible text; show the result first, explain on request; no unnecessary dashboards or configuration steps. Reevaluate whether Review needs a permanent primary tab once automatic classification is reliable enough.

**Approval scope.** A9, A10 and A1–A4 are approved to start in dependency order, then A5–A8 and A11 in small PRs. C3 requires the owner to review proposed normalization functions, tolerance anchors, missing-data policy and illustrative scores for several clubs first. Classification and scoring methodology keep separate versioning. Guiding direction: useful and intuitive, appropriately qualified analytics for a normal golfer — not maximum statistical conservatism.

---

## 13.7 Remediation progress — updated 2026-11-25 (PRs #76–#88)

Status of the §13.5 consolidated plan after the first implementation wave. PR numbers are the reviewable units. All PRs below have since landed on main (through #91) — see §13.8 for the current status and remaining work.

| Item | Status | PR | Notes |
| --- | --- | --- | --- |
| A9 reference persistence fixes | merged | #76 | Revision-checked delete, aligned 1000-row write/restore limit, DB rejects `?`/`unknown`/`--` labels, Settings emptiness check. |
| A10 rollout compatibility | merged | #77 | Tolerant snapshot load for pre-migration RPC; `docs/database.md` compatibility matrix + database-first rule. |
| A1 manual precedence over suspicion | merged | #78 | Manual confirm/correct clears `suspectedWrongClub`; Review badge explains reviewed-but-flagged rows. |
| A2 append-stable sequence (`sequence-2`) | merged | #79 | Per-visit anchored windows; total chronological order; append-future and permutation invariance tests. |
| A3 independent intent/contact (`intent-contact-3`) | merged | #80 | Flight signals (launch/apex/carry-share), wedge partial rule incl. PW, recorded-target evidence, inferred-club assessment, unknown clubs never full swings. |
| A4 sequence evidence quality | merged | #81 | Min sample on the actual profile source, tie abstention, self-block exclusion, poor-strike inference, advisory tier. |
| A5 one benchmark eligibility rule | merged | #82 | Shared `clubBenchmarkEligible` + per-visit cap over eligible shots only. |
| A6 one mode-invariant P80 | merged | #82 | P80 from the eligible cohort, invariant under performance mode; wedge practice / progress / Analysis aligned. |
| A7 canonical assessment basis | merged | #83 | Classification reads range-preferred canonical values per shot; display-basis switches never reclassify; strong mode no longer silently applies the mishit filter; targeted-partial target evidence. |
| A8 denominators and provenance | merged | #84 | `unassessedResolved` vs manual-only `unassessed` documented; `missing` computed over the pre-filter population; zero carries are missing, never best/P80; best-shot mishit labelled confirmed vs auto-flagged; suspected outliers cannot be the personal best. |
| A11 performance | merged | #85 | Per-club chronological baseline index (12k shots ≈ 0.4 s cold, was ≈ 2.3 s at 3k); basis-independent resolve cache; `npm run verify:performance`. |
| B1 evaluation contract | merged | #86 | Abstentions by truth class, end-to-end recall (abstained positives count as misses), per-task reporting (missing-label / wrong-label / intent-contact), reversal invariance. |
| B2 real-world pilot harness | merged | #86 | `npm run verify:realworld` — opt-in, local-only, labelled-subset scoring of real exports; no data committed. |
| C1 reference metadata | merged | #87 | `basis` (range/premium/unknown) + `source` on reference values; legacy rows default to unknown/manual and stay valid; validator-only migration. |
| C2 reference comparisons | merged | #88 | Typical and strong-strike (P80) vs reference with delta, % and compact bars; basis-compatible gating only; total references never compared with carry. |
| C3 normalized ratings (ADR-0005) | **blocked on owner review** | #90 (v1), v2 pending | Weights 20/25/30/25 approved as provisional versioned constants. ADR-0005 v1 landed as a proposal (#90); the owner's 2026-11-25 feedback approved the architecture and revised the formulas — see `docs/adr/0005-ratings-proposal.md` (v2) and `docs/adr/adr-0005-illustrative-scores.mjs`. Implementation still waits for owner review of the revised methodology; raw-metric standings remain until the replacement lands (decision 2). |
| D1 external numerical benchmarks | deferred | — | No researched source permits embedding its dataset; link-only registry retained and documented as a reference resource, not the completed feature. Personal references are the functional alternative. Re-verify licensing independently before any future embedding. |
| D2 visual simplification | partially started | — | Methodology already behind `<details>` disclosures on club profiles. Remaining: early cleanup pass over existing pages, then rating/comparison visuals integrated as C2/C3 land. Mobile-first, show-first. |

§13.4 items 1–12 and 17–19 are addressed by the PRs above (item → PR: 1→#78, 2→#79, 3→#81, 4→#81, 5→#80, 6→#80, 7→#79, 8→#82, 9→#82, 10→#83, 11→#84, 12→#84, 13→#76, 14→#76, 15→#77, 16→#86, 17→#85, 18→C3 pending, 19→#87/#88). Item 20 (real-world accuracy) is partially addressed by the B2 harness but remains **unevaluated** — no real-export accuracy claims are made anywhere.

---

## 13.8 Status after PRs through #91 and ADR-0005 v2 — 2026-11-25

All §13.7 items marked merged are on main (A9→#76, A10→#77, A1→#78, A2→#79, A3→#80, A4→#81, A5/A6→#82, A7→#83, A8→#84, A11→#85, B1/B2→#86, C1→#87, C2→#88, plus #89 roadmap tracking, #90 ADR-0005 v1, #91 sequence-window index fix). §13.4 items 1–12 and 17–19 are addressed; item 20 (real-world accuracy) remains unevaluated.

- **C3 — implemented after owner acceptance of ADR-0005 v2 (PRs #94, #95, #96).** Owner feedback of 2026-11-25 approved the architecture (four 0–100 category ratings, composite, provisional 20/25/30/25 weights, progressive evidence levels, no mandatory three-visit gate, optional personal benchmarks, automatic historical personal potential as a distinct labelled reference, removal of raw-metric standings, Overview placement with expandable breakdown, separately versioned methodologies) and revised the formulas: capped target-attainment distance (`min(100, 100 × P80/reference)`), forgiving role-based relative-IQR consistency anchors (5/30% driver-woods, 4/25% hybrids-irons and wedges — product constants, pending sensitivity review), acceptable-strike reliability (`100 × (1 − mishitShare)`), P80 absolute lateral error for direction with launch direction separate and curvature never dispersion, a separate fixed premium-flat rating measurement basis (classification stays on the canonical range-preferred basis; range and premium never pooled; display switches change neither), per-category ratings without mandatory setup, provisional composites flagged with coverage and never ranked against different coverage, and a leave-the-evaluated-window-out guard on the historical personal potential reference. Revised proposal accepted: `docs/adr/0005-ratings-proposal.md` (v2); reproducible illustrative scores: `docs/adr/adr-0005-illustrative-scores.mjs`. Implementation: **#94** `ratings-2` domain module as the single calculation source shared with the docs fixture, regression-tested against ADR §8; **#95** reference rating metadata (type/statistic/date/equipment identity) + validator-only migration; **#96** ratings UI on Overview club rows and club profiles with the ADR-0004 raw-metric standings removed. Formulas, anchors and weights remain provisional until the owner evaluates the actual ratings on their own data.
- **Evaluation contract (B1/B2) — remaining limitations.** The harness in `app/src/domain/evaluation.ts` is complete as a harness: abstentions by truth class, end-to-end recall (abstained positives count as misses), per-task reporting (intent-contact / missing-label / wrong-label), reversal invariance, and both the raw automatic layers and the resolved production view scored. A completed harness is **not** real-world classifier validation: B2 (`npm run verify:realworld`) remains opt-in, local-only and unevaluated, and no real-export accuracy claims are made anywhere. Remaining gaps: per-class recall is derivable from the per-label TP/FP/FN rows but not surfaced as a headline per-class recall field; the separate inference tasks are reported per scenario but not yet aggregated over a labelled corpus; parity is checked against the resolved view in the same process, not against an independent production pipeline run.
- **Reference metadata — remaining requirements (C1 follow-up).** Reference records now carry `metric` (carry|total), exact `basis` (four bases + `unknown`) and `source` (#87). Still missing for full reference governance: reference **type** (goal vs observed vs historical personal potential), **statistic** (median / P80 / …), **date**, **equipment identity**, and an explicit **exact-vs-family-level** basis-match flag (family matching exists in `referenceBasisCompatible` but is not labelled on the record). Required before C3 consumes references for ratings.
- **D2 visual simplification** — methodology disclosures are behind `<details>` on club profiles; the early cleanup pass over existing pages and the final scoring UI remain, and the scoring UI waits on C3.
- **D1 external numerical benchmarks** — deferred (link-only registry, licensing); remains an active objective. Re-verify licensing independently before any future embedding.

### 13.8.1 C3 progress — ratings domain module (branch `feat/ratings-domain`)

`app/src/domain/ratings.ts` (`ratings-2`, `rating-basis-1`) is now the single calculation source for the accepted ADR-0005 formulas: capped target-attainment distance, role-anchored relative-IQR consistency, P80-lateral direction (launch display-only, never in the composite), acceptable-strike reliability with Wilson (sampling-only) + full-population missingness sensitivity, renormalized provisional composites (min 2 categories), progressive evidence levels (≥30 in 1–2 visits = provisional-high-sample), fixed premium-flat rating basis with no range substitution, and reference resolution across personal goal / historical personal potential (robust per-session-P80 percentile, leave-evaluated-window-out) / external benchmark. The docs fixture `docs/adr/adr-0005-illustrative-scores.mjs` imports this module, and `ratings.test.ts` regression-tests the ADR §8 illustrative values plus missing coverage, no-reference, reference types, club roles, partial PW, severe mishits, single-session clubs, basis independence and historical-reference stability by executing the fixture against the module. Reference-metadata extension and Overview/club-profile rating UI follow in separate PRs.

### 13.8.2 C3 progress — ratings UI (branch `feat/ratings-ui`, stacked on #94/#95)

Overview club rows now show the composite `ratings-2` rating chip (dashed-outline "prov n/4" marker for provisional composites); expanding a club reveals the four category bars with measurements and reference context, methodology behind a disclosure. Club profiles show the same chip and breakdown and the ADR-0004 raw-metric within-bag standings are removed (`standings.ts` deleted; raw measurements retained in `category-scores-1`). Ratings are computed on the fixed premium-flat rating basis regardless of the display basis. New `ClubRating.tsx` component + styles. Verified: `npm test` 337 passed, typecheck/lint/build clean. E2E (`npm run test:e2e`) not run — no Playwright browsers/local Supabase in this environment.
