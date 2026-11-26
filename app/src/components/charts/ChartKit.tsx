import type { ReactElement, ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';

/**
 * Shared chart shell: consistent responsive sizing and the `.ds-chart` rules
 * (axis typography, muted dashed gridlines, tooltip surface) live in one place.
 * `label` gives the chart an accessible group name; a visible sr-only summary
 * or data table should accompany every chart (see the callers).
 */
export function ChartContainer({
  label,
  height = 220,
  children,
}: {
  label: string;
  height?: number;
  children: ReactElement;
}) {
  return (
    <div
      className="ds-chart"
      role="group"
      aria-label={label}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Shared axis-tick props for every Recharts axis in the app. Recharts defaults
 * tick text to an inline #666, which fails contrast on dark surfaces, so the
 * theme-token fill is passed as a prop (inline defaults beat stylesheet rules).
 */
export const axisTick = { fill: 'var(--text-3)', fontSize: 11 } as const;

type TooltipEntry = {
  value?: number | string | null;
  name?: string;
  dataKey?: string;
  payload?: Record<string, unknown> & {
    detail?: string;
    compareDetail?: string;
    /** Set on the masked copies TrendChart draws per run; hidden from tooltips. */
    masked?: boolean;
  };
};

const formatValue = (value: TooltipEntry['value']) =>
  typeof value === 'number'
    ? value.toFixed(value % 1 === 0 ? 0 : 1)
    : (value ?? null);

/**
 * Shared tooltip surface for every Recharts chart in the app. Every series
 * keeps its own labelled row — even when only one series has a value at this
 * x position, so a dropped series can never make a number look like the
 * primary one. Sample counts ride on the point (`detail`, `compareDetail`).
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  unit?: string;
}) {
  // TrendChart splits the series into runs and draws one masked copy per run;
  // those masked rows must not appear as extra "not measured" entries.
  const entries = payload?.filter((entry) => entry.payload?.masked !== true);
  if (!active || !entries?.length) return null;
  const detail = entries.find((entry) => entry.payload?.detail)?.payload?.detail;
  return (
    <div className="ds-chart-tooltip">
      {label !== undefined && (
        <div className="ds-chart-tooltip-label">{String(label)}</div>
      )}
      {entries.map((entry, index) => {
        const value = formatValue(entry.value);
        const rowDetail =
          entry.dataKey === 'compare'
            ? entry.payload?.compareDetail
            : undefined;
        return (
          <div key={entry.name ?? index}>
            <div className="ds-chart-tooltip-row">
              {entry.name && (
                <span className="ds-chart-tooltip-name">{entry.name}</span>
              )}
              <span className="ds-chart-tooltip-value">
                {value === null || value === undefined || value === ''
                  ? 'not measured'
                  : `${value}${unit ? ` ${unit}` : ''}`}
              </span>
            </div>
            {rowDetail && (
              <div className="ds-chart-tooltip-name">{rowDetail}</div>
            )}
          </div>
        );
      })}
      {detail && <div className="ds-chart-tooltip-label">{detail}</div>}
    </div>
  );
}

export type ChartPoint = {
  label: string;
  value: number | null;
  /** Stable identity (e.g. session id) so selection survives club/window changes. */
  id?: string;
  /** Optional comparison-series value for the same x position (null = gap). */
  compare?: number | null;
  detail?: string;
  /** Sample counts for the comparison series at this x position. */
  compareDetail?: string;
  /**
   * The segment from the previous point to this one must not be drawn: the
   * two visits share a date but their order is not chronologically known
   * (untimed or equal start times), so no within-day trajectory is implied.
   */
  unordered?: boolean;
};

export function ChartSummary({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="sr-only" role="note" aria-label={label}>
      {children}
    </p>
  );
}
