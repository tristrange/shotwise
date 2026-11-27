/**
 * Shared score-to-colour band for every numerical performance rating
 * (ScoreRing arc, ScoreBar fill, breakdown numbers). Purely a VISUAL band
 * on the displayed 0–100 score — not a validated golfer skill class.
 *
 * Bands (on the DISPLAYED rounded score, so colour always matches the number
 * the user reads):
 *   0–39   critical (muted red)
 *   40–59  low      (muted orange)
 *   60–74  mid      (amber)
 *   75–89  good     (soft yellow-green)
 *   90–100 high     (green)
 *   missing/withheld → none (neutral grey)
 *
 * The band is rendered as a `data-band` attribute; ds.css maps each band to
 * the semantic `--rating-*` tokens, so components never hard-code colours.
 * Ordinary distance charts and comparison series are deliberately NOT
 * banded — this mapping is only for rating indicators.
 */
export type ScoreBand = 'critical' | 'low' | 'mid' | 'good' | 'high' | 'none';

export function scoreBand(score: number | null): ScoreBand {
  if (score === null || !Number.isFinite(score)) return 'none';
  const rounded = Math.round(Math.min(100, Math.max(0, score)));
  if (rounded <= 39) return 'critical';
  if (rounded <= 59) return 'low';
  if (rounded <= 74) return 'mid';
  if (rounded <= 89) return 'good';
  return 'high';
}
