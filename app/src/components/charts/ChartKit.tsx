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

/** Shared tooltip surface for every Recharts chart in the app. */
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
  const entry = payload[0];
  const value =
    typeof entry?.value === 'number'
      ? entry.value.toFixed(entry.value % 1 === 0 ? 0 : 1)
      : (entry?.value ?? null);
  return (
    <div className="ds-chart-tooltip">
      {label !== undefined && (
        <div className="ds-chart-tooltip-label">{String(label)}</div>
      )}
      <div className="ds-chart-tooltip-value">
        {value === null || value === undefined || value === ''
          ? 'not measured'
          : `${value}${unit ? ` ${unit}` : ''}`}
      </div>
      {entry?.payload?.detail && (
        <div className="ds-chart-tooltip-label">{entry.payload.detail}</div>
      )}
    </div>
  );
}

export type ChartPoint = {
  label: string;
  value: number | null;
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
