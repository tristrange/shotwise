import { quantile } from './statistics';
import {
  clubOrder,
  effectiveClub,
  shiftDate,
  type Session,
  type Shot,
} from './model';

export const UNUSUAL_SHOT_RULE = 'low-flight-2';
export type UnusualShotAssessment =
  | { kind: 'abstained'; reason: string; baselineCount: number }
  | {
      kind: 'assessed';
      unusual: boolean;
      baselineCount: number;
      sessions: number;
      carry: number;
      speed: number;
      carryMedian: number;
      speedMedian: number;
      carryReference: number;
      speedReference: number;
      carryThreshold: number;
      speedThreshold: number;
      ruleVersion: string;
    };

/** Experimental low-flight review aid; never a contact or intent classification. */
export function assessUnusualShots(shots: Shot[], sessions: Session[]) {
  const active = new Map(
    sessions.filter((s) => !s.archived).map((s) => [s.id, s]),
  );
  const eligible = shots.filter(
    (s) =>
      active.has(s.sessionId) &&
      clubOrder(effectiveClub(s)) < 200 &&
      s.review.intent !== 'partial' &&
      s.review.contact !== 'mishit' &&
      s.review.exclusion.kind === 'included',
  );
  const assessments = new Map<string, UnusualShotAssessment>();
  for (const shot of eligible) {
    if (shot.review.contact !== 'uncertain') continue;
    const session = active.get(shot.sessionId);
    if (!session) continue;
    const candidates = eligible
      .filter((s) => {
        const other = active.get(s.sessionId);
        return (
          other !== undefined &&
          other.date >= shiftDate(session.date, -59) &&
          (other.date < session.date ||
            (other.date === session.date &&
              (s.sessionId === shot.sessionId
                ? s.rowIndex < shot.rowIndex
                : other.time !== null &&
                  session.time !== null &&
                  other.time < session.time))) &&
          effectiveClub(s) === effectiveClub(shot) &&
          s.measurements.flatCarryRange !== null &&
          s.measurements.flatCarryRange > 0 &&
          s.measurements.speedRange !== null &&
          s.measurements.speedRange > 0
        );
      })
      .sort((a, b) =>
        (active.get(b.sessionId)?.date ?? '').localeCompare(
          active.get(a.sessionId)?.date ?? '',
        ),
      );
    const boundary = candidates[49];
    const cutoff = boundary ? active.get(boundary.sessionId)?.date : undefined;
    const baseline = cutoff
      ? candidates.filter(
          (s) => (active.get(s.sessionId)?.date ?? '') >= cutoff,
        )
      : candidates;
    const carry = shot.measurements.flatCarryRange;
    const speed = shot.measurements.speedRange;
    if (carry === null || speed === null || carry <= 0 || speed <= 0) {
      assessments.set(shot.id, {
        kind: 'abstained',
        reason: 'Needs positive range-flat carry and range ball speed.',
        baselineCount: baseline.length,
      });
      continue;
    }
    if (baseline.length < 20) {
      assessments.set(shot.id, {
        kind: 'abstained',
        reason: 'Needs at least 20 earlier paired shots for this club.',
        baselineCount: baseline.length,
      });
      continue;
    }
    const carries = baseline.flatMap(
      (s) => s.measurements.flatCarryRange ?? [],
    );
    const speeds = baseline.flatMap((s) => s.measurements.speedRange ?? []);
    const carryMedian = quantile(carries, 0.5);
    const speedMedian = quantile(speeds, 0.5);
    if (carryMedian === null || speedMedian === null) continue;
    const carryReference = quantile(carries, 0.75);
    const speedReference = quantile(speeds, 0.75);
    if (carryReference === null || speedReference === null) continue;
    const carryThreshold = carryReference * 0.65;
    const speedThreshold = speedReference * 0.8;
    assessments.set(shot.id, {
      kind: 'assessed',
      unusual: carry < carryThreshold && speed < speedThreshold,
      baselineCount: baseline.length,
      sessions: new Set(baseline.map((s) => s.sessionId)).size,
      carry,
      speed,
      carryMedian,
      speedMedian,
      carryReference,
      speedReference,
      carryThreshold,
      speedThreshold,
      ruleVersion: UNUSUAL_SHOT_RULE,
    });
  }
  return assessments;
}
