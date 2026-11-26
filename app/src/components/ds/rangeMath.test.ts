import { describe, expect, it } from 'vitest';
import { clamp, normalizeRange, percent } from './rangeMath';

describe('rangeMath', () => {
  it('clamps to bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('snaps to step and keeps thumbs ordered', () => {
    expect(normalizeRange([3.2, 7.8], 0, 10, 1)).toEqual([3, 8]);
    expect(normalizeRange([8, 2], 0, 10, 1)).toEqual([2, 8]);
    expect(normalizeRange([-5, 99], 0, 10, 1)).toEqual([0, 10]);
  });

  it('maps values to track percentages', () => {
    expect(percent(0, 0, 100)).toBe(0);
    expect(percent(50, 0, 100)).toBe(50);
    expect(percent(200, 0, 100)).toBe(100);
    expect(percent(5, 10, 10)).toBe(0);
  });
});
