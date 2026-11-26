import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { axisTick, ChartContainer, ChartTooltipContent, type ChartPoint } from './ChartKit';
import { clamp, usePrefersReducedMotion } from './hooks';

/**
 * Props handed to a custom dot renderer: the positioned dot plus the original
 * datum in `payload` (Recharts passes it through), so a dot can select its
 * exact point instead of the nearest one.
 */
type TrendDotProps = {
  cx?: number;
  cy?: number;
  r?: number | string;
  value?: number | null;
  payload?: ChartPoint & { masked?: boolean };
};

/**
 * Split the series into contiguous runs at every `unordered` boundary. A
 * connecting line between same-day visits whose order is not chronologically
 * known would imply a within-day trajectory that was never measured, so the
 * segment is simply not drawn (the points themselves stay). Same-day visits
 * with distinct recorded times keep `unordered` unset and stay connected.
 */
function orderedRuns(data: readonly ChartPoint[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  data.forEach((point, i) => {
    if (i > 0 && point.unordered) {
      ranges.push([start, i - 1]);
      start = i;
    }
  });
  if (data.length) ranges.push([start, data.length - 1]);
  return ranges;
}

/**
 * One dot renderer pair per series colour. A real (unmasked, measured) point
 * renders as an accessible control (role="button", focusable, aria-label,
 * Enter/Space) when onSelect is provided, so a direct tap on the point
 * selects exactly that visit — the route that works on phone WebKit, where
 * the chart-level click alone can leave the selection empty. Masked gap
 * points and unmeasured points render no dot, exactly as before.
 */
function makeDot({
  fill,
  radius,
  activeRadius,
  onSelect,
}: {
  fill: string;
  radius: number;
  activeRadius: number;
  onSelect?: (point: ChartPoint) => void;
}) {
  const selectable = (point: ChartPoint) =>
    onSelect
      ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': `Select ${point.label}`,
          style: { cursor: 'pointer' as const },
          onClick: (event: React.MouseEvent<SVGCircleElement>) => {
            event.stopPropagation();
            onSelect(point);
          },
          onKeyDown: (event: React.KeyboardEvent<SVGCircleElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onSelect(point);
            }
          },
        }
      : {};
  const dot = (props: TrendDotProps) => {
    const point = props.payload;
    if (!point || point.masked || props.value == null) return null;
    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={radius}
        className="trend-dot"
        fill={fill}
        strokeWidth={0}
        {...selectable(point)}
      />
    );
  };
  const activeDot = (props: TrendDotProps) => {
    const point = props.payload;
    if (!point || point.masked || props.value == null) return null;
    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={activeRadius}
        className="trend-dot trend-dot-active"
        fill={fill}
        strokeWidth={0}
      />
    );
  };
  return { dot, activeDot };
}

/**
 * Interactive trend chart (reference: interactive-charts screenshot). One
 * primary series with visible points; hover or tap shows the shared tooltip,
 * and every point is itself an accessible control that reports the exact
 * point through onSelect. The chart-level click (nearest point) and the
 * caller's native picker remain as alternative selection routes. An optional
 * comparison series (`compare`, e.g. strong-strike potential next to median
 * carry) renders as a dashed `--compare` line so the two stay
 * distinguishable. Missing values stay gaps — never zero. Animation is
 * disabled for reduced-motion users.
 */
export function TrendChart({
  data,
  unit,
  height = 220,
  label,
  onSelect,
  compare,
  name,
}: {
  data: ChartPoint[];
  unit: string;
  height?: number;
  label: string;
  onSelect?: (point: ChartPoint) => void;
  /** Comparison series label; rendered only when at least one point carries a compare value. */
  compare?: string;
  /** Short primary-series name for multi-series tooltips (defaults to `label`). */
  name?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const hasCompare =
    compare !== undefined && data.some((point) => point.compare !== undefined);
  const values = data
    .flatMap((point) => [point.value, hasCompare ? point.compare : null])
    .filter((v): v is number => v !== null && v !== undefined);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = (max - min) * 0.15 || Math.max(1, max * 0.05);
  // One full-length masked copy of the data per run: points outside the run
  // carry null (a gap, never zero) plus a `masked` marker so the shared
  // tooltip can drop the masked series rows. Index alignment — and therefore
  // every x position — stays identical to the full series.
  const runs = useMemo(() => orderedRuns(data), [data]);
  const series = useMemo(
    () =>
      runs.map(([from, to]) =>
        data.map((point, i) =>
          i >= from && i <= to
            ? point
            : { ...point, value: null, compare: null, masked: true },
        ),
      ),
    [runs, data],
  );
  const primaryDot = useMemo(
    () => makeDot({ fill: 'var(--data)', radius: 3.5, activeRadius: 6, onSelect }),
    [onSelect],
  );
  const compareDot = useMemo(
    () => makeDot({ fill: 'var(--compare)', radius: 3, activeRadius: 5, onSelect }),
    [onSelect],
  );
  return (
    <ChartContainer label={label} height={height}>
      <AreaChart
        data={data}
        // No negative left margin: the y-axis labels must keep their full
        // width (e.g. "160.4") inside the chart instead of being clipped.
        margin={{ top: 10, right: 6, bottom: 0, left: 0 }}
        onClick={(state) => {
          const activeLabel = state?.activeLabel;
          const point =
            activeLabel != null
              ? data.find((p) => p.label === String(activeLabel))
              : undefined;
          if (point && onSelect) onSelect(point);
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[min - pad, max + pad]}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1))}
        />
        <Tooltip
          content={<ChartTooltipContent unit={unit} />}
          cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
          isAnimationActive={!reduced}
        />
        {series.map((points, runIndex) => (
          <Area
            key={runIndex}
            data={points}
            type="monotone"
            dataKey="value"
            name={name ?? label}
            stroke="var(--data)"
            strokeWidth={2.5}
            fill="var(--data)"
            fillOpacity={0.14}
            connectNulls={false}
            isAnimationActive={!reduced}
            dot={primaryDot.dot}
            activeDot={primaryDot.activeDot}
          />
        ))}
        {hasCompare &&
          series.map((points, runIndex) => (
            <Line
              key={`compare-${runIndex}`}
              data={points}
              type="monotone"
              dataKey="compare"
              name={compare}
              stroke="var(--compare)"
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
              connectNulls={false}
              isAnimationActive={!reduced}
              dot={compareDot.dot}
              activeDot={compareDot.activeDot}
            />
          ))}
      </AreaChart>
    </ChartContainer>
  );
}

/** Clamp a score to the 0–100 display range. */
export const scorePercent = (score: number | null) =>
  score === null ? null : clamp(Math.round(score), 0, 100);
