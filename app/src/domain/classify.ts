import { quantile } from './statistics';
import {
  BASES,
  effectiveClub,
  isPitchingWedge,
  isUnknownClub,
  isWedge,
  shiftDate,
  type Basis,
  type Session,
  type Shot,
} from './model';

/**
 * Versioned automatic per-shot assessment (ADR-0001). Conservative by design:
 * every assessment carries a reason, and the classifier abstains when the
 * causal per-club baseline is too thin. Derived only — never persisted, never
 * overwrites recorded data or manual reviews (see assessment.ts precedence).
 */
export const CLASSIFIER_VERSION = 'intent-contact-1';

export type IntentValue = 'full' | 'partial' | 'unknown';
export type ContactValue = 'typical' | 'mishit' | 'uncertain';

export type ShotAssessment = {
  intent: { value: IntentValue; reason: string };
  contact: { value: ContactValue; reason: string };
  baselineCount: number;
  classifierVersion: typeof CLASSIFIER_VERSION;
};

/** Minimum earlier shots before the classifier assesses a club at all. */
const MIN_BASELINE = 10;
/** Baselines use a recent window relative to the shot, so improving golfers are not held back. */
const RECENT_DAYS = 60;
/** Cap the baseline at the most recent N earlier shots per club. */
const BASELINE_CAP = 50;
/** A shot this far below the recent upper-quartile carry+speed looks like a mishit. */
const MISHIT_CARRY_FACTOR = 0.65;
const MISHIT_SPEED_FACTOR = 0.8;
/** A wedge this far below its typical carry looks like intentional distance control. */
const PARTIAL_CARRY_FACTOR = 0.7;

type Baseline = {
  n: number;
  carryMedian: number | null;
  carryP75: number | null;
  speedP75: number | null;
};

/**
 * Causal baseline for one shot: earlier included shots of the same effective
 * club with positive carry and speed on this basis, excluding reviewed mishits
 * and partials so incorrect labels cannot reinforce themselves.
 */
function baselineBefore(
  shot: Shot,
  shots: Shot[],
  sessionMap: Map<string, Session>,
  basis: Basis,
): Baseline | null {
  const carryKey = BASES[basis].carry;
  const speedKey = BASES[basis].speed;
  const club = effectiveClub(shot);
  if (isUnknownClub(club)) return null;
  const shotDate = sessionMap.get(shot.sessionId)?.date;
  if (!shotDate) return null;
  const cutoff = shiftDate(shotDate, -RECENT_DAYS);
  const candidates = shots
    .filter((s) => {
      if (s.id === shot.id) return false;
      const session = sessionMap.get(s.sessionId);
      if (!session || session.archived) return false;
      if (session.date < cutoff || session.date > shotDate) return false;
      if (session.date === shotDate && session.id !== shot.sessionId) return false;
      if (s.sessionId === shot.sessionId && s.rowIndex >= shot.rowIndex) return false;
      if (effectiveClub(s) !== club) return false;
      if (s.review.exclusion.kind !== 'included') return false;
      if (s.review.contact === 'mishit' || s.review.intent === 'partial') return false;
      const carry = s.measurements[carryKey];
      const speed = s.measurements[speedKey];
      return carry !== null && speed !== null && carry > 0 && speed > 0;
    })
    .sort((a, b) => {
      const da = sessionMap.get(a.sessionId)?.date ?? '';
      const db = sessionMap.get(b.sessionId)?.date ?? '';
      return db.localeCompare(da) || b.rowIndex - a.rowIndex;
    })
    .slice(0, BASELINE_CAP);
  const carries = candidates.flatMap((s) => s.measurements[carryKey] ?? []);
  const speeds = candidates.flatMap((s) => s.measurements[speedKey] ?? []);
  return {
    n: candidates.length,
    carryMedian: quantile(carries, 0.5),
    carryP75: quantile(carries, 0.75),
    speedP75: quantile(speeds, 0.75),
  };
}

