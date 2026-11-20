import { directionStats, metricStats, reviewCoverage } from './analytics';
import { equipmentByCohort, type LabelEquipmentSummary } from './equipment';
import {
  clubShotGroups,
  recapCohorts,
  SUBSTANTIAL_SHARE_CHANGE,
} from './recap';
import {
  BASES,
  clubOrder,
  isUnknownClub,
  venueKey,
  type Basis,
  type Dataset,
  type MetricKey,
  type Session,
  type Shot,
} from './model';

export const COMPARE_INTENTS = ['all', 'full', 'partial', 'unknown'] as const;
export type CompareIntent = (typeof COMPARE_INTENTS)[number];

/** Measured carries needed on both sides before the reviewed typical cohort is used. */
export const MIN_TYPICAL_MEASURED = 10;
/** Measured shots needed per side before a relative (percentage) change is shown. */
export const MIN_PCT_MEASURED = 4;
/** Measured shots per side that make an IQR (and sparse marking) meaningful. */
export const MIN_SPREAD_MEASURED = 4;
/** Contact-reviewed full swings below this count are marked as thin. */
export const MIN_REVIEWED_FULL = 4;

export type MetricStats = ReturnType<typeof metricStats>;
export type Shares = { left: number; straight: number; right: number };

export type SideMix = {
  /** Share of measured carries with unknown intent. */
  unknownIntentShare: number | null;
  /** Share of measured carries with a recorded target distance. */
  targetedShare: number | null;
  /** Share of intent-filtered shots with a carry measurement on the selected basis. */
  coverageShare: number | null;
};

export type CompareSide = {
  session: Session | null;
  /** False when the ID is unknown or the session is archived. */
  available: boolean;
  recorded: number;
  included: number;
  afterIntent: number;
  /** Intent-filtered shot counts by intent. */
  intents: Record<Shot['review']['intent'], number>;
  /** Intent-filtered shots with a carry measurement on the selected basis. */
  carryMeasured: number;
  carryMissing: number;
  mix: SideMix;
};

export type ClubCount = { club: string; included: number };

/** A median metric on both sides with a neutral signed difference. */
export type MetricComparison = {
  reference: MetricStats;
  comparison: MetricStats;
  /** Signed median difference in native units: comparison minus reference. */
  delta: number | null;
  /** Relative change; only for carry and speed, when coverage supports it. */
  pctDelta: number | null;
};

export type DirectionSide = {
  n: number;
  missing: number;
  left: number;
  straight: number;
  right: number;
  /** Shares of measured shots; null when nothing is measured. */
  shares: Shares | null;
};

export type DirectionComparison = {
  reference: DirectionSide;
  comparison: DirectionSide;
  /** Signed share differences in percentage points: comparison minus reference. */
  deltaPp: Shares | null;
};

export type ReviewSide = {
  /** Full-intent shots, reviewed or still unassessed. */
  fullSwings: number;
  /** Full-intent shots with contact reviewed. */
  reviewed: number;
  unassessed: number;
  /** Confirmed mishits over reviewed full swings. */
  mishits: number;
  rate: number | null;
  /** Share of full swings with contact reviewed. */
  reviewedShare: number | null;
  /** Counts are shown when coverage is thin. */
  thin: boolean;
};

export type ReviewComparison = {
  reference: ReviewSide;
  comparison: ReviewSide;
  rateDeltaPp: number | null;
  reviewedShareDeltaPp: number | null;
};

/**
 * Shared typical carry: the reviewed typical full-swing cohort when each side
 * has at least MIN_TYPICAL_MEASURED measured carries in it, otherwise the same
 * labelled broader recap cohort on both sides, otherwise withheld (notably in
 * a partial-only view, where no full-swing benchmark exists).
 */
export type TypicalCarry =
  | {
      kind: 'reviewed' | 'broader';
      label: string;
      reference: MetricStats;
      comparison: MetricStats;
      delta: number | null;
      pctDelta: number | null;
    }
  | { kind: 'unavailable'; reason: string };

