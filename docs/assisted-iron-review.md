# Assisted iron review — experimental rule

The review queue helps someone find unusual shots after a long session without
claiming to remember their intent or diagnose contact. Club-label flags remain
separate. Only an explicit review changes intent, contact, club or exclusion;
existing revision checks, persistence and undo remain authoritative.

## Rule `low-iron-1`

- Assess included, non-archived shots with effective labels 2i–9i and uncertain
  contact. Known partial swings and mishits are ineligible. Confirming a club
  label does not constitute a contact decision.
- Require positive **range-flat carry and range ball speed**, on the same shot.
  Never substitute premium estimates or combine disjoint measurement samples.
- Use earlier shots with exactly the same effective club, excluding known partial
  swings, mishits, exclusions and archived sessions. Unknown intent and unreviewed
  contact remain included. Reviewed typical shots can contribute to the baseline.
- Earlier means an earlier date, an earlier source row in the same session, or a
  strictly earlier recorded time in a different session on the same date. Equal
  times and missing times cannot establish cross-session order. Import order,
  source shot numbers and UUID order do not establish chronology.
- Take evidence within 60 calendar days ending on the shot's session date. Target
  the latest 50 eligible earlier shots, retaining the whole cutoff date to avoid
  arbitrarily selecting between untimed sessions. Require at least 20 paired shots.
- Compute the median and median absolute deviation (MAD) separately for carry and
  speed, from that paired sample. The carry cutoff is the median minus the larger
  of `3 × 1.4826 × MAD` and `20% × median`. The speed cutoff uses `10% × median`
  instead. Flag only when **both** measurements are strictly below their cutoffs.
- Abstain for missing/nonpositive measurements, insufficient history, zero MAD,
  or nonpositive cutoffs. No flag is not a contact-quality assessment.

The percentage floors avoid highlighting tiny absolute deviations in narrowly
clustered measurements. The multiplier and floors are provisional conservative
choices, not calibrated false-positive rates or a validated contact classifier.
A recorded typical/mishit contact decision or partial-swing intent removes the
advisory flag; undo makes the shot eligible again when appropriate.

## Local evaluation

Run `npm run verify:unusual -- /absolute/path/to/exports` from `app/`. The script
uses the real parser and rule, checks byte/shot preservation, input-order
independence and earlier-assessment invariance when adding later sessions. It
prints aggregate counts only and never writes exports or connects to a database.
Filename dates are assumed solely for this check; the import flow still requires
the user to confirm session dates.

On 17 November 2026, five supplied exports parsed without warnings: 517 shots,
including 282 eligible irons. The final rule assessed 172, abstained on 110 and
flagged seven. An exploratory comparison of 15/20/30-shot minimums and 3/4-scaled-MAD
cutoffs showed sensitivity to these choices: with a 20-shot minimum, the stricter
4-scaled-MAD version flagged four shots. That comparison used a strict 50-shot
cap; the production rule retains cutoff-date ties. No personal rows, filenames,
measurements or exports are fixtures or committed artifacts.

There are no independently labelled contact or intent outcomes in these exports.
Counts establish coverage and candidate behavior, not precision, recall, useful
practice advice or a distinction between mishits and intentional partial swings.
Unknown-intent baseline shots can themselves include partial swings; robust
statistics reduce some contamination but cannot solve that ambiguity. Check
flags with the player before relying on their usefulness. Zero-MAD and highly
variable baselines can hide real unusual shots through deliberate abstention.

## Verification boundaries

The agreed public boundaries are the pure assessment function and the browser
review flow. Unit tests cover joint low values, thresholds, paired missingness,
chronology, limited history, effective clubs, review eligibility and abstention.
Browser tests use synthetic CSVs through local Auth and the real repository,
show evidence, save an explicit contact decision, and undo it while retaining
original shot data. No database schema or persistence contract changes are needed.
