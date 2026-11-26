import {
  benchmarkClubGroups,
  metricStats,
  selectCohort,
  type AnalysisQuery,
} from './analytics';
import { resolveShots } from './assessment';
import { strongStrikePotentialBySession } from './potential';
import {
  BASES,
  clubOrder,
  type Basis,
  type Dataset,
  type Session,
} from './model';

/** Metrics available on the interactive progress chart. */
export type ProgressMetric = 'median' | 'p80' | 'iqr' | 'speed' | 'launch' | 'apex';

/** One metric reading for one session: the value plus its sample counts. */
export type ProgressReading = {
  value: number | null;
  n: number;
  missing: number;
};

export type ProgressSessionPoint = {
  session: Session;
  /** Carry sample on the selected basis (unchanged contract). */
  n: number;
  missing: number;
  median: number | null;
  iqr: number | null;
  /**
   * Strong-strike potential (P80 carry) of this session's broader full-swing
   * non-mishit population — null below MIN_POTENTIAL_SAMPLES (ADR-0002), so
   * the series is never drawn from a strong-strike-filtered subset.
   */
  p80: ProgressReading;
  /** Median ball speed on the selected basis. */
  speed: ProgressReading;
  /** Median launch angle on the selected basis. */
  launch: ProgressReading;
  /** Median apex on the selected basis. */
  apex: ProgressReading;
};

export type ClubProgressGroup = {
  club: string;
  sessions: ProgressSessionPoint[];
};

const readingOf = (
  stats: ReturnType<typeof metricStats>,
): ProgressReading => ({ value: stats.median, n: stats.n, missing: stats.missing });

/** Each club/session stands alone, on the shared analysis cohort and basis. */
export function clubProgress(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): ClubProgressGroup[] {
  const selected = selectCohort(data.shots, data.sessions, query, basis);
  const resolved = resolveShots(data.shots, data.sessions, basis);
  // Club-specific progress uses the shared benchmark eligibility rule: suspected
  // wrong-club rows never enter club figures here either.
  const groups = benchmarkClubGroups(selected, resolved);
  // Per-session strong-strike potential comes from the mode-invariant broader
  // population (same rule as clubGaps/clubProfiles), never from a
  // strong-strike-filtered subset.
  const potential = strongStrikePotentialBySession(data, basis, {
    ...query,
    contact: 'all',
    hideLikelyMishits: false,
  });
  const fields = BASES[basis];
  const bySession = new Map<string, Map<string, (typeof selected)[number][]>>();
  for (const [club, shots] of groups) {
    for (const shot of shots) {
      const perClub = bySession.get(shot.sessionId) ?? new Map();
      const list = perClub.get(club) ?? [];
      list.push(shot);
      perClub.set(club, list);
      bySession.set(shot.sessionId, perClub);
    }
  }
  const clubs = [...groups.keys()].sort(
    (a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b),
  );
  return clubs.map((club) => ({
    club,
    sessions: data.sessions
      .filter((session) => bySession.get(session.id)?.has(club))
      .toSorted(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.time ?? '').localeCompare(b.time ?? '') ||
          a.id.localeCompare(b.id),
      )
      .map((session) => {
        const shots = bySession.get(session.id)?.get(club) ?? [];
        const carry = metricStats(shots, fields.carry);
        const sessionPotential = potential.get(club)?.get(session.id);
        return {
          session,
          n: carry.n,
          missing: carry.missing,
          median: carry.median,
          iqr: carry.iqr,
          p80: sessionPotential
            ? {
                value: sessionPotential.potential,
                n: sessionPotential.n,
                missing: sessionPotential.missing,
              }
            : { value: null, n: 0, missing: 0 },
          speed: readingOf(metricStats(shots, fields.speed)),
          launch: readingOf(metricStats(shots, fields.launch)),
          apex: readingOf(metricStats(shots, fields.apex)),
        };
      }),
  }));
}

export type ClubMetricPoint = {
  session: Session;
  value: number;
  n: number;
};

export type ClubMetricSummary = {
  club: string;
  /** Sessions with any shots for the club in the window. */
  sessions: number;
  /** Sessions with a measured value for the metric. */
  measured: number;
  first: ClubMetricPoint | null;
  latest: ClubMetricPoint | null;
  /** Best session in the favourable direction (max, or min when lowerIsBetter). */
  best: ClubMetricPoint | null;
  /** latest − first, null unless both exist. */
  delta: number | null;
};

/** Extract one metric's reading from a session point. */
export function pointReading(
  point: ProgressSessionPoint,
  metric: ProgressMetric,
): ProgressReading {
  switch (metric) {
    case 'median':
      return { value: point.median, n: point.n, missing: point.missing };
    case 'iqr':
      return { value: point.iqr, n: point.n, missing: point.missing };
    case 'p80':
      return point.p80;
    case 'speed':
      return point.speed;
    case 'launch':
      return point.launch;
    case 'apex':
      return point.apex;
  }
}

/**
 * First / latest / best session values per club for one metric, plus the
 * latest-vs-first delta. Pure function of `clubProgress` output, so the
 * interactive chart, the summary tiles and the cross-club comparison can
 * never disagree. "Best" follows the favourable direction (lower is better
 * for the carry IQR only when `lowerIsBetter` is set).
 */
export function summarizeClubMetric(
  groups: readonly ClubProgressGroup[],
  metric: ProgressMetric,
  lowerIsBetter = false,
): ClubMetricSummary[] {
  return groups.map(({ club, sessions }) => {
    const measured: ClubMetricPoint[] = sessions.flatMap((point) => {
      const reading = pointReading(point, metric);
      return reading.value === null
        ? []
        : [{ session: point.session, value: reading.value, n: reading.n }];
    });
    const first = measured[0] ?? null;
    const latest = measured.at(-1) ?? null;
    let best: ClubMetricPoint | null = null;
    for (const point of measured) {
      if (
        best === null ||
        (lowerIsBetter ? point.value < best.value : point.value > best.value)
      )
        best = point;
    }
    return {
      club,
      sessions: sessions.length,
      measured: measured.length,
      first,
      latest,
      best,
      delta:
        first !== null && latest !== null ? latest.value - first.value : null,
    };
  });
}
