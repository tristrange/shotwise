import {
  BASES,
  clubOrder,
  localToday,
  type Basis,
  type Dataset,
  type MetricKey,
  type Shot,
} from '../domain/model';
import {
  benchmarkClubGroups,
  directionStats,
  metricStats,
  selectCohort,
} from '../domain/analytics';
import { resolveShots } from '../domain/assessment';
import { clubStrongStrike } from '../domain/potential';
import { clubRatings, type ClubRating } from '../domain/ratings';
import { compareWithReference } from '../domain/benchmarks';
import { quantile } from '../domain/statistics';
import type { DistributionBand } from './charts';

/** Distribution band of the measured (non-null) carries — same population as metricStats. */
function carryBand(shots: Shot[], key: MetricKey) {
  const values = shots.flatMap((s) =>
    s.measurements[key] === null ? [] : [s.measurements[key]],
  );
  const stats = metricStats(shots, key);
  const band: DistributionBand = {
    p10: stats.p10,
    q1: values.length >= 4 ? quantile(values, 0.25) : null,
    median: stats.median,
    q3: values.length >= 4 ? quantile(values, 0.75) : null,
    p90: stats.p90,
  };
  return { band, iqr: stats.iqr, n: stats.n };
}

/**
 * Everything a ClubCard renders, assembled from the existing tested domain
 * functions. Presentation components never recompute analytics.
 *
 * Basis discipline (owner requirement): `median`/band/speed/launch/apex follow
 * the selected display `basis`; `rating` always comes from clubRatings on the
 * fixed premium-flat rating basis; the strong-strike potential (P80) always
 * comes from the broader (unfiltered) cohort so it stays mode-invariant.
 */
export type ClubCardData = {
  club: string;
  /** Selected-cohort median carry on the display basis. */
  median: number | null;
  /** P10–P90 / Q1–Q3 / median band from the broader cohort. */
  band: DistributionBand;
  iqr: number | null;
  n: number;
  missing: number;
  total: number;
  /** False below 10 measured shots — sample-limited marker. */
  reliable: boolean;
  /** P80 strong-strike carry ("distance potential"), broader cohort. */
  potential: number | null;
  potentialN: number;
  potentialReliable: boolean;
  speed: { median: number | null; n: number };
  launch: { median: number | null; n: number };
  apex: { median: number | null; n: number };
  rating: ClubRating | null;
  benchmark: {
    value: number | null;
    reference: number | null;
    compatible: boolean;
    reason: string | null;
  } | null;
  direction: { label: string; detail: string } | null;
};

export function clubCardRows(
  data: Dataset,
  basis: Basis,
  mode: 'recent' | 'all',
): ClubCardData[] {
  const query = {
    mode,
    intent: 'all',
    contact: 'all',
    hideLikelyMishits: false,
    today: localToday(),
  } as const;
  const resolved = resolveShots(data.shots, data.sessions, basis);
  const selected = selectCohort(data.shots, data.sessions, query, basis);
  const groups = benchmarkClubGroups(selected, resolved);
  // Reliability/spread/potential always come from the broader population so
  // they stay visible when a performance filter narrows the median.
  const broader = selectCohort(data.shots, data.sessions, query, basis);
  const broaderGroups = benchmarkClubGroups(broader, resolved);
  const potentialByClub = new Map(
    clubStrongStrike(data, basis, query).map((row) => [row.club, row]),
  );
  const ratingsByClub = new Map(
    clubRatings(data, query, data.userReferenceValues).map((r) => [r.club, r]),
  );
  const fields = BASES[basis];
  return [...groups.keys()]
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b))
    .map((club) => {
      const clubShots = groups.get(club) ?? [];
      const broadShots = broaderGroups.get(club) ?? [];
      const stats = metricStats(clubShots, fields.carry);
      const { band, iqr, n: broadN } = carryBand(broadShots, fields.carry);
      const potential = potentialByClub.get(club) ?? null;
      const ref = data.userReferenceValues.find(
        (r) => r.club === club && r.metric === 'carry',
      );
      const comparison = ref
        ? compareWithReference(
            ref,
            { typical: stats.median, strong: potential?.potential ?? null },
            basis,
          )
        : null;
      const lateral = directionStats(broadShots, 'fromCentre');
      const launchDir = directionStats(broadShots, 'launchDirection');
      const direction =
        lateral.n > 0
          ? {
              label: 'Lateral from centre',
              detail: `${lateral.n} of ${broadShots.length} measured · ${lateral.left} left · ${lateral.straight} straight · ${lateral.right} right`,
            }
          : launchDir.n > 0
            ? {
                label: 'Launch direction',
                detail: `${launchDir.n} of ${broadShots.length} measured · ${launchDir.left} left · ${launchDir.straight} straight · ${launchDir.right} right (no finishing-position data)`,
              }
            : null;
      return {
        club,
        median: stats.median,
        band,
        iqr,
        n: stats.n,
        missing: stats.missing,
        total: clubShots.length,
        reliable: broadN >= 10,
        potential: potential?.potential ?? null,
        potentialN: potential?.n ?? 0,
        potentialReliable: potential?.reliable ?? false,
        speed: metricStats(clubShots, fields.speed),
        launch: metricStats(clubShots, fields.launch),
        apex: metricStats(clubShots, fields.apex),
        rating: ratingsByClub.get(club) ?? null,
        benchmark: comparison
          ? {
              value: comparison.typical.value,
              reference: comparison.compatible ? ref!.valueM : null,
              compatible: comparison.compatible,
              reason: comparison.reason,
            }
          : null,
        direction,
      };
    });
}
