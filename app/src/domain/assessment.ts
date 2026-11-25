import { assessShots, CLASSIFIER_VERSION, type ShotAssessment } from './classify';
import {
  effectiveClub,
  isPitchingWedge,
  isUnknownClub,
  isWedge,
  type Basis,
  type Review,
  type Session,
  type Shot,
} from './model';
import { assessSequences, SEQUENCE_RULE_VERSION } from './sequence';

/**
 * Resolution policy for shot assessments (ADR-0001). Pure functions: the
 * original shot and its review are never modified. Manual review always wins
 * over an automatic assessment, which wins over the recorded default.
 */

/** Combined version of the automatic layers behind {@link resolveShots}. */
export const ASSESSMENT_VERSION = `${CLASSIFIER_VERSION}+${SEQUENCE_RULE_VERSION}`;

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

/**
 * A shot with every assessment dimension resolved through the ADR-0001
 * precedence chain: manual review, then the versioned automatic assessment,
 * then the recorded default. `suspectedWrongClub` marks shots whose recorded
 * label a sequence rule suspects is wrong; the recorded label is kept and the
 * shot is excluded from club-specific benchmarks, never reassigned. A manual
 * club confirmation or correction is authoritative: it clears
 * `suspectedWrongClub` for eligibility, while the automatic observation stays
 * available as `suspicion` for diagnostics.
 */
export type ResolvedShot = {
  shot: Shot;
  intent: IntentAssessment;
  contact: ContactAssessment;
  club: ClubAssessment;
  suspectedWrongClub: boolean;
  /** The automatic wrong-club observation, kept even when manual review wins. */
  suspicion: {
    suspectedClub: string;
    evidence: number;
    strength: 'strong' | 'advisory';
    reason: string;
  } | null;
  automatic: ShotAssessment | undefined;
  assessmentVersion: typeof ASSESSMENT_VERSION;
};

/** The club a resolved shot groups under in analytics. */
export function resolvedClub(resolved: ResolvedShot): string {
  return analysisClub(resolved.club);
}

/**
 * Resolved version of `fullSwingCandidate()` (model.ts): explicit full intent
 * wins; otherwise an unresolved intent falls back to the club heuristic, now
 * evaluated on the resolved club so provisional inferences count. An
 * unresolved unknown club is never assumed to be a full swing — several
 * benchmark consumers add the same known-club check, this makes it uniform.
 */
export function isFullSwingResolved(resolved: ResolvedShot): boolean {
  if (resolved.intent === 'full') return true;
  if (resolved.intent !== 'unknown') return false;
  const club = resolvedClub(resolved);
  if (isUnknownClub(club)) return false;
  return !isWedge(club) || isPitchingWedge(club);
}

type CacheEntry = {
  sessions: Session[];
  length: number;
  resolved: Map<string, ResolvedShot>;
};
const resolveCache = new WeakMap<Shot[], CacheEntry>();

/**
 * Resolve every shot's intent, contact and club through the precedence chain,
 * combining the per-shot classifier (`intent-contact-3`) with sequence-aware
 * club inference (`sequence-2`). Results are cached per shots/sessions
 * identity — callers may invoke this freely. The basis argument is display
 * context only: classification runs on the canonical assessment basis, so the
 * cache deliberately ignores it and alternating display bases never thrash.
 * Assessments stay derived: the shot and its review are never modified.
 */
export function resolveShots(
  shots: Shot[],
  sessions: Session[],
  basis: Basis = 'premium-flat',
): Map<string, ResolvedShot> {
  const cached = resolveCache.get(shots);
  if (cached && cached.sessions === sessions && cached.length === shots.length)
    return cached.resolved;
  // Sequence inference runs first so provisional club identities can feed the
  // per-shot intent/contact assessment (intent-contact-3). Manual decisions
  // still win inside both layers.
  const sequences = assessSequences(shots, sessions, basis);
  const inferredClubs = new Map<string, string>();
  for (const [id, assessment] of sequences) {
    if (assessment.kind === 'inferred-club') inferredClubs.set(id, assessment.club);
  }
  const automatic = assessShots(shots, sessions, basis, inferredClubs);
  const resolved = new Map<string, ResolvedShot>();
  for (const shot of shots) {
    const auto = automatic.get(shot.id);
    const sequence = sequences.get(shot.id);
    const suspicion =
      sequence?.kind === 'suspected-wrong-club'
        ? {
            suspectedClub: sequence.suspectedClub,
            evidence: sequence.evidence,
            strength: sequence.strength,
            reason: sequence.reason,
          }
        : null;
    // ADR-0001: a manual club confirm/correct wins over the automatic
    // suspicion — the shot stays eligible for club benchmarks. Only
    // exclusion-grade ('strong') suspicions remove unreviewed shots.
    const manualClubDecision = shot.review.club.kind !== 'unreviewed';
    resolved.set(shot.id, {
      shot,
      intent: resolveIntent(shot.review.intent, auto?.intent.value),
      contact: resolveContact(shot.review.contact, auto?.contact.value),
      club: resolveClub(shot, inferredClubs.get(shot.id)),
      suspectedWrongClub:
        suspicion !== null &&
        suspicion.strength === 'strong' &&
        !manualClubDecision,
      suspicion,
      automatic: auto,
      assessmentVersion: ASSESSMENT_VERSION,
    });
  }
  resolveCache.set(shots, { sessions, length: shots.length, resolved });
  return resolved;
}
