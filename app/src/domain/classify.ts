import { quantile } from './statistics';
import {
  assessmentMeasurement,
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
 *
 * intent-contact-3: intent and contact are decided independently. Contact uses
 * carry, ball speed and — where measured — launch, apex and the carry-to-total
 * share, so a severe low-launch mishit with retained ball speed is still caught.
 * Intent for wedges (including PW) distinguishes likely partials from full
 * swings using carry relative to the baseline and flight height; a low-flight
 * short shot is not called a partial. Club identity is resolved first (manual,
 * then provisional sequence inference, then the recorded label), so inferred
 * clubs receive club-specific assessments.
 */
export const CLASSIFIER_VERSION = 'intent-contact-3';

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
/** A shot this far below the recent upper-quartile carry looks like a mishit. */
const MISHIT_CARRY_FACTOR = 0.65;
const MISHIT_SPEED_FACTOR = 0.8;
/** A wedge this far below its typical carry looks like intentional distance control. */
const PARTIAL_CARRY_FACTOR = 0.7;
/** Launch this many degrees below the recent median counts as low flight. */
const LOW_LAUNCH_DROP_DEG = 4;
/** Apex this far below the recent median counts as low flight. */
const LOW_APEX_FACTOR = 0.6;
/** Carry-to-total share this far below the recent median counts as a ground ball. */
const LOW_CARRY_SHARE_FACTOR = 0.85;

type Signals = {
  carry: number | null;
  speed: number | null;
  launch: number | null;
  apex: number | null;
  total: number | null;
};

type Baseline = {
  n: number;
  carryMedian: number | null;
  carryP75: number | null;
  speedP75: number | null;
  launchMedian: number | null;
  apexMedian: number | null;
  /** Median carry / total share of the baseline — ground-ball corroboration. */
  carryShareMedian: number | null;
};

/**
 * Total chronological order for visits: date, then recorded start time with
 * missing times ordered first ('' sorts before any HH:MM), then session id
 * purely as a deterministic tiebreak — the id is not evidence of real-world
 * chronology. Missing times must order consistently (not "tie") so the
 * comparator stays transitive when known and unknown times mix; the
 * same-day eligibility rules that require a known, earlier time are applied
 * separately as filters.
 */
function compareSessionStarts(a: Session, b: Session): number {
  return (
    a.date.localeCompare(b.date) ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Club identity for assessment: a manual correction or confirmation wins, then
 * a provisional sequence inference, then the recorded label. Mirrors
 * resolveClub in assessment.ts (kept local to avoid a module cycle).
 */
function assessmentClubOf(
  shot: Shot,
  inferred: Map<string, string> | undefined,
): string {
  const decision = shot.review.club;
  if (decision.kind === 'corrected') return decision.club;
  if (decision.kind === 'confirmed') return shot.recordedClub;
  return inferred?.get(shot.id) ?? shot.recordedClub;
}

/**
 * Causal baseline for one shot: earlier included shots of the same resolved
 * club with positive carry and speed, excluding reviewed mishits
 * and partials so incorrect labels cannot reinforce themselves. Same-day other
 * visits count only when their recorded start time is unambiguously earlier.
 */
function baselineBefore(
  shot: Shot,
  shots: Shot[],
  sessionMap: Map<string, Session>,
  inferred: Map<string, string> | undefined,
  club: string,
): Baseline | null {
  const shotSession = sessionMap.get(shot.sessionId);
  const shotDate = shotSession?.date;
  if (!shotDate) return null;
  const cutoff = shiftDate(shotDate, -RECENT_DAYS);
  const candidates = shots
    .filter((s) => {
      if (s.id === shot.id) return false;
      const session = sessionMap.get(s.sessionId);
      if (!session || session.archived) return false;
      if (session.date < cutoff || session.date > shotDate) return false;
      if (session.date === shotDate && session.id !== shot.sessionId) {
        if (
          !(
            session.time !== null &&
            shotSession.time !== null &&
            session.time < shotSession.time
          )
        )
          return false;
      }
      if (s.sessionId === shot.sessionId && s.rowIndex >= shot.rowIndex) return false;
      if (assessmentClubOf(s, inferred) !== club) return false;
      if (s.review.exclusion.kind !== 'included') return false;
      if (s.review.contact === 'mishit' || s.review.intent === 'partial') return false;
      const carry = assessmentMeasurement(s, 'carry');
      const speed = assessmentMeasurement(s, 'speed');
      return carry !== null && speed !== null && carry > 0 && speed > 0;
    })
    .sort((a, b) => {
      const sa = sessionMap.get(a.sessionId);
      const sb = sessionMap.get(b.sessionId);
      if (!sa || !sb) return 0;
      // Total order makes the BASELINE_CAP cutoff independent of input order.
      return compareSessionStarts(sb, sa) || b.rowIndex - a.rowIndex;
    })
    .slice(0, BASELINE_CAP);
  const carries = candidates.flatMap((s) => assessmentMeasurement(s, 'carry') ?? []);
  const speeds = candidates.flatMap((s) => assessmentMeasurement(s, 'speed') ?? []);
  const launches = candidates.flatMap((s) => assessmentMeasurement(s, 'launch') ?? []);
  const apexes = candidates.flatMap((s) => assessmentMeasurement(s, 'apex') ?? []);
  const carryShares = candidates.flatMap((s) => {
    const carry = assessmentMeasurement(s, 'carry');
    const total = assessmentMeasurement(s, 'total');
    return carry !== null && total !== null && total > 0 ? [carry / total] : [];
  });
  return {
    n: candidates.length,
    carryMedian: quantile(carries, 0.5),
    carryP75: quantile(carries, 0.75),
    speedP75: quantile(speeds, 0.75),
    launchMedian: launches.length >= 5 ? quantile(launches, 0.5) : null,
    apexMedian: apexes.length >= 5 ? quantile(apexes, 0.5) : null,
    carryShareMedian: carryShares.length >= 5 ? quantile(carryShares, 0.5) : null,
  };
}

/** Low-flight corroboration from launch and apex where measured. */
function lowFlight(s: Signals, base: Baseline): boolean {
  const lowLaunch =
    s.launch !== null &&
    base.launchMedian !== null &&
    s.launch < base.launchMedian - LOW_LAUNCH_DROP_DEG;
  // A deliberate partial naturally flies lower: scale the apex floor by the
  // carry ratio so a clean short wedge is not read as a low-flight mishit.
  const carryRatio =
    s.carry !== null && base.carryMedian !== null && base.carryMedian > 0
      ? Math.min(1, s.carry / base.carryMedian)
      : 1;
  const apexFloor =
    base.apexMedian !== null ? LOW_APEX_FACTOR * base.apexMedian * carryRatio : null;
  const lowApex = s.apex !== null && apexFloor !== null && s.apex < apexFloor;
  return lowLaunch || lowApex;
}

/**
 * Contact from independent signals: a mishit needs a low carry corroborated by
 * low speed, low flight or a low carry-to-total share — a low-launch strike
 * with retained ball speed is still caught, and a normal shot is never flagged
 * on one weak signal alone.
 */
function contactFor(
  s: Signals,
  base: Baseline,
  club: string,
): { value: ContactValue; reason: string } {
  if (s.carry === null || s.speed === null || s.carry <= 0 || s.speed <= 0)
    return { value: 'uncertain', reason: 'Needs positive carry and ball speed.' };
  const carryLow =
    base.carryP75 !== null && s.carry < MISHIT_CARRY_FACTOR * base.carryP75;
  const speedLow =
    base.speedP75 !== null && s.speed < MISHIT_SPEED_FACTOR * base.speedP75;
  const lowShare =
    s.total !== null &&
    s.total > 0 &&
    base.carryShareMedian !== null &&
    s.carry / s.total < LOW_CARRY_SHARE_FACTOR * base.carryShareMedian;
  if (carryLow && (speedLow || lowFlight(s, base) || lowShare)) {
    const why = [
      speedLow ? 'low ball speed' : null,
      lowFlight(s, base) ? 'low launch/apex' : null,
      lowShare ? 'low carry share of total' : null,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      value: 'mishit',
      reason: `Carry ${s.carry.toFixed(0)} m is far below the recent ${club} upper range with ${why} — likely mishit.`,
    };
  }
  return {
    value: 'typical',
    reason: `Within the recent ${club} carry, speed and flight range.`,
  };
}

/**
 * Intent, independent of contact. Wedges (including PW) are partial when carry
 * is well below the recent median and the flight is not low — a short,
 * low-flight shot is a full-swing mishit, not a partial. Non-wedges are full
 * swings unless reviewed otherwise.
 */
function intentFor(
  club: string,
  s: Signals,
  base: Baseline,
): { value: IntentValue; reason: string } {
  if (!isWedge(club))
    return { value: 'full', reason: 'Non-wedge shots are treated as full swings unless reviewed otherwise.' };
  if (s.carry === null || base.carryMedian === null)
    return { value: 'unknown', reason: 'Needs measured carry to judge wedge intent.' };
  if (
    s.carry < PARTIAL_CARRY_FACTOR * base.carryMedian &&
    !lowFlight(s, base)
  )
    return {
      value: 'partial',
      reason: `Carry ${s.carry.toFixed(0)} m is well below the recent ${club} median ${base.carryMedian.toFixed(0)} m with normal flight — likely distance control.`,
    };
  return { value: 'full', reason: `Carry is near the recent ${club} median — likely a full wedge shot.` };
}

/**
 * Assess intent and contact for every shot. Dimensions stay independent:
 * a likely-partial wedge can be typical or a mishit; a mishit can have the
 * correct recorded club. `inferredClubs` carries provisional sequence
 * inferences (shot id → club) so unknown labels can be assessed against their
 * inferred club; manual decisions always win.
 */
export function assessShots(
  shots: Shot[],
  sessions: Session[],
  _basis: Basis = 'premium-flat',
  inferredClubs?: Map<string, string>,
): Map<string, ShotAssessment> {
  // _basis is the caller's display basis; classification itself uses the
  // canonical per-shot policy (assessmentMeasurement), so it never changes
  // when the display basis changes.
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const out = new Map<string, ShotAssessment>();

  for (const shot of shots) {
    const session = sessionMap.get(shot.sessionId);
    const club = assessmentClubOf(shot, inferredClubs);
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
    if (isUnknownClub(club)) {
      base.intent.reason = 'Club label is unknown; sequence inference may resolve it.';
      base.contact.reason = 'Club label is unknown; no baseline available.';
      out.set(shot.id, base);
      continue;
    }
    const baseline = baselineBefore(shot, shots, sessionMap, inferredClubs, club);
    if (
      !baseline ||
      baseline.n < MIN_BASELINE ||
      baseline.carryMedian === null ||
      baseline.carryP75 === null ||
      baseline.speedP75 === null
    ) {
      base.intent.reason = `Needs at least ${MIN_BASELINE} earlier ${club} shots with carry and speed.`;
      base.contact.reason = base.intent.reason;
      base.baselineCount = baseline?.n ?? 0;
      out.set(shot.id, base);
      continue;
    }
    base.baselineCount = baseline.n;
    const signals: Signals = {
      carry: assessmentMeasurement(shot, 'carry'),
      speed: assessmentMeasurement(shot, 'speed'),
      launch: assessmentMeasurement(shot, 'launch'),
      apex: assessmentMeasurement(shot, 'apex'),
      total: assessmentMeasurement(shot, 'total'),
    };
    // Recorded-target evidence: when the measured carry matches the recorded
    // target, the golfer almost certainly selected that distance — a targeted
    // wedge partial is intentional distance control, not a mishit.
    const target = shot.measurements.target;
    const targeted =
      isWedge(club) &&
      signals.carry !== null &&
      target !== null &&
      target > 0 &&
      Math.abs(signals.carry - target) <= Math.max(5, 0.1 * target);
    if (targeted) {
      base.intent = {
        value: 'partial',
        reason: `Carry ${signals.carry!.toFixed(0)} m matches the recorded target ${target.toFixed(0)} m — intentional distance control.`,
      };
      base.contact =
        signals.speed !== null && signals.speed > 0
          ? { value: 'typical', reason: 'Targeted partial with positive ball speed.' }
          : { value: 'uncertain', reason: 'Needs positive ball speed.' };
      out.set(shot.id, base);
      continue;
    }
    base.contact = contactFor(signals, baseline, club);
    base.intent = intentFor(club, signals, baseline);
    out.set(shot.id, base);
  }
  return out;
}
