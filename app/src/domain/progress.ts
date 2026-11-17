import { metricStats, selectCohort, type AnalysisQuery } from './analytics';
import {
  BASES,
  clubOrder,
  effectiveClub,
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
  const selected = selectCohort(data.shots, data.sessions, query);
  const clubs = [...new Set(selected.map(effectiveClub))]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b));
  return clubs.map((club) => ({
    club,
    sessions: data.sessions
      .filter((session) =>
        selected.some(
          (s) => s.sessionId === session.id && effectiveClub(s) === club,
        ),
      )
      .toSorted(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.time ?? '').localeCompare(b.time ?? '') ||
          a.id.localeCompare(b.id),
      )
      .map((session) => {
        const shots = selected.filter(
          (s) => s.sessionId === session.id && effectiveClub(s) === club,
        );
        const { n, missing, median, iqr } = metricStats(
          shots,
          BASES[basis].carry,
        );
        return { session, n, missing, median, iqr };
      }),
  }));
}
