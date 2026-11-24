import { effectiveClub, isUnknownClub, type Review, type Shot } from './model';

/**
 * Resolution policy for shot assessments (ADR-0001). Pure functions: the
 * original shot and its review are never modified. Manual review always wins
 * over an automatic assessment, which wins over the recorded default.
 */

/** Version of the automatic classifier that produced an assessment. */
export const CLASSIFIER_VERSION = 'none';

export type IntentAssessment = Review['intent'];
export type ContactAssessment = Review['contact'];

export type ClubAssessment =
  | { kind: 'recorded'; club: string; provenance: 'recorded' }
  | { kind: 'inferred'; club: string; provenance: 'automatic'; provisional: true }
  | { kind: 'confirmed'; club: string; provenance: 'manual' };

/** Manual intent when assessed; otherwise the automatic one; otherwise unknown. */
export function resolveIntent(
  review: Review['intent'],
  automatic?: IntentAssessment,
): IntentAssessment {
  if (review !== 'unknown') return review;
  return automatic ?? 'unknown';
}

/** Manual contact when assessed; otherwise the automatic one; otherwise uncertain. */
export function resolveContact(
  review: Review['contact'],
  automatic?: ContactAssessment,
): ContactAssessment {
  if (review !== 'uncertain') return review;
  return automatic ?? 'uncertain';
}

/**
 * Club identity for analytics: a manual correction or confirmation wins; an
 * inferred club is provisional and never replaces the recorded label; the
 * recorded label is the fallback. Unknown inferred clubs are ignored.
 */
export function resolveClub(shot: Shot, inferred?: string): ClubAssessment {
  const decision = shot.review.club;
  if (decision.kind === 'corrected')
    return { kind: 'confirmed', club: decision.club, provenance: 'manual' };
  if (decision.kind === 'confirmed')
    return { kind: 'confirmed', club: shot.recordedClub, provenance: 'manual' };
  if (inferred && !isUnknownClub(inferred))
    return {
      kind: 'inferred',
      club: inferred,
      provenance: 'automatic',
      provisional: true,
    };
  return {
    kind: 'recorded',
    club: effectiveClub(shot),
    provenance: 'recorded',
  };
}

/** The club to group a shot under, given the resolved assessment. */
export function analysisClub(assessment: ClubAssessment): string {
  return assessment.club;
}
