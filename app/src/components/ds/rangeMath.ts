/** Pure helpers for the two-thumb RangeSlider — unit-tested without a DOM. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Snap and order a [lo, hi] range: both thumbs clamp to [min, max], snap to
 * step, and never cross (lo <= hi).
 */
export function normalizeRange(
  [lo, hi]: [number, number],
  min: number,
  max: number,
  step: number,
): [number, number] {
  const snap = (v: number) => Math.round(v / step) * step;
  const a = clamp(snap(lo), min, max);
  const b = clamp(snap(hi), min, max);
  return a <= b ? [a, b] : [b, a];
}

/** Percentage position of a value inside [min, max] — used for track fills. */
export function percent(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return ((clamp(value, min, max) - min) / (max - min)) * 100;
}
