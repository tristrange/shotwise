import { describe, expect, it } from 'vitest';
import { wedgeScatterXDomain } from './WedgePractice';

describe('wedgeScatterXDomain', () => {
  it('covers every original shot position, including missing-carry shots', () => {
    // Regression guard: ten shots whose first five lack carry leave measured
    // points at x 6–10; an axis sized from the measured subset (0.5–5.5)
    // would clip them outside the plot viewport.
    const [lo, hi] = wedgeScatterXDomain(10);
    for (let i = 0; i < 10; i++) {
      const x = i + 1;
      expect(x).toBeGreaterThanOrEqual(lo);
      expect(x).toBeLessThanOrEqual(hi);
    }
    expect(wedgeScatterXDomain(10)).toEqual([0.5, 10.5]);
  });

  it('degenerates safely for empty or single-shot groups', () => {
    expect(wedgeScatterXDomain(0)).toEqual([0.5, 1.5]);
    expect(wedgeScatterXDomain(1)).toEqual([0.5, 1.5]);
  });
});
