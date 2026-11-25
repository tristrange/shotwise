import {
  metricStats,
  MIN_POTENTIAL_SAMPLES,
  potentialCarry,
  selectCohort,
  type AnalysisQuery,
} from './analytics';
import {
  isFullSwingResolved,
  resolvedClub,
  resolveShots,
} from './assessment';
import {
  BASES,
  clubOrder,
  isUnknownClub,
  type Basis,
  type Dataset,
  type Shot,
} from './model';

export { MIN_POTENTIAL_SAMPLES, potentialCarry };

/**
 * Strong-strike carry — "distance potential" (roadmap §6, ADR-0002).
 *
 * A robust upper-tail estimate of what a club produces when struck well:
 * the P80 carry of the resolved full-swing, non-mishit population. The maximum
 * is never used (a single mislabelled or misread shot would set the
 * "potential"), and there is no artificial upper ceiling — long legitimate
 * shots count. A long shot is not automatically a good shot: this metric says
 * nothing about direction or overall quality.
 */
export const STRONG_STRIKE_RULE_VERSION = 'strong-strike-1';

/** P80 is the recommended robust upper-tail estimator (roadmap §6.2, ADR-0002). */
export { POTENTIAL_QUANTILE } from './analytics';

export type StrongStrikeCarry = {
  club: string;
  n: number;
  missing: number;
  median: number | null;
  iqr: number | null;
  /** P80 carry in metres — the strong-strike ("distance potential") estimate. */
  potential: number | null;
  /** False when the sample is below MIN_POTENTIAL_SAMPLES and potential is null. */
  reliable: boolean;
  /** Contributing shots, so analytics can link back to the exact rows. */
  shotIds: string[];
  ruleVersion: typeof STRONG_STRIKE_RULE_VERSION;
};

/**
 * The pre-measurement strong-strike base: included shots in the selected
 * cohort that resolve to a full swing with non-mishit contact under a known
 * club. Carry is not required here so callers can count missing/zero
 * measurements over the true population instead of a pre-filtered one.
 * Manual review wins through the resolved layer; automatically assessed
 * mishits are excluded too; suspected wrong-club labels stay out so they
 * cannot create false personal bests (ADR-0001).
 */
function strongStrikeBase(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): Shot[] {
  const resolved = resolveShots(data.shots, data.sessions, basis);
  return selectCohort(data.shots, data.sessions, query, basis).filter(
    (shot) => {
      const r = resolved.get(shot.id);
      return (
        r !== undefined &&
        isFullSwingResolved(r) &&
        r.contact !== 'mishit' &&
        !r.suspectedWrongClub &&
        !isUnknownClub(resolvedClub(r))
      );
    },
  );
}

/**
 * The strong-strike population: the strong-strike base with a positive carry
 * measurement on the basis (null and zero carries are failed/placeholder
 * measurements, not distances).
 */
export function strongStrikePopulation(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): Shot[] {
  const key = BASES[basis].carry;
  return strongStrikeBase(data, basis, query).filter(
    (shot) => (shot.measurements[key] ?? 0) > 0,
  );
}

/**
 * Per-club strong-strike carry on the shared analysis cohort. Follows the
 * selected window (Recent/All), so early beginner history does not dominate
 * potential when Recent is selected. Deterministic and consistent with the
 * gapping view, which reads the same P80 from the same population.
 */
export function clubStrongStrike(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): StrongStrikeCarry[] {
  const key = BASES[basis].carry;
  const resolved = resolveShots(data.shots, data.sessions, basis);
  // Group the pre-measurement base so `missing` counts strong swings whose
  // carry is null or zero, not just the ones already filtered out.
  const baseGroups = new Map<string, Shot[]>();
  for (const shot of strongStrikeBase(data, basis, query)) {
    const r = resolved.get(shot.id);
    if (!r) continue;
    const club = resolvedClub(r);
    baseGroups.set(club, [...(baseGroups.get(club) ?? []), shot]);
  }
  return [...baseGroups.entries()]
    .map(([club, baseShots]): StrongStrikeCarry => {
      const shots = baseShots.filter((s) => (s.measurements[key] ?? 0) > 0);
      const stats = metricStats(shots, key);
      return {
        club,
        n: stats.n,
        missing: baseShots.length - shots.length,
        median: stats.median,
        iqr: stats.iqr,
        potential: potentialCarry(
          shots.flatMap((s) => s.measurements[key] ?? []),
        ),
        reliable: stats.n >= MIN_POTENTIAL_SAMPLES,
        // Sorted so the report is invariant to input array order.
        shotIds: shots.map((s) => s.id).sort(),
        ruleVersion: STRONG_STRIKE_RULE_VERSION,
      };
    })
    .sort(
      (a, b) => clubOrder(a.club) - clubOrder(b.club) || a.club.localeCompare(b.club),
    );
}
