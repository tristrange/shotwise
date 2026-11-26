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

type TooltipEntry = {
  value?: number | string | null;
  name?: string;
  payload?: Record<string, unknown> & { detail?: string };
};

const formatValue = (value: TooltipEntry['value']) =>
  typeof value === 'number'
    ? value.toFixed(value % 1 === 0 ? 0 : 1)
    : (value ?? null);

/**
 * Shared tooltip surface for every Recharts chart in the app. With a single
 * series it shows the value only; with several series (e.g. median carry plus
 * a strong-strike potential comparison) each series gets its own labelled row.
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
  if (!active || !payload?.length) return null;
  const detail = payload.find((entry) => entry.payload?.detail)?.payload
    ?.detail;
  const multi = payload.length > 1;
  return (
    <div className="ds-chart-tooltip">
      {label !== undefined && (
        <div className="ds-chart-tooltip-label">{String(label)}</div>
      )}
      {payload.map((entry, index) => {
        const value = formatValue(entry.value);
        return (
          <div className="ds-chart-tooltip-row" key={entry.name ?? index}>
            {multi && entry.name && (
              <span className="ds-chart-tooltip-name">{entry.name}</span>
            )}
            <span className="ds-chart-tooltip-value">
              {value === null || value === undefined || value === ''
                ? 'not measured'
                : `${value}${unit ? ` ${unit}` : ''}`}
            </span>
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
  /** Optional comparison-series value for the same x position (null = gap). */
  compare?: number | null;
  detail?: string;
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
