import { quantile } from './statistics';
import {
  BASES,
  clubOrder,
  effectiveClub,
  isUnknownClub,
  shiftDate,
  type Basis,
  type Session,
  type Shot,
} from './model';

/**
 * Sequence-aware club inference (ADR-0001, roadmap §5.4). Rule-based and
 * conservative: it exploits the common habit of hitting runs of consecutive
 * shots with one club, but learns nothing about a fixed run length — any run
 * size counts. Inferred clubs are provisional and never overwrite recorded
 * labels; suspected wrong labels are flagged, never reassigned.
 */
export const SEQUENCE_RULE_VERSION = 'sequence-2';

export type SequenceAssessment =
  | {
      kind: 'inferred-club';
      shotId: string;
      club: string;
      /** Number of labelled same-club shots in this session supporting the inference. */
      evidence: number;
      reason: string;
      ruleVersion: typeof SEQUENCE_RULE_VERSION;
    }
  | {
      kind: 'suspected-wrong-club';
      shotId: string;
      recordedClub: string;
      suspectedClub: string;
      evidence: number;
      reason: string;
      ruleVersion: typeof SEQUENCE_RULE_VERSION;
    }
  | {
      kind: 'abstained';
      shotId: string;
      reason: string;
      ruleVersion: typeof SEQUENCE_RULE_VERSION;
    };

/** Minimum labelled shots of a club (session or global) to build a profile. */
const MIN_PROFILE = 5;
/** Minimum run length before a labelled run can be a forgotten tablet switch. */
const MIN_SWITCH_RUN = 8;
/** Relative tolerance around a club's median carry/speed for compatibility. */
const CARRY_TOLERANCE = 0.15;
const SPEED_TOLERANCE = 0.15;
const MIN_CARRY_TOL_M = 10;
const MIN_SPEED_TOL_KPH = 8;
/** A sub-block is a suspected switch when the other club is much closer than the recorded one. */
const SWITCH_CLOSENESS = 0.5;
const RECENT_DAYS = 60;

type Profile = { n: number; carryMedian: number; speedMedian: number };

function profiles(
  shots: Shot[],
  sessionMap: Map<string, Session>,
  basis: Basis,
  sessionId?: string,
): Map<string, Profile> {
  const carryKey = BASES[basis].carry;
  const speedKey = BASES[basis].speed;
  const out = new Map<string, Profile>();
  const byClub = new Map<string, Shot[]>();
  for (const shot of shots) {
    if (sessionId && shot.sessionId !== sessionId) continue;
    const session = sessionMap.get(shot.sessionId);
    if (!session || session.archived) continue;
    if (shot.review.exclusion.kind !== 'included') continue;
    const club = effectiveClub(shot);
    if (isUnknownClub(club)) continue;
    const carry = shot.measurements[carryKey];
    const speed = shot.measurements[speedKey];
    if (carry === null || speed === null || carry <= 0 || speed <= 0) continue;
    const group = byClub.get(club) ?? [];
    group.push(shot);
    byClub.set(club, group);
  }
  for (const [club, group] of byClub) {
    const carries = group.flatMap((s) => s.measurements[BASES[basis].carry] ?? []);
    const speeds = group.flatMap((s) => s.measurements[BASES[basis].speed] ?? []);
    const carryMedian = quantile(carries, 0.5);
    const speedMedian = quantile(speeds, 0.5);
    if (carryMedian === null || speedMedian === null) continue;
    out.set(club, { n: group.length, carryMedian, speedMedian });
  }
  return out;
}

function compatible(
  shot: Shot,
  profile: Profile,
  basis: Basis,
): boolean {
  const carry = shot.measurements[BASES[basis].carry];
  const speed = shot.measurements[BASES[basis].speed];
  if (carry === null || speed === null || carry <= 0 || speed <= 0) return false;
  const carryTol = Math.max(MIN_CARRY_TOL_M, CARRY_TOLERANCE * profile.carryMedian);
  const speedTol = Math.max(MIN_SPEED_TOL_KPH, SPEED_TOLERANCE * profile.speedMedian);
  return (
    Math.abs(carry - profile.carryMedian) <= carryTol &&
    Math.abs(speed - profile.speedMedian) <= speedTol
  );
}

