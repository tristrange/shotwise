import { metricStats } from './analytics';
import { clubShotGroups } from './recap';
import {
  BASES,
  clubOrder,
  isUnknownClub,
  type Basis,
  type Dataset,
  type Session,
  type Shot,
} from './model';

export const COMPARE_INTENTS = ['all', 'full', 'partial', 'unknown'] as const;
export type CompareIntent = (typeof COMPARE_INTENTS)[number];

export type MetricStats = ReturnType<typeof metricStats>;

export type CompareSide = {
  session: Session | null;
  /** False when the ID is unknown or the session is archived. */
  available: boolean;
  recorded: number;
  included: number;
  afterIntent: number;
};

export type ClubCount = { club: string; included: number };

export type ClubComparison = {
  club: string;
  reference: { included: number; carry: MetricStats };
  comparison: { included: number; carry: MetricStats };
  /** Signed median-carry difference: comparison minus reference. */
  carryDelta: number | null;
  /** Signed IQR difference: comparison minus reference. */
  iqrDelta: number | null;
};

export type SessionComparison = {
  basis: Basis;
  basisLabel: string;
  intent: CompareIntent;
  duplicate: boolean;
  reference: CompareSide;
  comparison: CompareSide;
  common: ClubComparison[];
  referenceOnly: ClubCount[];
  comparisonOnly: ClubCount[];
};

const byClub = (a: string, b: string) =>
  clubOrder(a) - clubOrder(b) || a.localeCompare(b);

function sideResult(
  data: Dataset,
  sessionId: string,
  intent: CompareIntent,
): CompareSide {
  const session = data.sessions.find((item) => item.id === sessionId) ?? null;
  const shots = data.shots.filter((shot) => shot.sessionId === sessionId);
  const included = shots.filter(
    (shot) => shot.review.exclusion.kind === 'included',
  );
  const afterIntent = included.filter(
    (shot) => intent === 'all' || shot.review.intent === intent,
  );
  return {
    session,
    available: session !== null && !session.archived,
    recorded: shots.length,
    included: included.length,
    afterIntent: afterIntent.length,
  };
}

/**
 * Compare two sessions by exact ID. Both sides use the complete non-archived
 * included effective-club population, independent of any Recent window or
 * hidden-mishit flag, with the same basis and intent filter applied to each.
 */
export function compareSessions(
  data: Dataset,
  referenceId: string,
  comparisonId: string,
  basis: Basis,
  intent: CompareIntent = 'all',
): SessionComparison {
  const duplicate = referenceId === comparisonId;
  const reference = sideResult(data, referenceId, intent);
  const comparison = sideResult(data, comparisonId, intent);
  const result: SessionComparison = {
    basis,
    basisLabel: BASES[basis].label,
    intent,
    duplicate,
    reference,
    comparison,
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
  const carryKey = BASES[basis].carry;
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
        reference: { included: referenceShots.length, carry: referenceCarry },
        comparison: {
          included: comparisonShots.length,
          carry: comparisonCarry,
        },
        carryDelta:
          referenceCarry.median !== null && comparisonCarry.median !== null
            ? comparisonCarry.median - referenceCarry.median
            : null,
        iqrDelta:
          referenceCarry.iqr !== null && comparisonCarry.iqr !== null
            ? comparisonCarry.iqr - referenceCarry.iqr
            : null,
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