/**
 * Assess intent and contact for every shot. Dimensions stay independent:
 * a likely-partial wedge can still be a typical strike; a mishit can have the
 * correct recorded club.
 */
export function assessShots(
  shots: Shot[],
  sessions: Session[],
  basis: Basis = 'premium-flat',
): Map<string, ShotAssessment> {
  const carryKey = BASES[basis].carry;
  const speedKey = BASES[basis].speed;
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const out = new Map<string, ShotAssessment>();

  for (const shot of shots) {
    const session = sessionMap.get(shot.sessionId);
    const club = effectiveClub(shot);
    const base: ShotAssessment = {
      intent: { value: 'unknown', reason: '' },
      contact: { value: 'uncertain', reason: '' },
      baselineCount: 0,
      classifierVersion: CLASSIFIER_VERSION,
    };
    if (!session || session.archived || shot.review.exclusion.kind !== 'included') {
      base.intent.reason = 'Archived or excluded shots are not assessed.';
      base.contact.reason = 'Archived or excluded shots are not assessed.';
      out.set(shot.id, base);
      continue;
    }
    const baseline = baselineBefore(shot, shots, sessionMap, basis);
    if (
      !baseline ||
      baseline.n < MIN_BASELINE ||
      baseline.carryMedian === null ||
      baseline.carryP75 === null ||
      baseline.speedP75 === null
    ) {
      base.intent.reason = `Needs at least ${MIN_BASELINE} earlier ${isUnknownClub(club) ? 'known-club' : club} shots with carry and speed.`;
      base.contact.reason = base.intent.reason;
      base.baselineCount = baseline?.n ?? 0;
      out.set(shot.id, base);
      continue;
    }
    base.baselineCount = baseline.n;
    const carry = shot.measurements[carryKey];
    const speed = shot.measurements[speedKey];

    // Intent: higher wedges are often played partial; irons and PW are full.
    if (isWedge(club) && !isPitchingWedge(club)) {
      if (carry !== null && carry < PARTIAL_CARRY_FACTOR * baseline.carryMedian) {
        base.intent = {
          value: 'partial',
          reason: `Carry ${carry.toFixed(0)} m is well below the recent ${club} median ${baseline.carryMedian.toFixed(0)} m — likely distance control.`,
        };
        // A deliberate partial is not a mishit; keep contact independent but typical.
        base.contact = { value: 'typical', reason: 'A likely partial swing can still be well struck.' };
      } else {
        base.intent = { value: 'full', reason: `Carry is near the recent ${club} median — likely a full wedge shot.` };
        base.contact = contactFor(carry, speed, baseline, club);
      }
    } else if (isUnknownClub(club)) {
      base.intent.reason = 'Club label is unknown; sequence inference may resolve it.';
      base.contact.reason = 'Club label is unknown; no baseline available.';
    } else {
      base.intent = { value: 'full', reason: 'Non-wedge shots are treated as full swings unless reviewed otherwise.' };
      base.contact = contactFor(carry, speed, baseline, club);
    }
    out.set(shot.id, base);
  }
  return out;
}

function contactFor(
  carry: number | null,
  speed: number | null,
  baseline: Baseline,
  club: string,
): { value: ContactValue; reason: string } {
  if (carry === null || speed === null || carry <= 0 || speed <= 0)
    return { value: 'uncertain', reason: 'Needs positive carry and ball speed on this basis.' };
  if (
    baseline.carryP75 !== null &&
    baseline.speedP75 !== null &&
    carry < MISHIT_CARRY_FACTOR * baseline.carryP75 &&
    speed < MISHIT_SPEED_FACTOR * baseline.speedP75
  )
    return {
      value: 'mishit',
      reason: `Carry ${carry.toFixed(0)} m and speed ${speed.toFixed(0)} kph are both far below recent ${club} shots — likely mishit.`,
    };
  return { value: 'typical', reason: `Within the recent ${club} carry and speed range.` };
}
