import {
  reviewCoverage,
  selectCohort,
  type AnalysisQuery,
} from './analytics';
import { resolveShots } from './assessment';
import { clubProfiles } from './clubProfiles';
import { BASES, type Basis, type Dataset } from './model';
import { MIN_POTENTIAL_SAMPLES } from './potential';
import { filterCohort } from './recap';
import { quantile } from './statistics';

/**
 * Category-score definitions for roadmap §8 (Phase 6, PR 18), versioned as
 * `category-scores-1`; see docs/adr/0003-category-scores.md.
 *
 * Four categories: distance potential, consistency, directional control and
 * reliability. Each is reported as its **raw metric in a native unit** with a
 * sample size and a sufficiency flag — never as a guessed number, and not yet
 * as a 0–100 composite (that decision is PR 20). Every category reuses the
 * existing cohort and statistic modules (recap cohorts, metricStats,
 * directionStats, clubStrongStrike), so no statistic is implemented twice.
 *
 * Population rules (roadmap §8.2, ADR-0002):
 * - Distance potential and consistency/reliability are always read from the
 *   broader populations, never from a strong-strike-filtered subset, so a
 *   potential view cannot inflate consistency.
 * - Directional control uses launch direction / from-centre when the session
 *   measured them; curvature alone is never treated as landing dispersion.
 * - Reliability counts manual and automatic (classifier) contact assessments
 *   alike, and reports how many full swings are still unassessed.
 */
export const CATEGORY_SCORES_VERSION = 'category-scores-1';

export type CategoryScoreId =
  | 'distancePotential'
  | 'consistency'
  | 'directionalControl'
  | 'reliability';

export type ScoreUnit = 'm' | 'deg' | 'share';

export type CategoryScoreAux = {
  label: string;
  value: number | null;
  unit: ScoreUnit;
};

export type CategoryScore = {
  id: CategoryScoreId;
  label: string;
  /** Raw metric in `unit`; null when there is not enough data. */
  value: number | null;
  unit: ScoreUnit;
  /** Higher is better for potential; lower is better for the others. */
  betterDirection: 'higher' | 'lower';
  n: number;
  /** Enough data to display the category at all. */
  sufficient: boolean;
  /** Why the value is missing or qualified, shown next to the score. */
  note: string | null;
  aux?: CategoryScoreAux[];
};

export type CategoryScores = Record<CategoryScoreId, CategoryScore>;

/** Human-readable definitions, also used for the scoring-methodology text. */
export const CATEGORY_SCORE_DEFINITIONS: Record<
  CategoryScoreId,
  { label: string; description: string; population: string; estimator: string }
> = {
  distancePotential: {
    label: 'Distance potential',
    description:
      'How much carry the golfer can generate when striking the club well.',
    population:
      'Full swings with non-mishit contact (manual or automatic), suspected wrong-club labels excluded.',
    estimator: 'Strong-strike carry: P80 of measured carries (ADR-0002).',
  },
  consistency: {
    label: 'Consistency',
    description: 'How predictable the club’s carry distance is.',
    population:
      'All resolved full swings, mishits and flagged shots included — never the strong-strike subset.',
    estimator: 'Carry IQR (needs 4 measured); lower tail P10 reported alongside (needs 20).',
  },
  directionalControl: {
    label: 'Directional control',
    description:
      'Launch direction relative to the intended line. Curvature alone is not treated as landing dispersion.',
    population: 'Resolved full swings with launch direction measured.',
    estimator: 'Median absolute launch direction (deg); median |from centre| alongside when measured.',
  },
  reliability: {
    label: 'Reliability',
    description: 'How often full swings end in a severe mishit.',
    population:
      'Resolved full swings with a known contact assessment (manual review or validated classifier).',
    estimator: 'Mishit share of assessed full swings; unassessed count always reported.',
  },
};

/** Same guards as the recap/profile displays. */
export const MIN_DIRECTIONAL_SAMPLES = 4;
export const MIN_RELIABILITY_SAMPLES = 10;

const medianAbs = (values: number[]) => {
  const abs = values.map((v) => Math.abs(v)).sort((a, b) => a - b);
  return abs.length ? quantile(abs, 0.5) : null;
};

/**
 * Category scores for one club on the given basis and analysis query. The
 * profile's existing numbers are reused verbatim (typical/potential/spread/
 * tail/contact come from `clubProfiles`); directional control and the
 * reliability rate are computed here from the same reliability cohort.
 */
