import { metricStats, selectCohort, type AnalysisQuery } from './analytics';
import { resolvedClub, resolveShots } from './assessment';
import {
  BASES,
  clubOrder,
  isUnknownClub,
  type Basis,
  type Dataset,
} from './model';

/** Each club/session stands alone, on the shared analysis cohort and basis. */
export function clubProgress(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
) {
  const selected = selectCohort(data.shots, data.sessions, query, basis);
  const resolved = resolveShots(data.shots, data.sessions, basis);
  const clubOf = (s: (typeof selected)[number]) => {
    const r = resolved.get(s.id);
    return r ? resolvedClub(r) : '';
  };
  const clubs = [...new Set(selected.map(clubOf))]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b));
  return clubs.map((club) => ({
    club,
    sessions: data.sessions
      .filter((session) =>
        selected.some((s) => s.sessionId === session.id && clubOf(s) === club),
      )
      .toSorted(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.time ?? '').localeCompare(b.time ?? '') ||
          a.id.localeCompare(b.id),
      )
      .map((session) => {
        const shots = selected.filter(
          (s) => s.sessionId === session.id && clubOf(s) === club,
        );
        const { n, missing, median, iqr } = metricStats(
          shots,
          BASES[basis].carry,
        );
        return { session, n, missing, median, iqr };
      }),
  }));
}