function distance(shot: Shot, profile: Profile, basis: Basis): number {
  const carry = shot.measurements[BASES[basis].carry];
  const speed = shot.measurements[BASES[basis].speed];
  if (carry === null || speed === null) return Number.POSITIVE_INFINITY;
  const carryTol = Math.max(MIN_CARRY_TOL_M, CARRY_TOLERANCE * profile.carryMedian);
  const speedTol = Math.max(MIN_SPEED_TOL_KPH, SPEED_TOLERANCE * profile.speedMedian);
  return (
    Math.abs(carry - profile.carryMedian) / carryTol +
    Math.abs(speed - profile.speedMedian) / speedTol
  );
}

/**
 * Assess every included shot of every non-archived session. Unknown labels
 * are inferred from neighbouring labelled runs; long labelled runs whose
 * measurements match another club are flagged as suspected wrong labels.
 *
 * Append-stable (sequence-2): each visit is assessed against a reference
 * window anchored to that visit's own date — later visits never influence
 * earlier results, and archived sessions neither move an anchor nor
 * contribute references. Within the assessed visit, context from both sides
 * is allowed (the visit is complete when it is read).
 */
export function assessSequences(
  shots: Shot[],
  sessions: Session[],
  basis: Basis = 'premium-flat',
): Map<string, SequenceAssessment> {
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const out = new Map<string, SequenceAssessment>();

  const bySession = new Map<string, Shot[]>();
  for (const shot of shots) {
    const session = sessionMap.get(shot.sessionId);
    if (!session || session.archived) continue;
    if (shot.review.exclusion.kind !== 'included') continue;
    const group = bySession.get(shot.sessionId) ?? [];
    group.push(shot);
    bySession.set(shot.sessionId, group);
  }

  for (const [sessionId, sessionShots] of bySession) {
    const session = sessionMap.get(sessionId)!;
    const cutoff = shiftDate(session.date, -RECENT_DAYS);
    const windowShots = shots.filter((s) => {
      const sess = sessionMap.get(s.sessionId);
      return (
        sess !== undefined &&
        !sess.archived &&
        sess.date >= cutoff &&
        sess.date <= session.date
      );
    });
    const referenceProfiles = profiles(windowShots, sessionMap, basis);
    const ordered = [...sessionShots].sort((a, b) => a.rowIndex - b.rowIndex);
    const sessionProfiles = profiles(ordered, sessionMap, basis, sessionId);
    const profileFor = (club: string) => {
      const local = sessionProfiles.get(club);
      if (local && local.n >= MIN_PROFILE) return local;
      return referenceProfiles.get(club);
    };

    for (let i = 0; i < ordered.length; i++) {
      const shot = ordered[i]!;
      const club = effectiveClub(shot);
      if (!isUnknownClub(club)) continue;
      // Nearest labelled neighbours in this session.
      let prev: Shot | undefined;
      for (let j = i - 1; j >= 0; j--) {
        const candidate = ordered[j]!;
        if (!isUnknownClub(effectiveClub(candidate))) {
          prev = candidate;
          break;
        }
      }
      let next: Shot | undefined;
      for (let j = i + 1; j < ordered.length; j++) {
        const candidate = ordered[j]!;
        if (!isUnknownClub(effectiveClub(candidate))) {
          next = candidate;
          break;
        }
      }
      const candidates = [...new Set([prev, next].filter(Boolean).map((s) => effectiveClub(s!)))];
      if (!candidates.length) {
        out.set(shot.id, {
          kind: 'abstained',
          shotId: shot.id,
          reason: 'No labelled neighbouring shots in this session.',
          ruleVersion: SEQUENCE_RULE_VERSION,
        });
        continue;
      }
      const scored = candidates
        .map((candidate) => {
          const profile = profileFor(candidate);
          return { candidate, profile, distance: profile ? distance(shot, profile, basis) : Number.POSITIVE_INFINITY };
        })
        .filter((s) => s.profile && compatible(shot, s.profile!, basis))
        .sort((a, b) => a.distance - b.distance);
      if (!scored.length) {
        out.set(shot.id, {
          kind: 'abstained',
          shotId: shot.id,
          reason: `Measurements match none of the neighbouring clubs (${candidates.join(', ')}).`,
          ruleVersion: SEQUENCE_RULE_VERSION,
        });
        continue;
      }
      if (scored.length > 1 && scored[1]!.distance < scored[0]!.distance / 0.75) {
        // Two neighbouring clubs both fit and are close — ambiguous transition.
        out.set(shot.id, {
          kind: 'abstained',
          shotId: shot.id,
          reason: `Could belong to either ${scored.map((s) => s.candidate).join(' or ')} — ambiguous transition.`,
          ruleVersion: SEQUENCE_RULE_VERSION,
        });
        continue;
      }
      const winner = scored[0]!;
      const evidence = (sessionProfiles.get(winner.candidate)?.n ?? referenceProfiles.get(winner.candidate)?.n ?? 0);
      out.set(shot.id, {
        kind: 'inferred-club',
        shotId: shot.id,
        club: winner.candidate,
        evidence,
        reason: `Surrounded by ${winner.candidate} shots (${evidence} labelled in view) with matching carry and speed.`,
        ruleVersion: SEQUENCE_RULE_VERSION,
      });
    }

    // Forgotten tablet switch: a long labelled run that matches another club.
    const runs: { club: string; shots: Shot[] }[] = [];
    let current: { club: string; shots: Shot[] } | null = null;
    for (const shot of ordered) {
      const club = effectiveClub(shot);
      if (isUnknownClub(club)) {
        current = null;
        continue;
      }
      if (current && current.club === club) current.shots.push(shot);
      else {
        current = { club, shots: [shot] };
        runs.push(current);
      }
    }
    for (const run of runs) {
      const own = referenceProfiles.get(run.club);
      if (!own || own.n < MIN_PROFILE) continue;
      // A forgotten tablet switch shows up as a contiguous sub-block of the
      // labelled run whose measurements match another club, not the label.
      const others = [...referenceProfiles.entries()].filter(
        ([club, profile]) => club !== run.club && clubOrder(club) < 200 && profile.n >= MIN_PROFILE,
      );
      for (const [candidate, profile] of others) {
        const mask = run.shots.map(
          (s) => compatible(s, profile, basis) && !compatible(s, own, basis),
        );
        // Maximal contiguous blocks of length >= MIN_SWITCH_RUN.
        let start = -1;
        const blocks: Shot[][] = [];
        for (let i = 0; i <= mask.length; i++) {
          if (i < mask.length && mask[i]) {
            if (start < 0) start = i;
          } else if (start >= 0) {
            if (i - start >= MIN_SWITCH_RUN) blocks.push(run.shots.slice(start, i));
            start = -1;
          }
        }
        for (const block of blocks) {
          const ownDistance =
            block.reduce((sum, s) => sum + distance(s, own, basis), 0) / block.length;
          const otherDistance =
            block.reduce((sum, s) => sum + distance(s, profile, basis), 0) / block.length;
          if (otherDistance < SWITCH_CLOSENESS * ownDistance && otherDistance < 2) {
            for (const shot of block) {
              out.set(shot.id, {
                kind: 'suspected-wrong-club',
                shotId: shot.id,
                recordedClub: run.club,
                suspectedClub: candidate,
                evidence: block.length,
                reason: `This block of ${block.length} ${run.club}-labelled shots matches ${candidate} better — possible forgotten club switch. Recorded label kept.`,
                ruleVersion: SEQUENCE_RULE_VERSION,
              });
            }
          }
        }
      }
    }
  }
  return out;
}
