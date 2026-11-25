import {
  benchmarkClubGroups,
  metricStats,
  selectCohort,
  type AnalysisQuery,
} from './analytics';
import { resolveShots } from './assessment';
import {
  BASES,
  clubOrder,
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
  // Club-specific progress uses the shared benchmark eligibility rule: suspected
  // wrong-club rows never enter club figures here either.
  const groups = benchmarkClubGroups(selected, resolved);
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
        const { n, missing, median, iqr } = metricStats(
          shots,
          BASES[basis].carry,
        );
        return { session, n, missing, median, iqr };
      }),
  }));
}
