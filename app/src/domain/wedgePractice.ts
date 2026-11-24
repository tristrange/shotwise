import {
  directionStats,
  metricStats,
  selectCohort,
  type AnalysisQuery,
} from './analytics';
import { resolvedClub, resolveShots, type ResolvedShot } from './assessment';
import {
  BASES,
  clubOrder,
  isWedge,
  type Basis,
  type Dataset,
  type Review,
  type Shot,
} from './model';

type Group = { club: string; shots: Shot[] } & (
  | { kind: 'target'; target: number }
  | { kind: 'intent'; intent: Review['intent'] }
);

const intentOrder = { full: 0, partial: 1, unknown: 2 };

function summarizeGroup(
  group: Group,
  basis: Basis,
  resolved: Map<string, ResolvedShot>,
) {
  const fields = BASES[basis];
  const { shots } = group;
  // Proximity provides evidence that the recorded target was selected.
  const aimed =
    group.kind === 'target'
      ? shots.filter((shot) => shot.measurements.proximity !== null)
      : [];
  const intentOf = (shot: Shot) =>
    resolved.get(shot.id)?.intent ?? shot.review.intent;
  return {
    ...group,
    visits: new Set(shots.map((shot) => shot.sessionId)).size,
    intentCounts: {
      full: shots.filter((shot) => intentOf(shot) === 'full').length,
      partial: shots.filter((shot) => intentOf(shot) === 'partial').length,
      unknown: shots.filter((shot) => intentOf(shot) === 'unknown').length,
    },
    carry: metricStats(shots, fields.carry),
    speed: metricStats(shots, fields.speed),
    launch: metricStats(shots, fields.launch),
    apex: metricStats(shots, fields.apex),
    aimed: aimed.length,
    direction: {
      launch: directionStats(aimed, 'launchDirection'),
      curve: directionStats(aimed, 'curve'),
      lateral: directionStats(aimed, 'fromCentre'),
    },
  };
}

/** Group by exact recorded target, or by reviewed intent when the target is absent. */
export function wedgePractice(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
) {
  const resolved = resolveShots(data.shots, data.sessions, basis);
  const shots = selectCohort(data.shots, data.sessions, query, basis).filter(
    (shot) => {
      const r = resolved.get(shot.id);
      return r ? isWedge(resolvedClub(r)) : false;
    },
  );
  const dates = new Map(
    data.sessions.map((session) => [session.id, session.date]),
  );
  shots.sort(
    (a, b) =>
      (dates.get(b.sessionId) ?? '').localeCompare(
        dates.get(a.sessionId) ?? '',
      ) ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.rowIndex - b.rowIndex ||
      a.id.localeCompare(b.id),
  );

  const groups = new Map<string, Group>();
  let missingTarget = 0;
  let zeroTarget = 0;
  for (const shot of shots) {
    const r = resolved.get(shot.id);
    const club = r ? resolvedClub(r) : '';
    const { target } = shot.measurements;
    const intent = r?.intent ?? shot.review.intent;
    if (target === null || target < 0) missingTarget++;
    if (target === 0) zeroTarget++;
    const group: Group =
      target !== null && target > 0
        ? { kind: 'target', club, target, shots: [] }
        : { kind: 'intent', club, intent, shots: [] };
    const key = JSON.stringify([
      group.kind,
      club,
      group.kind === 'target' ? group.target : group.intent,
    ]);
    const bucket = groups.get(key) ?? group;
    bucket.shots.push(shot);
    groups.set(key, bucket);
  }

  const ordered = [...groups.values()].sort(
    (a, b) =>
      clubOrder(a.club) - clubOrder(b.club) ||
      a.club.localeCompare(b.club) ||
      a.kind.localeCompare(b.kind) ||
      (a.kind === 'target' && b.kind === 'target' ? a.target - b.target : 0) ||
      (a.kind === 'intent' && b.kind === 'intent'
        ? intentOrder[a.intent] - intentOrder[b.intent]
        : 0),
  );
  return {
    total: shots.length,
    targeted: shots.length - missingTarget - zeroTarget,
    missingTarget,
    zeroTarget,
    groups: ordered.map((group) => summarizeGroup(group, basis, resolved)),
  };
}
