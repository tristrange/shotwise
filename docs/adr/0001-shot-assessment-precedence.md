# ADR-0001: Shot assessment model and automatic-vs-manual precedence

Status: accepted (audit + policy; implementation follows in later PRs)
Date: 2026-11-24
Related: `docs/ROADMAP.md` §5, §9

## Context — audit of the current state

Existing pieces (all in `app/src/domain/`):

| Mechanism | File | Role today |
|---|---|---|
| `reviewSchema` / `initialReview` | `model.ts` | Manual per-shot review: intent (`full`/`partial`/`unknown`), contact (`typical`/`mishit`/`uncertain`), club decision (`unreviewed`/`confirmed`/`corrected`), exclusion. `unknown`/`uncertain` mean "not manually assessed". |
| `ReviewEvent` + `revision` | `model.ts`, `data/repository.ts` | Audit trail, undo, optimistic-concurrency conflicts. |
| `effectiveClub()` | `model.ts` | Manual correction wins over the recorded label. |
| `fullSwingCandidate()` | `model.ts` | Eligibility: explicit `full` intent, or `unknown` intent on a non-wedge (PW included since #58). |
| `recapCohorts` | `recap.ts` | reliability / broader / reviewed cohorts used by recap and club profiles. |
| `assessUnusualShots()` (`low-flight-3`) | `unusualShots.ts` | Experimental per-shot "unusual low-flight" flag used only by the Hide-likely-mishits filter. Explicitly never a contact/intent classification. |
| Club-correction preview/apply | `clubCorrection.ts`, `ShotReview.tsx` | Batched, revision-pinned manual club corrections. |
| Equipment assignment | `equipment.ts` | Maps Inrange labels to bag equipment; orthogonal to classification. |

Gaps this ADR addresses:

1. There is **no automatic default layer**: unreviewed shots fall back to
   `unknown`/`uncertain`, so analytics either include everything or exclude
   wedges entirely. Roadmap §5 wants import → useful analytics with no manual
   review.
2. There is **no sequence-aware inference** (roadmap §5.4, owner's emphasis):
   consecutive same-club runs, forgotten tablet switches and unknown blocks are
   invisible to the per-shot rules above.
3. There is **no provenance or versioning** for assessments, so a future
   classifier cannot be introduced without disturbing existing manual decisions.

## Decision

Introduce a **shot assessment model** with explicit precedence. The original
CSV row, recorded club label and raw measurements stay immutable; assessments
are a separate interpretation layer.

### Precedence (highest first)

1. **Manual review** (`shot.review.*`, changes audited via `ReviewEvent`).
   Always authoritative and reversible.
2. **Automatic assessment** from a *versioned* classifier
   (`classifierVersion` recorded with each assessment; labels, not numeric
   confidence — roadmap §5.6).
3. **Recorded/default**: the Inrange recorded club and the current
   `unknown`/`uncertain` defaults.

The three dimensions stay independent (roadmap §5.2): a partial shot can be a
typical strike; a mishit can have the correct club.

### Club identity resolution

`resolveClub()` in `app/src/domain/assessment.ts`:

- `corrected` → the corrected club, provenance `confirmed` (manual).
- `confirmed` → the recorded club, provenance `confirmed` (manual).
- otherwise, a high-confidence **inferred** club may be shown as
  `provisional: true` — always distinguishable from a confirmed assignment and
  never written back over the recorded label.
- otherwise → the recorded club, provenance `recorded`.

`effectiveClub()` remains the manual-only view used by persistence and review
UI; analytics that adopt the automatic layer use the resolved assessment.

### Safeguards (from roadmap §5.4/§9, owner's emphasis)

- Never silently overwrite recorded or manually corrected clubs.
- Sequence-aware inference is central, but must learn/allow different practice
  patterns (not a hard-coded 10-balls-per-club rule).
- Suspected wrong-club shots may be excluded from club benchmarks or marked
  provisionally unassigned under a documented policy — never silently
  reassigned.
- Exclusion stays an independent dimension.
- Classifier upgrades keep old manual decisions stable; new classifier versions
  are comparable via the recorded `classifierVersion`.

## Consequences

- PR 8+ can add automatic intent/contact assessment and sequence inference
  behind `assessment.ts` without touching persistence schemas: assessments are
  derived, not stored (initially), so backups and RLS are unaffected.
- If persisted assessments are later needed, add optional columns/tables with
  `provenance` + `classifierVersion`; manual review precedence is preserved by
  construction.
- `unusualShots.ts` stays a review aid; the automatic layer will subsume it
  behind the versioned classifier.
