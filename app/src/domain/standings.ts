import {
  CATEGORY_SCORE_ORDER,
  type CategoryScoreId,
  type CategoryScores,
} from './scores';

/**
 * Within-bag standing per category (roadmap §8.3, ADR-0004).
 *
 * The overall-score decision in ADR-0004 is: **no composite 0–100 number** —
 * carry (m), direction (deg) and mishit share are incommensurable, external
 * reference datasets are link-only, so any weights would be arbitrary. What
 * is defensible is each club's standing among the golfer's own clubs on the
 * same basis and window: same population, same units per category, fully
 * explainable. Only categories with sufficient data participate; a club with
 * an insufficient category gets no standing for it (null), never a fake rank.
 */

export type CategoryStanding = {
  /** Competition ranking: tied values share a rank (1, 2, 2, 4). 1 = best. */
  rank: number;
  /** Number of clubs with sufficient data in this category. */
  of: number;
};

export type BagStandings = Record<string, Record<CategoryScoreId, CategoryStanding | null>>;

export function bagStandings(
  entries: { club: string; scores: CategoryScores }[],
): BagStandings {
  const result = {} as BagStandings;
  for (const { club } of entries) {
    result[club] = {
      distancePotential: null,
      consistency: null,
      directionalControl: null,
      reliability: null,
    };
  }
  for (const id of CATEGORY_SCORE_ORDER) {
    const eligible = entries.filter(
      (e) => e.scores[id].sufficient && e.scores[id].value !== null,
    );
    const better = eligible[0]?.scores[id].betterDirection ?? 'higher';
    const sorted = [...eligible].sort((a, b) => {
      const va = a.scores[id].value!;
      const vb = b.scores[id].value!;
      return better === 'higher' ? vb - va : va - vb;
    });
    let rank = 0;
    let lastValue: number | null = null;
    sorted.forEach((entry, index) => {
      const value = entry.scores[id].value!;
      if (lastValue === null || value !== lastValue) rank = index + 1;
      lastValue = value;
      const row = result[entry.club];
      if (row) row[id] = { rank, of: sorted.length };
    });
  }
  return result;
}

/** "1st", "2nd", "3rd", "4th", … */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
