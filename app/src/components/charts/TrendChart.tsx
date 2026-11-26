import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer, ChartTooltipContent, type ChartPoint } from './ChartKit';
import { clamp, usePrefersReducedMotion } from './hooks';

/**
 * Interactive trend chart (reference: interactive-charts screenshot). One
 * primary series with visible points; hover or tap shows the shared tooltip,
 * tapping the chart selects the nearest point (reported through onSelect).
 * An optional comparison series (`compare`, e.g. strong-strike potential next
 * to median carry) renders as a dashed `--compare` line so the two stay
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
  onSelect?: (label: string) => void;
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
  return (
    <ChartContainer label={label} height={height}>
      <AreaChart
        data={data}
        margin={{ top: 10, right: 6, bottom: 0, left: -14 }}
        onClick={(state) => {
          const activeLabel = state?.activeLabel;
          if (activeLabel != null && onSelect) onSelect(String(activeLabel));
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[min - pad, max + pad]}
          tickLine={false}
          axisLine={false}
          width={52}
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
          dot={{ r: 3.5, strokeWidth: 0, fill: 'var(--data)' }}
          activeDot={{ r: 6, strokeWidth: 0 }}
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
            dot={{ r: 3, strokeWidth: 0, fill: 'var(--compare)' }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        )}
      </AreaChart>
    </ChartContainer>
  );
}

/** Clamp a score to the 0–100 display range. */
export const scorePercent = (score: number | null) =>
  score === null ? null : clamp(Math.round(score), 0, 100);
