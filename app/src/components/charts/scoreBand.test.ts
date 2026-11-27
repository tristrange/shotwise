import { describe, expect, it } from 'vitest';
import { scoreBand } from './scoreBand';

/**
 * Boundary tests for the shared rating colour band. The band must follow the
 * DISPLAYED rounded score, so 39.5 displays "40" and is banded as 40–59.
 */
describe('scoreBand', () => {
  it('maps every required boundary to its band', () => {
    const cases: [number | null, ReturnType<typeof scoreBand>][] = [
      [0, 'critical'],
      [39, 'critical'],
      [40, 'low'],
      [59, 'low'],
      [60, 'mid'],
      [74, 'mid'],
      [75, 'good'],
      [89, 'good'],
      [90, 'high'],
      [100, 'high'],
      [null, 'none'],
    ];
    for (const [score, band] of cases) {
      expect(scoreBand(score), `score ${score}`).toBe(band);
    }
  });

  it('uses the displayed rounded score for the band', () => {
    expect(scoreBand(39.4)).toBe('critical'); // displays 39
    expect(scoreBand(39.5)).toBe('low'); // displays 40
    expect(scoreBand(59.5)).toBe('mid'); // displays 60
    expect(scoreBand(74.5)).toBe('good'); // displays 75
    expect(scoreBand(89.5)).toBe('high'); // displays 90
  });

  it('clamps out-of-range scores before banding', () => {
    expect(scoreBand(-12)).toBe('critical'); // displays 0
    expect(scoreBand(250)).toBe('high'); // displays 100
  });

  it('treats a genuine zero as critical, distinct from a withheld rating', () => {
    expect(scoreBand(0)).toBe('critical');
    expect(scoreBand(null)).toBe('none');
    expect(scoreBand(0)).not.toBe(scoreBand(null));
  });

  it('maps non-finite numbers to none (withheld, neutral)', () => {
    expect(scoreBand(NaN)).toBe('none');
    expect(scoreBand(Infinity)).toBe('none');
    expect(scoreBand(-Infinity)).toBe('none');
  });
});
