import {
  benchmarkClubGroups,
  directionStats,
  metricStats,
  selectCohort,
  type AnalysisSettings,
} from '../domain/analytics';
import { resolveShots } from '../domain/assessment';
import { clubProfiles, type ClubProfile } from '../domain/clubProfiles';
import { categoryScores, type CategoryScores } from '../domain/scores';
import {
  CORRIDOR_HALF_WIDTH,
  clubRole,
  clubRatings,
  type ClubRating,
} from '../domain/ratings';
import { compareWithReference, type ReferenceComparison } from '../domain/benchmarks';
import { filterCohort } from '../domain/recap';
import {
  BASES,
  localToday,
  type Basis,
  type Dataset,
  type MetricKey,
  type ReferenceStatistic,
  type ReferenceType,
  type Shot,
} from '../domain/model';
import { quantile } from '../domain/statistics';
import type { DispersionPoint, DistributionBand } from './charts';

/** Left / straight / right counts of a measured directional metric. */
export type DirectionCounts = {
  n: number;
  left: number;
  straight: number;
  right: number;
};

/**
 * Everything one full club profile renders, assembled from the existing
 * tested domain functions. Presentation never recomputes analytics:
 * - the profile domain (`clubProfiles`) supplies window, equipment, latest
 *   session, history, gap, best, typical/spread/tail/contact;
 * - the shared cohort functions supply launch-monitor metrics (same
 *   population as the Overview ClubCard) and the carry distribution band
 *   (the profile's reliability cohort, so band and spread always agree);
 * - `clubRatings` supplies the rating on the fixed premium-flat basis;
 * - `compareWithReference` supplies the personal-reference comparison.
 */
export type ClubProfileView = {
  profile: ClubProfile;
  scores: CategoryScores;
  rating: ClubRating | null;
  /** Selected-cohort launch-monitor metrics (same population as the Overview card). */
  speed: { median: number | null; n: number; missing: number };
  launch: { median: number | null; n: number; missing: number };
  apex: { median: number | null; n: number; missing: number };
  /** Benchmark-eligible selected shots for the club (the card's population). */
  total: number;
  /** Carry measured/missing within the selected cohort — same population as `total`. */
  carryMeasured: { n: number; missing: number };
  /** Carry distribution band from the reliability cohort (agrees with the profile spread). */
  band: DistributionBand;
  direction: {
    label: string;
    detail: string;
    counts: DirectionCounts | null;
    launchOnly: boolean;
  } | null;
  /** Shots with both carry and lateral finishing position measured, for the dispersion plot. */
  dispersion: DispersionPoint[] | null;
  corridorHalfWidth: number | null;
  /** Personal carry-reference comparison (null when no carry reference exists). */
  benchmark: {
    comparison: ReferenceComparison;
    referenceValueM: number;
    referenceType: ReferenceType;
    referenceStatistic: ReferenceStatistic;
  } | null;
};

/** Carry distribution band (P10–P90 + IQR + median) of a shot set, missing-safe. Shared by profile and wedge-practice views. */
export function carryBandOf(shots: Shot[], carryKey: MetricKey): DistributionBand {
  const stats = metricStats(shots, carryKey);
  const values = shots.flatMap((s) =>
    s.measurements[carryKey] === null ? [] : [s.measurements[carryKey]],
  );
  return {
    p10: stats.p10,
    q1: values.length >= 4 ? quantile(values, 0.25) : null,
    median: stats.median,
    q3: values.length >= 4 ? quantile(values, 0.75) : null,
    p90: stats.p90,
  };
}

