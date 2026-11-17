export function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const offset = (sorted.length - 1) * p;
  const left = sorted[Math.floor(offset)];
  const right = sorted[Math.ceil(offset)];
  return left === undefined || right === undefined
    ? null
    : left + (right - left) * (offset % 1);
}
