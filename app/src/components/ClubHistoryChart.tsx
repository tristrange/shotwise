import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { ProfileHistoryPoint } from '../domain/clubProfiles';
import { firstLatestDelta } from '../domain/progress';
import { sessionHref, visitLabel } from './SessionRecap';
import { shortDate } from './PerformanceTrendCard';
import {
  Metric,
  SegmentedControl,
  Select,
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
  // Selection keyed by session id (not index) so it never silently re-points.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chartPoints: ChartPoint[] = useMemo(
    () =>
      points.map((point, i) => ({
        id: point.session.id,
        label: `S${i + 1} · ${shortDate(point.session.date)}`,
        value: metric === 'median' ? point.median : point.iqr,
        detail: `${visitLabel(point.session)} · ${point.n} measured · ${point.missing} missing`,
      })),
    [points, metric],
  );
  const measured = chartPoints.filter((p) => p.value !== null);
  // Same first/latest/delta rule as the Progress page: no delta from a single
  // measured visit, and none when the endpoint order is chronologically
  // ambiguous (same-day visits with missing or equal times).
  const { first, latest: headline, delta } = firstLatestDelta(
    points.map((p) => ({
      session: p.session,
      value: metric === 'median' ? p.median : p.iqr,
    })),
  );
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
  const selectedPoint =
    selectedId !== null ? (points.find((p) => p.session.id === selectedId) ?? null) : null;
  const selectedIndex = selectedPoint
    ? chartPoints.findIndex((p) => p.id === selectedPoint.session.id)
    : -1;
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
        onSelect={(point) => setSelectedId(point.id ?? null)}
      />
      <div className="trend-inspect">
        <Select
          label="Inspect session"
          value={selectedPoint?.session.id ?? ''}
          onChange={(id) => setSelectedId(id || null)}
          options={[
            { value: '', label: 'No session selected' },
            ...chartPoints.map((p) => ({ value: p.id ?? p.label, label: p.label })),
          ]}
        />
      </div>
      <p className="muted" style={{ margin: '10px 0 0' }}>
        {selectedPoint ? (
          <>
            Selected S{selectedIndex + 1} · {visitLabel(selectedPoint.session)} —{' '}
            <a href={sessionHref(selectedPoint.session.id)}>open session recap</a>
          </>
        ) : (
          <>
            Tap a point (or pick a session above) to inspect it.{' '}
            <TrendingUp size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />
          </>
        )}
      </p>
    </div>
  );
}
