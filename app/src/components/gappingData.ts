import {
  clubGaps,
  type AnalysisQuery,
  type ClubGap,
} from '../domain/analytics';
import type { Basis, Dataset } from '../domain/model';
import { sharedBandScale, type DistributionBand } from './charts';

/** One club's gapping row, ready for the shared-scale chart and the gap list. */
export type GappingRow = {
  club: string;
  /** Carry distribution of the mode-invariant band cohort: P10–P90 + IQR + median. */
  band: DistributionBand;
  /** Strong-strike potential (P80 carry, ADR-0002); null below 10 measured. */
  potential: number | null;
  /** Measured carries in the selected cohort. */
  n: number;
  /** False when the band cohort has fewer than the approved minimum samples. */
  reliable: boolean;
  /** Median-carry difference to the next longer club; null for the longest. */
  gap: number | null;
  flag: ClubGap['flag'];
};

export type GappingView = {
  rows: GappingRow[];
  /**
   * The one distance axis every distribution row shares: padded outward over
   * all band values and all strong-strike potentials, so clubs read against
   * each other on the same scale.
   */
  scale: { min: number; max: number };
};

/**
 * Presentation assembly for the gapping screen. Everything comes from the
 * tested `clubGaps` domain function — the band cohort (P10–P90/IQR), the
 * mode-invariant P80 potential and the approved adjacent-gap flags are never
 * recomputed here.
 */
export function gappingView(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): GappingView {
  const rows: GappingRow[] = clubGaps(data, basis, query).map((row) => ({
    club: row.club,
    band: {
      p10: row.low,
      q1: row.q1,
      median: row.median,
      q3: row.q3,
      p90: row.high,
    },
    potential: row.potential,
    n: row.n,
    reliable: row.reliable,
    gap: row.gap,
    flag: row.flag,
  }));
  const scale = sharedBandScale(
    rows.flatMap((row) =>
      // Potential markers share the axis, so include them in the scale.
      row.potential === null
        ? [row.band]
        : [
            row.band,
            {
              p10: row.potential,
              q1: null,
              median: row.potential,
              q3: null,
              p90: row.potential,
            },
          ],
    ),
  );
  return { rows, scale };
}

/** One adjacent pair: the longer club above versus the club below it. */
export type GapPair = {
  upper: string;
  lower: string;
  /**
   * Signed median-carry gap (upper minus lower). Preserved as null when the
   * domain did not compute one — a missing gap is never coerced to zero,
   * because a true 0 m gap and a missing gap mean different things.
   */
  gap: number | null;
  flag: ClubGap['flag'];
  /** True when both clubs carry the approved minimum of band samples. */
  bothReliable: boolean;
};

/** Adjacent pairs in club order (longest first); `rows[i].gap` belongs to rows[i] vs rows[i-1]. */
export function gapPairs(rows: readonly GappingRow[]): GapPair[] {
  return rows.slice(1).map((lower, i) => {
    const upper = rows[i]!;
    return {
      upper: upper.club,
      lower: lower.club,
      gap: lower.gap,
      flag: lower.flag,
      bothReliable: upper.reliable && lower.reliable,
    };
  });
}