export function categoryScores(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
  club: string,
): CategoryScores {
  const profile = clubProfiles(data, basis, query).find(
    (p) => p.club === club,
  );
  const resolved = resolveShots(data.shots, data.sessions, basis);
  // Same broader population the profile uses for reliability — never a
  // strong-strike subset.
  const selected = selectCohort(
    data.shots,
    data.sessions,
    { ...query, club, contact: 'all', hideLikelyMishits: false },
    basis,
  );
  const reliabilityShots = filterCohort(selected, resolved, 'reliability');

  const potential = profile?.recent.potential;
  const distancePotential: CategoryScore = {
    id: 'distancePotential',
    label: CATEGORY_SCORE_DEFINITIONS.distancePotential.label,
    value: potential?.value ?? null,
    unit: 'm',
    betterDirection: 'higher',
    n: potential?.n ?? 0,
    sufficient: potential?.reliable === true && potential.value !== null,
    note:
      potential?.value === null
        ? `Needs ${MIN_POTENTIAL_SAMPLES} measured full-swing carries on the ${BASES[basis].label} basis`
        : potential?.reliable === false
          ? 'Sample limited — treat as an early estimate'
          : null,
  };

  const spread = profile?.recent.spread;
  const lowerTail = profile?.recent.lowerTail;
  const consistency: CategoryScore = {
    id: 'consistency',
    label: CATEGORY_SCORE_DEFINITIONS.consistency.label,
    value: spread?.iqr ?? null,
    unit: 'm',
    betterDirection: 'lower',
    n: spread?.n ?? 0,
    sufficient: spread?.iqr !== null && spread?.iqr !== undefined,
    note:
      spread?.iqr === null || spread?.iqr === undefined
        ? 'Needs 4 measured carries'
        : null,
    aux: [
      {
        label: 'Lower carry tail (P10)',
        value: lowerTail?.p10 ?? null,
        unit: 'm',
      },
    ],
  };

  const directionValues = reliabilityShots.flatMap((s) =>
    s.measurements.launchDirection === null ? [] : [s.measurements.launchDirection],
  );
  const fromCentreValues = reliabilityShots.flatMap((s) =>
    s.measurements.fromCentre === null ? [] : [s.measurements.fromCentre],
  );
  const directionMedianAbs = medianAbs(directionValues);
  const directionalControl: CategoryScore = {
    id: 'directionalControl',
    label: CATEGORY_SCORE_DEFINITIONS.directionalControl.label,
    value: directionMedianAbs,
    unit: 'deg',
    betterDirection: 'lower',
    n: directionValues.length,
    sufficient:
      directionValues.length >= MIN_DIRECTIONAL_SAMPLES &&
      directionMedianAbs !== null,
    note:
      directionValues.length === 0
        ? 'Not measured in this data — launch direction is missing'
        : directionValues.length < MIN_DIRECTIONAL_SAMPLES
          ? `Needs ${MIN_DIRECTIONAL_SAMPLES} shots with launch direction`
          : null,
    aux: [
      {
        label: 'Median |from centre|',
        value: medianAbs(fromCentreValues),
        unit: 'm',
      },
    ],
  };

  const coverage = reviewCoverage(reliabilityShots, resolved);
  let assessedFull = 0;
  let mishits = 0;
  for (const shot of reliabilityShots) {
    const contact = resolved.get(shot.id)?.contact;
    if (contact === undefined || contact === 'uncertain') continue;
    assessedFull += 1;
    if (contact === 'mishit') mishits += 1;
  }
  const rate = assessedFull ? mishits / assessedFull : null;
  const reliability: CategoryScore = {
    id: 'reliability',
    label: CATEGORY_SCORE_DEFINITIONS.reliability.label,
    value: rate,
    unit: 'share',
    betterDirection: 'lower',
    n: assessedFull,
    sufficient: assessedFull >= MIN_RELIABILITY_SAMPLES && rate !== null,
    note:
      assessedFull < MIN_RELIABILITY_SAMPLES
        ? `Needs ${MIN_RELIABILITY_SAMPLES} assessed full swings`
        : coverage.unassessed > 0
          ? `${coverage.unassessed} of ${coverage.total} full swings still unassessed`
          : null,
    aux: [
      {
        label: 'Assessed (manual or automatic)',
        value: coverage.total ? coverage.assessed / coverage.total : null,
        unit: 'share',
      },
    ],
  };

  return { distancePotential, consistency, directionalControl, reliability };
}