export type ClubComparison = {
  club: string;
  reference: {
    included: number;
    carry: MetricStats;
    equipment: LabelEquipmentSummary;
  };
  comparison: {
    included: number;
    carry: MetricStats;
    equipment: LabelEquipmentSummary;
  };
  /** Signed median-carry difference: comparison minus reference. */
  carryDelta: number | null;
  /** Relative carry change when the reference is positive and coverage supports it. */
  carryPctDelta: number | null;
  /** Signed IQR difference: comparison minus reference. */
  iqrDelta: number | null;
  /** True when either side has fewer than MIN_SPREAD_MEASURED measured carries. */
  sparse: boolean;
  typical: TypicalCarry;
  flight: {
    speed: MetricComparison;
    launch: MetricComparison;
    apex: MetricComparison;
  };
  direction: {
    launchDirection: DirectionComparison;
    curve: DirectionComparison;
    lateral: DirectionComparison;
  };
  review: ReviewComparison;
};

export type SessionComparison = {
  basis: Basis;
  basisLabel: string;
  intent: CompareIntent;
  duplicate: boolean;
  reference: CompareSide;
  comparison: CompareSide;
  venueDiffers: boolean;
  shotMixDiffers: boolean;
  coverageDiffers: boolean;
  common: ClubComparison[];
  referenceOnly: ClubCount[];
  comparisonOnly: ClubCount[];
};

const TYPICAL_LABELS = {
  reviewed: 'reviewed full swings with typical contact',
  broader:
    'broader recap cohort (full-swing candidates without reviewed mishits)',
} as const;

const byClub = (a: string, b: string) =>
  clubOrder(a) - clubOrder(b) || a.localeCompare(b);

function signedDelta(reference: MetricStats, comparison: MetricStats) {
  return reference.median !== null && comparison.median !== null
    ? comparison.median - reference.median
    : null;
}

/** Relative change only for a positive reference with enough measured shots per side. */
function pctDelta(reference: MetricStats, comparison: MetricStats) {
  if (
    reference.median === null ||
    reference.median <= 0 ||
    comparison.median === null ||
    reference.n < MIN_PCT_MEASURED ||
    comparison.n < MIN_PCT_MEASURED
  ) {
    return null;
  }
  return (comparison.median - reference.median) / reference.median;
}

function metricComparison(
  referenceShots: Shot[],
  comparisonShots: Shot[],
  key: MetricKey,
  withPct: boolean,
): MetricComparison {
  const reference = metricStats(referenceShots, key);
  const comparison = metricStats(comparisonShots, key);
  return {
    reference,
    comparison,
    delta: signedDelta(reference, comparison),
    pctDelta: withPct ? pctDelta(reference, comparison) : null,
  };
}

function directionSide(shots: Shot[], key: MetricKey): DirectionSide {
  const stats = directionStats(shots, key);
  const shares =
    stats.n > 0
      ? {
          left: stats.left / stats.n,
          straight: stats.straight / stats.n,
          right: stats.right / stats.n,
        }
      : null;
  return {
    n: stats.n,
    missing: stats.missing,
    left: stats.left,
    straight: stats.straight,
    right: stats.right,
    shares,
  };
}

function directionComparison(
  referenceShots: Shot[],
  comparisonShots: Shot[],
  key: MetricKey,
): DirectionComparison {
  const reference = directionSide(referenceShots, key);
  const comparison = directionSide(comparisonShots, key);
  const deltaPp =
    reference.shares !== null && comparison.shares !== null
      ? {
          left: (comparison.shares.left - reference.shares.left) * 100,
          straight:
            (comparison.shares.straight - reference.shares.straight) * 100,
          right: (comparison.shares.right - reference.shares.right) * 100,
        }
      : null;
  return { reference, comparison, deltaPp };
}

function reviewSide(shots: Shot[]): ReviewSide {
  const contact = reviewCoverage(shots);
  const full = contact.fullReviewed + contact.unassessed;
  return {
    fullSwings: full,
    reviewed: contact.fullReviewed,
    unassessed: contact.unassessed,
    mishits: contact.mishits,
    rate: contact.rate,
    reviewedShare: full ? contact.fullReviewed / full : null,
    thin: full > 0 && contact.fullReviewed < MIN_REVIEWED_FULL,
  };
}

function reviewComparison(
  referenceShots: Shot[],
  comparisonShots: Shot[],
): ReviewComparison {
  const reference = reviewSide(referenceShots);
  const comparison = reviewSide(comparisonShots);
  return {
    reference,
    comparison,
    rateDeltaPp:
      reference.rate !== null && comparison.rate !== null
        ? (comparison.rate - reference.rate) * 100
        : null,
    reviewedShareDeltaPp:
      reference.reviewedShare !== null && comparison.reviewedShare !== null
        ? (comparison.reviewedShare - reference.reviewedShare) * 100
        : null,
  };
}

