import { selectCohort, type AnalysisQuery } from './analytics';
import type { Basis, Dataset } from './model';

/** Only the two recorded measurements define a shape point, never a landing position. */
export function shotShapes(
  data: Dataset,
  query: AnalysisQuery,
  basis: Basis = 'premium-flat',
) {
  const dates = new Map(data.sessions.map((s) => [s.id, s.date]));
  const shots = selectCohort(data.shots, data.sessions, query, basis).toSorted(
    (a, b) =>
      (dates.get(b.sessionId) ?? '').localeCompare(
        dates.get(a.sessionId) ?? '',
      ) ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.rowIndex - b.rowIndex,
  );
  const points = shots.flatMap((shot) => {
    const { launchDirection, curve } = shot.measurements;
    return launchDirection === null || curve === null
      ? []
      : [{ shot, launchDirection, curve }];
  });
  return { shots, points };
}
