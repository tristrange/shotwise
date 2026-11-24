import { selectCohort, type AnalysisQuery } from './analytics';
import { resolvedClub, resolveShots } from './assessment';
import {
  BASES,
  clubOrder,
  isUnknownClub,
  type Basis,
  type Dataset,
  type MetricKey,
  type Review,
  type Shot,
} from './model';

/** Plottable measurement axes; each maps onto the shared basis fields. */
export const EXPLORER_AXES = [
  'carry',
  'total',
  'speed',
  'launch',
  'apex',
] as const;
export type ExplorerAxis = (typeof EXPLORER_AXES)[number];

export type ExplorerAxisInfo = {
  axis: ExplorerAxis;
  label: string;
  unit: string;
  metric: MetricKey;
};

/** Axis label, unit and basis-relative measurement key for one explorer axis. */
export function explorerAxis(axis: ExplorerAxis, basis: Basis): ExplorerAxisInfo {
  const fields = BASES[basis];
  switch (axis) {
    case 'carry':
      return { axis, label: 'Carry', unit: 'm', metric: fields.carry };
    case 'total':
      return { axis, label: 'Total distance', unit: 'm', metric: fields.total };
    case 'speed':
      return { axis, label: 'Ball speed', unit: 'kph', metric: fields.speed };
    case 'launch':
      return { axis, label: 'Launch angle', unit: '°', metric: fields.launch };
    case 'apex':
      return { axis, label: 'Apex', unit: 'm', metric: fields.apex };
  }
}

/** Recent window, all-time, or one exact named visit. */
export type ExplorerScope = 'recent' | 'all' | { session: string };

export type ExplorerQuery = {
  club: string;
  x: ExplorerAxis;
  y: ExplorerAxis;
  basis: Basis;
  scope: ExplorerScope;
  intent: Review['intent'] | 'all';
  contact: AnalysisQuery['contact'];
  today: string;
};

export type ExplorerPoint = { shot: Shot; x: number; y: number };

export type ExplorerPlot = {
  club: string;
  basis: Basis;
  basisLabel: string;
  xAxis: ExplorerAxisInfo;
  yAxis: ExplorerAxisInfo;
  /** Every eligible cohort shot for the club, in a stable order. */
  shots: Shot[];
  /** Emitted only when both selected measurements exist; zero is a value. */
  points: ExplorerPoint[];
  missingX: number;
  missingY: number;
  omitted: number;
};

/**
 * Pure ball-flight explorer plot for one effective club. Reuses the shared
 * cohort (window, exclusions, corrected clubs, intent, contact) and basis.
 * Automatic unusual-shot flags are never applied here: All contact keeps every
 * included shot, and only an explicit Reviewed typical choice narrows contact.
 */
export function explorerPlot(data: Dataset, query: ExplorerQuery): ExplorerPlot {
  const analysisQuery: AnalysisQuery = {
    mode: query.scope === 'recent' ? 'recent' : 'all',
    today: query.today,
    intent: query.intent,
    contact: query.contact,
    club: query.club,
    // A named visit uses its complete eligible population, not the Recent
    // cap, and strong-strike thresholds are computed within that visit.
    scopeSessionId: typeof query.scope === 'object' ? query.scope.session : undefined,
  };
  let shots = selectCohort(data.shots, data.sessions, analysisQuery, query.basis);
  const dates = new Map(data.sessions.map((s) => [s.id, s.date]));
  shots = shots.toSorted(
    (a, b) =>
      (dates.get(b.sessionId) ?? '').localeCompare(
        dates.get(a.sessionId) ?? '',
      ) ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.rowIndex - b.rowIndex,
  );
  const xAxis = explorerAxis(query.x, query.basis);
  const yAxis = explorerAxis(query.y, query.basis);
  const points: ExplorerPoint[] = [];
  let missingX = 0;
  let missingY = 0;
  for (const shot of shots) {
    const x = shot.measurements[xAxis.metric];
    const y = shot.measurements[yAxis.metric];
    if (x === null) missingX++;
    if (y === null) missingY++;
    if (x === null || y === null) continue;
    points.push({ shot, x, y });
  }
  return {
    club: query.club,
    basis: query.basis,
    basisLabel: BASES[query.basis].label,
    xAxis,
    yAxis,
    shots,
    points,
    missingX,
    missingY,
    omitted: shots.length - points.length,
  };
}

/** Resolved club labels with any included shot, in club order. */
export function explorerClubs(
  data: Dataset,
  today: string,
  basis: Basis = 'premium-flat',
): string[] {
  const shots = selectCohort(
    data.shots,
    data.sessions,
    {
      mode: 'all',
      today,
      intent: 'all',
      contact: 'all',
    },
    basis,
  );
  const resolved = resolveShots(data.shots, data.sessions, basis);
  return [
    ...new Set(
      shots.flatMap((shot) => {
        const r = resolved.get(shot.id);
        const club = r ? resolvedClub(r) : '';
        return isUnknownClub(club) ? [] : [club];
      }),
    ),
  ].sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b));
}
