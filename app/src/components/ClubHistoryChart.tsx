import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { ProfileHistoryPoint } from '../domain/clubProfiles';
import { sessionHref, visitLabel } from './SessionRecap';
import { shortDate } from './PerformanceTrendCard';
import {
  Metric,
  SegmentedControl,
  type SegmentedOption,
} from './ds';
import { ChartSummary, TrendChart, type ChartPoint } from './charts';

type HistoryMetric = 'median' | 'iqr';

const METRICS: readonly SegmentedOption<HistoryMetric>[] = [
  { value: 'median', label: 'Median carry', title: 'Median carry per session — higher is farther' },
  { value: 'iqr', label: 'Spread', title: 'Carry IQR per session — lower is more consistent' },
];

/**
 * Interactive per-club history on the shared Progress cohort (all-time,
 * matching the history table below the chart): metric segmented control,
 * headline value with delta vs the first measured session, and a tappable
 * trend chart — a session tap links through to the session recap. Missing
 * values stay gaps, never zero; no historical rating series is fabricated.
 */
export function ClubHistoryChart({
  club,
  points,
}: {
  club: string;
  points: ProfileHistoryPoint[];
}) {
  const [metric, setMetric] = useState<HistoryMetric>('median');
  const [selected, setSelected] = useState<number | null>(null);
  const chartPoints: ChartPoint[] = useMemo(
    () =>
      points.map((point, i) => ({
        label: `S${i + 1} · ${shortDate(point.session.date)}`,
        value: metric === 'median' ? point.median : point.iqr,
        detail: `${visitLabel(point.session)} · ${point.n} measured · ${point.missing} missing`,
      })),
    [points, metric],
  );
  const measured = chartPoints.filter((p) => p.value !== null);
  const headline = measured.at(-1) ?? null;
  const first = measured[0] ?? null;
  const delta =
    headline?.value != null && first?.value != null
      ? headline.value - first.value
      : null;
  const lowerIsBetter = metric === 'iqr';
  const deltaText =
    delta === null ? undefined : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} m`;
  const deltaTone =
    delta === null
      ? 'neutral'
      : lowerIsBetter
        ? delta < 0
          ? 'pos'
          : 'neg'
        : delta > 0
          ? 'pos'
          : delta < 0
            ? 'neg'
            : 'neutral';
  const chartLabel = `${club} ${metric === 'median' ? 'median carry' : 'carry spread'} per session`;
  const selectedPoint = selected !== null ? points[selected] : null;
  return (
    <div className="club-history">
      <SegmentedControl
        label="History metric"
        options={METRICS}
        value={metric}
        onChange={setMetric}
      />
      {headline ? (
        <Metric
          label={metric === 'median' ? 'Latest median carry' : 'Latest carry spread (IQR)'}
          value={headline.value === null ? '—' : headline.value.toFixed(1)}
          unit="m"
          delta={deltaText ? `${deltaText} vs first session` : undefined}
          deltaTone={deltaTone}
        />
      ) : (
        <Metric
          label={metric === 'median' ? 'Median carry' : 'Carry spread (IQR)'}
          value="—"
          unit="m"
        />
      )}
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Over {measured.length} of {chartPoints.length} sessions · Progress cohort, all-time
      </p>
      <ChartSummary label={`${chartLabel} summary`}>
        {measured.length
          ? `${metric === 'median' ? 'Median carry' : 'Carry spread'} from ${first?.value?.toFixed(1)} m to ${headline?.value?.toFixed(1)} m across ${measured.length} sessions.`
          : 'No measured values in this history.'}
      </ChartSummary>
      <TrendChart
        data={chartPoints}
        unit="m"
        label={chartLabel}
        onSelect={(label) => {
          const index = chartPoints.findIndex((p) => p.label === label);
          setSelected(index >= 0 ? index : null);
        }}
      />
      <p className="muted" style={{ margin: '10px 0 0' }}>
        {selectedPoint ? (
          <>
            Selected S{selected! + 1} · {visitLabel(selectedPoint.session)} —{' '}
            <a href={sessionHref(selectedPoint.session.id)}>open session recap</a>
          </>
        ) : (
          <>
            Tap a point (or hover) to inspect that session.{' '}
            <TrendingUp size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />
          </>
        )}
      </p>
    </div>
  );
}
