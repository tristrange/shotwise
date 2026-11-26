import {
  Area,
  AreaChart,
  AreaRevealShape,
  CartesianGrid,
  Line,
  LineDrawShape,
  Tooltip,
  XAxis,
  YAxis,
  type AreaRevealShapeProps,
  type LineDrawShapeProps,
} from 'recharts';
import { axisTick, ChartContainer, ChartTooltipContent, type ChartPoint } from './ChartKit';
import { clamp, usePrefersReducedMotion } from './hooks';

// Insert breaks in the drawn path only. Dots, axis labels and tooltips keep
// one entry per real session, even when many days have unordered visits.
function curveWithGaps(
  points: AreaRevealShapeProps['points'],
  data: readonly ChartPoint[],
) {
  return points?.flatMap((point, index) =>
    data[index]?.unordered ? [{ x: point.x, y: null }, point] : [point],
  );
}

function areaWithGaps(props: AreaRevealShapeProps, data: readonly ChartPoint[]) {
  return <AreaRevealShape {...props} points={curveWithGaps(props.points, data)} />;
}

function lineWithGaps(props: LineDrawShapeProps, data: readonly ChartPoint[]) {
  return <LineDrawShape {...props} points={curveWithGaps(props.points, data)} />;
}

type TrendDotProps = {
  cx?: number;
  cy?: number;
  value?: number | null;
  payload?: ChartPoint;
};

type Series = 'value' | 'compare';

function TrendPoint({
  cx,
  cy,
  value,
  payload,
  series,
  tabLabel,
  onSelect,
}: TrendDotProps & {
  series: Series;
  tabLabel?: string;
  onSelect?: (point: ChartPoint) => void;
}) {
  if (!payload || value == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={series === 'value' ? 3.5 : 3}
      className="trend-dot"
      fill={series === 'value' ? 'var(--data)' : 'var(--compare)'}
      stroke="transparent"
      strokeWidth={8}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect && payload.label === tabLabel ? 0 : -1}
      aria-label={onSelect ? `Select ${payload.label}` : undefined}
      onClick={(event) => {
        if (!onSelect) return;
        event.stopPropagation();
        onSelect(payload);
      }}
      onKeyDown={(event) => {
        if (!onSelect) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onSelect(payload);
        }
      }}
    />
  );
}

export function TrendChart({
  data,
  unit,
  height = 220,
  label,
  onSelect,
  selectedId,
  compare,
  name,
}: {
  data: ChartPoint[];
  unit: string;
  height?: number;
  label: string;
  onSelect?: (point: ChartPoint) => void;
  selectedId?: string | null;
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
  const hasUnorderedVisits = data.some((point) => point.unordered);
  // The native session picker exposes every visit to keyboard users. Keep
  // just one dot tab stop so long histories do not bury that picker.
  const keyboardSeries: Series = data.some((point) => point.value !== null)
    ? 'value'
    : 'compare';
  const tabPoint =
    data.find((point) => point.id === selectedId && point[keyboardSeries] != null) ??
    data.find((point) => point[keyboardSeries] != null);
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
        <Area
          type="monotone"
          dataKey="value"
          name={name ?? label}
          stroke="var(--data)"
          strokeWidth={2.5}
          fill="var(--data)"
          fillOpacity={0.14}
          connectNulls={false}
          isAnimationActive={!reduced}
          shape={hasUnorderedVisits ? (props) => areaWithGaps(props, data) : undefined}
          dot={
            <TrendPoint
              series="value"
              tabLabel={keyboardSeries === 'value' ? tabPoint?.label : undefined}
              onSelect={onSelect}
            />
          }
          activeDot={{ r: 6, strokeWidth: 0, pointerEvents: 'none' }}
        />
        {hasCompare && (
          <Line
            type="monotone"
            dataKey="compare"
            name={compare}
            stroke="var(--compare)"
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="none"
            connectNulls={false}
            isAnimationActive={!reduced}
            shape={hasUnorderedVisits ? (props) => lineWithGaps(props, data) : undefined}
            dot={
              <TrendPoint
                series="compare"
                tabLabel={keyboardSeries === 'compare' ? tabPoint?.label : undefined}
                onSelect={onSelect}
              />
            }
            activeDot={{ r: 5, strokeWidth: 0, pointerEvents: 'none' }}
          />
        )}
      </AreaChart>
    </ChartContainer>
  );
}

/** Clamp a score to the 0–100 display range. */
export const scorePercent = (score: number | null) =>
  score === null ? null : clamp(Math.round(score), 0, 100);
