import { clamp } from './hooks';

export type SparklinePoint = number | null;

/**
 * Compact inline trend. Null values break the line — missing is never zero.
 * Decorative by default; pass `label` to make it an accessible image.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  label,
}: {
  values: SparklinePoint[];
  width?: number;
  height?: number;
  label?: string;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (!present.length) return null;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const x = (i: number) => i * step;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  // Split into contiguous segments at nulls.
  const segments: string[] = [];
  let current = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current.trim());
      current = '';
      return;
    }
    current += `${x(i).toFixed(1)},${clamp(y(v), 1, height - 1).toFixed(1)} `;
  });
  if (current) segments.push(current.trim());
  const lastValue = present[present.length - 1]!;
  const lastIndex = values.lastIndexOf(lastValue);
  return (
    <svg
      className="ds-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {segments.map((segment, i) => (
        <polyline key={i} points={segment} />
      ))}
      <circle cx={x(lastIndex)} cy={clamp(y(lastValue), 1, height - 1)} r={2.5} />
    </svg>
  );
}