export function clubProfileViews(
  data: Dataset,
  basis: Basis,
  settings: Pick<AnalysisSettings, 'mode' | 'intent' | 'contact' | 'hideLikelyMishits'>,
): ClubProfileView[] {
  const query = { ...settings, today: localToday() } as const;
  const profiles = clubProfiles(data, basis, query);
  const resolved = resolveShots(data.shots, data.sessions, basis);
  const fields = BASES[basis];
  const ratingsByClub = new Map(
    clubRatings(data, query, data.userReferenceValues).map((r) => [r.club, r]),
  );
  return profiles.map((profile) => {
    const club = profile.club;
    // Launch-monitor metrics: the same benchmark-eligible selected cohort the
    // Overview ClubCard uses, so both screens show identical numbers.
    const selected = selectCohort(data.shots, data.sessions, { ...query, club }, basis);
    const clubShots = benchmarkClubGroups(selected, resolved).get(club) ?? [];
    // Distribution band: the profile's reliability cohort (all resolved full
    // swings, mishits and flagged shots included) — the same population as
    // profile.recent.spread, so the plot and the spread line always agree.
    const reliability = filterCohort(
      selectCohort(
        data.shots,
        data.sessions,
        { ...query, club, contact: 'all', hideLikelyMishits: false },
        basis,
      ),
      resolved,
      'reliability',
    );
    // The band (and the profile's spread) come from the reliability cohort;
    // the measured/missing counts shown next to the selected-cohort launch
    // metrics must come from the selected cohort itself, so the coverage
    // popover never pairs a broad numerator with a narrow denominator.
    const band = carryBandOf(reliability, fields.carry);
    const selectedCarry = metricStats(clubShots, fields.carry);

    const lateral = directionStats(reliability, 'fromCentre');
    const launchDir = directionStats(reliability, 'launchDirection');
    const direction =
      lateral.n > 0
        ? {
            label: 'Lateral from centre',
            detail: `${lateral.n} of ${reliability.length} measured · ${lateral.left} left · ${lateral.straight} straight · ${lateral.right} right`,
            counts: { n: lateral.n, left: lateral.left, straight: lateral.straight, right: lateral.right },
            launchOnly: false,
          }
        : launchDir.n > 0
          ? {
              label: 'Launch direction',
              detail: `${launchDir.n} of ${reliability.length} measured · ${launchDir.left} left · ${launchDir.straight} straight · ${launchDir.right} right (no finishing-position data)`,
              counts: { n: launchDir.n, left: launchDir.left, straight: launchDir.straight, right: launchDir.right },
              launchOnly: true,
            }
          : null;

    // Dispersion graphics only where the data supports them: shots with both
    // carry and lateral finishing position measured. Never fabricated.
    const corridorHalfWidth = CORRIDOR_HALF_WIDTH[clubRole(club)];
    const dispersion: DispersionPoint[] = [];
    for (const shot of reliability) {
      const carry = shot.measurements[fields.carry];
      const fromCentre = shot.measurements.fromCentre;
      if (carry === null || carry <= 0 || fromCentre === null) continue;
      dispersion.push({
        id: shot.id,
        x: carry,
        y: fromCentre,
        label: `${club} shot: ${carry.toFixed(0)} m carry, ${fromCentre >= 0 ? '+' : ''}${fromCentre.toFixed(1)} m lateral`,
        title: `${carry.toFixed(1)} m carry · ${fromCentre >= 0 ? '+' : ''}${fromCentre.toFixed(1)} m from centre`,
      });
    }

    const ref = data.userReferenceValues.find(
      (r) =>
        r.metric === 'carry' &&
        r.club.trim().toLowerCase() === club.trim().toLowerCase(),
    );

    return {
      profile,
      scores: categoryScores(data, basis, query, club, profile),
      rating: ratingsByClub.get(club) ?? null,
      speed: metricStats(clubShots, fields.speed),
      launch: metricStats(clubShots, fields.launch),
      apex: metricStats(clubShots, fields.apex),
      total: clubShots.length,
      carryMeasured: { n: selectedCarry.n, missing: selectedCarry.missing },
      band,
      direction,
      dispersion: dispersion.length ? dispersion : null,
      corridorHalfWidth,
      benchmark: ref
        ? {
            comparison: compareWithReference(
              ref,
              {
                typical: profile.recent.typical.median,
                strong: profile.recent.potential.value,
              },
              basis,
            ),
            referenceValueM: ref.valueM,
            referenceType: ref.referenceType,
            referenceStatistic: ref.statistic,
          }
        : null,
    };
  });
}
