import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import {
  BASES,
  clubOrder,
  localToday,
  type Basis,
  type Dataset,
  type MetricKey,
} from '../domain/model';
import {
  benchmarkClubGroups,
  metricStats,
  selectCohort,
} from '../domain/analytics';
import { resolveShots } from '../domain/assessment';
import {
  Card,
  Metric,
  SectionHeader,
  SegmentedControl,
  Select,
  type SegmentedOption,
} from './ds';
import { TrendChart, ChartSummary, type ChartPoint } from './charts';

type TrendMetric = 'carry' | 'iqr' | 'speed' | 'launch' | 'apex';

const METRICS: readonly SegmentedOption<TrendMetric>[] = [
  { value: 'carry', label: 'Carry', title: 'Median carry per session' },
  { value: 'iqr', label: 'Spread', title: 'Carry IQR per session — lower is more consistent' },
  { value: 'speed', label: 'Ball speed', title: 'Median ball speed per session' },
  { value: 'launch', label: 'Launch', title: 'Median launch angle per session' },
  { value: 'apex', label: 'Apex', title: 'Median apex per session' },
];
const METRIC_UNIT: Record<TrendMetric, string> = {
  carry: 'm',
  iqr: 'm',
  speed: 'kph',
  launch: '°',
  apex: 'm',
};

// Parse the date-only value as a local calendar date — parsing at UTC midnight
// would label every session one day early for users west of UTC.
export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
};

function metricKey(basis: Basis, metric: TrendMetric): MetricKey {
  const fields = BASES[basis];
  switch (metric) {
    case 'carry':
    case 'iqr':
      return fields.carry;
    case 'speed':
      return fields.speed;
    case 'launch':
      return fields.launch;
    case 'apex':
      return fields.apex;
  }
}

/**
 * Interactive progress composition (reference: interactive-charts
 * screenshot): heading + club selector + metric segmented control + headline
 * value with change vs the first session + tappable trend chart. All values
 * come from the shared domain cohort functions on the selected basis —
 * historical ratings are deliberately not charted (no fabricated series).
 */
export function PerformanceTrendCard({
  data,
  basis,
  mode,
}: {
  data: Dataset;
  basis: Basis;
  mode: 'recent' | 'all';
}) {
  const query = useMemo(
    () => ({
      mode,
      intent: 'all' as const,
      contact: 'all' as const,
      hideLikelyMishits: false,
      today: localToday(),
    }),
    [mode],
  );
  const resolved = useMemo(
    () => resolveShots(data.shots, data.sessions, basis),
    [data, basis],
  );
  const selected = useMemo(
    () => selectCohort(data.shots, data.sessions, query, basis),
    [data, query, basis],
  );
  const groups = useMemo(
    () => benchmarkClubGroups(selected, resolved),
    [selected, resolved],
  );
  const clubs = useMemo(
    () =>
      [...groups.keys()].sort(
        (a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b),
      ),
    [groups],
  );
  const [club, setClub] = useState<string>(clubs[0] ?? '');
  const [metric, setMetric] = useState<TrendMetric>('carry');
  const [inspected, setInspected] = useState<string | null>(null);

  const effectiveClub = clubs.includes(club) ? club : (clubs[0] ?? '');

  const points: ChartPoint[] = useMemo(() => {
    if (!effectiveClub) return [];
    const shots = groups.get(effectiveClub) ?? [];
    const bySession = new Map<string, typeof shots>();
    for (const shot of shots) {
      bySession.set(shot.sessionId, [...(bySession.get(shot.sessionId) ?? []), shot]);
    }
    const sessions = data.sessions
      .filter((s) => bySession.has(s.id))
      .toSorted(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.time ?? '').localeCompare(b.time ?? '') ||
          a.id.localeCompare(b.id),
      );
    const key = metricKey(basis, metric);
    return sessions.map((session, i) => {
      const stats = metricStats(bySession.get(session.id) ?? [], key);
      const value =
        metric === 'iqr' ? stats.iqr : (stats.median ?? null);
      return {
        label: `${shortDate(session.date)} · S${i + 1}`,
        value,
        detail: `${stats.n} measured · ${stats.missing} missing`,
      };
    });
  }, [data.sessions, groups, effectiveClub, metric, basis]);

  const measured = points.filter((p) => p.value !== null);
  const headline = measured.at(-1) ?? null;
  const first = measured[0] ?? null;
  const delta =
    headline?.value !== null && headline?.value !== undefined &&
    first?.value !== null && first?.value !== undefined
      ? headline.value - first.value
      : null;
  const lowerIsBetter = metric === 'iqr';
  const deltaText =
    delta === null
      ? undefined
      : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(metric === 'launch' ? 1 : 0)} ${METRIC_UNIT[metric]}`;
  const deltaTone =
    delta === null ? 'neutral' : lowerIsBetter ? (delta < 0 ? 'pos' : 'neg') : (delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'neutral');

  const unit = METRIC_UNIT[metric];
  const chartLabel = `${effectiveClub} ${metric} per session`;

  return (
    <Card>
      <SectionHeader
        title="Performance trend"
        aside={
          <Select
            label="Club"
            value={effectiveClub}
            onChange={setClub}
            options={clubs.map((c) => ({ value: c, label: c }))}
          />
        }
      />
      <div style={{ marginBottom: 12 }}>
        <SegmentedControl
          label="Metric"
          options={METRICS}
          value={metric}
          onChange={setMetric}
        />
      </div>
      {headline ? (
        <Metric
          label={METRICS.find((m) => m.value === metric)?.label ?? metric}
          value={headline.value === null ? '—' : headline.value.toFixed(metric === 'launch' ? 1 : 0)}
          unit={unit}
          delta={deltaText ? `${deltaText} vs first session` : undefined}
          deltaTone={deltaTone}
        />
      ) : (
        <Metric label={metric} value="—" unit={unit} />
      )}
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Over {measured.length} of {points.length} sessions · {BASES[basis].label}
      </p>
      <ChartSummary label={`${chartLabel} summary`}>
        {measured.length
          ? `From ${first?.value?.toFixed(1)} to ${headline?.value?.toFixed(1)} ${unit} across ${measured.length} sessions.`
          : 'No measured values in this window.'}
      </ChartSummary>
      <TrendChart
        data={points}
        unit={unit}
        label={chartLabel}
        onSelect={setInspected}
      />
      <p className="muted" style={{ margin: '10px 0 0' }}>
        {inspected
          ? `Selected ${inspected} — tap points or hover for values.`
          : 'Tap a point (or hover) to inspect that session.'}{' '}
        <TrendingUp size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />
      </p>
    </Card>
  );
}