function typicalCarry(
  referenceShots: Shot[],
  comparisonShots: Shot[],
  carryKey: MetricKey,
  intent: CompareIntent,
): TypicalCarry {
  const reviewed = (shots: Shot[]) =>
    metricStats(shots.filter(recapCohorts.reviewed), carryKey);
  const broader = (shots: Shot[]) =>
    metricStats(shots.filter(recapCohorts.broader), carryKey);
  const reviewedReference = reviewed(referenceShots);
  const reviewedComparison = reviewed(comparisonShots);
  if (
    reviewedReference.n >= MIN_TYPICAL_MEASURED &&
    reviewedComparison.n >= MIN_TYPICAL_MEASURED
  ) {
    return {
      kind: 'reviewed',
      label: TYPICAL_LABELS.reviewed,
      reference: reviewedReference,
      comparison: reviewedComparison,
      delta: signedDelta(reviewedReference, reviewedComparison),
      pctDelta: pctDelta(reviewedReference, reviewedComparison),
    };
  }
  const broaderReference = broader(referenceShots);
  const broaderComparison = broader(comparisonShots);
  if (broaderReference.n > 0 && broaderComparison.n > 0) {
    return {
      kind: 'broader',
      label: TYPICAL_LABELS.broader,
      reference: broaderReference,
      comparison: broaderComparison,
      delta: signedDelta(broaderReference, broaderComparison),
      pctDelta: pctDelta(broaderReference, broaderComparison),
    };
  }
  return {
    kind: 'unavailable',
    reason:
      intent === 'partial'
        ? 'The full-swing benchmark is unavailable in a partial-only view.'
        : 'Typical carry needs measured full-swing carries in both sessions.',
  };
}

function sideResult(
  data: Dataset,
  sessionId: string,
  intent: CompareIntent,
  carryKey: MetricKey,
): CompareSide {
  const session = data.sessions.find((item) => item.id === sessionId) ?? null;
  const shots = data.shots.filter((shot) => shot.sessionId === sessionId);
  const included = shots.filter(
    (shot) => shot.review.exclusion.kind === 'included',
  );
  const selected = included.filter(
    (shot) => intent === 'all' || shot.review.intent === intent,
  );
  const intents: CompareSide['intents'] = {
    full: 0,
    partial: 0,
    unknown: 0,
  };
  let carryMeasured = 0;
  let unknownIntent = 0;
  let targeted = 0;
  for (const shot of selected) {
    intents[shot.review.intent]++;
    if (shot.measurements[carryKey] === null) continue;
    carryMeasured++;
    if (shot.review.intent === 'unknown') unknownIntent++;
    if ((shot.measurements.target ?? 0) > 0) targeted++;
  }
  return {
    session,
    available: session !== null && !session.archived,
    recorded: shots.length,
    included: included.length,
    afterIntent: selected.length,
    intents,
    carryMeasured,
    carryMissing: selected.length - carryMeasured,
    mix: {
      unknownIntentShare: carryMeasured ? unknownIntent / carryMeasured : null,
      targetedShare: carryMeasured ? targeted / carryMeasured : null,
      coverageShare: selected.length ? carryMeasured / selected.length : null,
    },
  };
}

function differs(a: number | null, b: number | null) {
  return (
    a !== null &&
    b !== null &&
    Math.abs(a - b) >= SUBSTANTIAL_SHARE_CHANGE - Number.EPSILON
  );
}

/**
 * Compare two sessions by exact ID. Both sides use the complete non-archived
 * included effective-club population, independent of any Recent window or
 * hidden-mishit flag, with the same basis and intent filter applied to each.
 * Source rows, review fields, and recorded club labels stay untouched.
 */
export function compareSessions(
  data: Dataset,
  referenceId: string,
  comparisonId: string,
  basis: Basis,
  intent: CompareIntent = 'all',
): SessionComparison {
  const duplicate = referenceId === comparisonId;
  const carryKey = BASES[basis].carry;
  const reference = sideResult(data, referenceId, intent, carryKey);
  const comparison = sideResult(data, comparisonId, intent, carryKey);
  const referenceVenue = reference.session ? venueKey(reference.session) : '';
  const comparisonVenue = comparison.session
    ? venueKey(comparison.session)
    : '';
  const result: SessionComparison = {
    basis,
    basisLabel: BASES[basis].label,
    intent,
    duplicate,
    reference,
    comparison,
    venueDiffers: Boolean(
      referenceVenue && comparisonVenue && referenceVenue !== comparisonVenue,
    ),
    shotMixDiffers:
      differs(
        reference.afterIntent
          ? reference.intents.partial / reference.afterIntent
          : null,
        comparison.afterIntent
          ? comparison.intents.partial / comparison.afterIntent
          : null,
      ) ||
      differs(
        reference.mix.unknownIntentShare,
        comparison.mix.unknownIntentShare,
      ) ||
      differs(reference.mix.targetedShare, comparison.mix.targetedShare),
    coverageDiffers: differs(
      reference.mix.coverageShare,
      comparison.mix.coverageShare,
    ),
    common: [],
    referenceOnly: [],
    comparisonOnly: [],
  };
  if (duplicate || !reference.available || !comparison.available) return result;

  const groups = clubShotGroups({
    ...data,
    sessions: data.sessions.filter(
      ({ id }) => id === referenceId || id === comparisonId,
    ),
  });
  const fields = BASES[basis];
  const matchesIntent = (shot: Shot) =>
    intent === 'all' || shot.review.intent === intent;
  const collect = (sessionId: string) => {
    const clubs = new Map<string, Shot[]>();
    for (const [club, shots] of groups.get(sessionId) ?? []) {
      if (isUnknownClub(club)) continue;
      const filtered = shots.filter(matchesIntent);
      if (filtered.length > 0) clubs.set(club, filtered);
    }
    return clubs;
  };
  const referenceClubs = collect(referenceId);
  const comparisonClubs = collect(comparisonId);
  const equipmentForShots = equipmentByCohort(data);

  result.common = [...referenceClubs.keys()]
    .filter((club) => comparisonClubs.has(club))
    .sort(byClub)
    .map((club) => {
      const referenceShots = referenceClubs.get(club) ?? [];
      const comparisonShots = comparisonClubs.get(club) ?? [];
      const referenceCarry = metricStats(referenceShots, carryKey);
      const comparisonCarry = metricStats(comparisonShots, carryKey);
      return {
        club,
        reference: {
          included: referenceShots.length,
          carry: referenceCarry,
          equipment: equipmentForShots(referenceShots),
        },
        comparison: {
          included: comparisonShots.length,
          carry: comparisonCarry,
          equipment: equipmentForShots(comparisonShots),
        },
        carryDelta: signedDelta(referenceCarry, comparisonCarry),
        carryPctDelta: pctDelta(referenceCarry, comparisonCarry),
        iqrDelta:
          referenceCarry.iqr !== null && comparisonCarry.iqr !== null
            ? comparisonCarry.iqr - referenceCarry.iqr
            : null,
        sparse:
          referenceCarry.n < MIN_SPREAD_MEASURED ||
          comparisonCarry.n < MIN_SPREAD_MEASURED,
        typical: typicalCarry(
          referenceShots,
          comparisonShots,
          carryKey,
          intent,
        ),
        flight: {
          speed: metricComparison(
            referenceShots,
            comparisonShots,
            fields.speed,
            true,
          ),
          launch: metricComparison(
            referenceShots,
            comparisonShots,
            fields.launch,
            false,
          ),
          apex: metricComparison(
            referenceShots,
            comparisonShots,
            fields.apex,
            false,
          ),
        },
        direction: {
          launchDirection: directionComparison(
            referenceShots,
            comparisonShots,
            'launchDirection',
          ),
          curve: directionComparison(referenceShots, comparisonShots, 'curve'),
          lateral: directionComparison(
            referenceShots,
            comparisonShots,
            'fromCentre',
          ),
        },
        review: reviewComparison(referenceShots, comparisonShots),
      };
    });

  const oneSided = (
    clubs: Map<string, Shot[]>,
    other: Map<string, Shot[]>,
  ): ClubCount[] =>
    [...clubs.entries()]
      .filter(([club]) => !other.has(club))
      .map(([club, shots]) => ({ club, included: shots.length }))
      .sort((a, b) => byClub(a.club, b.club));
  result.referenceOnly = oneSided(referenceClubs, comparisonClubs);
  result.comparisonOnly = oneSided(comparisonClubs, referenceClubs);
  return result;
}
