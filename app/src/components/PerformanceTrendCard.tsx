import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { BASES, localToday, type Dataset } from '../domain/model';
import type { AnalysisSettings } from '../domain/analytics';
import {
  chronologyKnown,
  clubProgress,
  pointReading,
  summarizeClubMetric,
  type ClubProgressGroup,
  type ProgressMetric,
  type ProgressSessionPoint,
} from '../domain/progress';
import { sessionHref, visitLabel } from './SessionRecap';
import {
  Card,
  HelpPopover,
  Metric,
  MetricGrid,
  SectionHeader,
  SegmentedControl,
  Select,
  type SegmentedOption,
} from './ds';
import { ChartSummary, TrendChart, type ChartPoint } from './charts';

type TrendMetric = ProgressMetric;

const METRICS: readonly SegmentedOption<TrendMetric>[] = [
  { value: 'median', label: 'Carry', title: 'Median carry per session — higher is farther' },
  {
    value: 'p80',
    label: 'Potential',
    title: 'Strong-strike potential (P80 carry) per session — from all full swings, needs 10+ measured in a session',
  },
  {
    value: 'iqr',
    label: 'Spread',
    title: 'Carry IQR per session — the width of the middle half of carries; lower is more consistent',
  },
  { value: 'speed', label: 'Speed', title: 'Median ball speed per session' },
  { value: 'launch', label: 'Launch', title: 'Median launch angle per session' },
  { value: 'apex', label: 'Apex', title: 'Median apex per session' },
];
const METRIC_UNIT: Record<TrendMetric, string> = {
  median: 'm',
  p80: 'm',
  iqr: 'm',
  speed: 'kph',
  launch: '°',
  apex: 'm',
};
const METRIC_SERIES_NAME: Record<TrendMetric, string> = {
  median: 'Median carry',
  p80: 'Strong-strike potential (P80)',
  iqr: 'Carry spread (IQR)',
  speed: 'Ball speed',
  launch: 'Launch angle',
  apex: 'Apex',
};
/** Lower values are the favourable direction only for the carry spread. */
const LOWER_IS_BETTER: Record<TrendMetric, boolean> = {
  median: false,
  p80: false,
  iqr: true,
  speed: false,
  launch: false,
  apex: false,
};
/** Deltas imply improvement only where direction is meaningful. */
const DELTA_IS_DIRECTIONAL: Record<TrendMetric, boolean> = {
  median: true,
  p80: true,
  iqr: true,
  speed: true,
  launch: false,
  apex: false,
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

const decimals = (metric: TrendMetric) => (metric === 'speed' ? 0 : 1);
const fmt = (value: number | null, metric: TrendMetric) =>
  value === null ? '—' : value.toFixed(decimals(metric));

const EMPTY_SESSIONS: ProgressSessionPoint[] = [];

/**
 * Interactive progress composition (reference: interactive-charts
 * screenshot): heading + club selector + metric segmented control + headline
 * value with change vs the first measured session + first/latest/best session
 * summaries + tappable trend chart with an optional comparison series. All
 * values come from the shared domain cohort functions on the selected basis —
 * historical ratings are deliberately not charted (no fabricated series).
 */
export function PerformanceTrendCard({
  data,
  settings,
  groups: groupsProp,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  /** Precomputed `clubProgress` groups (the Progress page already has them). */
  groups?: ClubProgressGroup[];
}) {
  const { basis } = settings;
  const query = useMemo(
    () => ({
      mode: settings.mode,
      intent: settings.intent,
      contact: settings.contact,
      hideLikelyMishits: settings.hideLikelyMishits,
      today: localToday(),
    }),
    [settings],
  );
  // One shared domain source for the club list, the chart series, the summary
  // tiles and the cross-club comparison — they can never disagree. When the
  // parent already computed the groups, `clubProgress` is not called again.
  const groups = useMemo(
    () => groupsProp ?? clubProgress(data, basis, query),
    [groupsProp, data, basis, query],
  );
  const clubs = useMemo(() => groups.map((group) => group.club), [groups]);
  const [club, setClub] = useState<string>(clubs[0] ?? '');
  const [metric, setMetric] = useState<TrendMetric>('median');
  const [showPotential, setShowPotential] = useState(false);
  // Selection is keyed by session ID, not array index: switching club, metric
  // or window must never silently re-point the recap link at another session.
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  const effectiveClub = clubs.includes(club) ? club : (clubs[0] ?? '');
  const clubGroup = useMemo(
    () => groups.find((group) => group.club === effectiveClub),
    [groups, effectiveClub],
  );
  const sessions = useMemo(
    () => clubGroup?.sessions ?? EMPTY_SESSIONS,
    [clubGroup],
  );

  const points: ChartPoint[] = useMemo(
    () =>
      sessions.map((point, i) => {
        const reading = pointReading(point, metric);
        const potential = pointReading(point, 'p80');
        const prev = i > 0 ? sessions[i - 1] : undefined;
        return {
          id: point.session.id,
          label: `S${i + 1} · ${shortDate(point.session.date)}`,
          value: reading.value,
          compare:
            metric === 'median' && showPotential
              ? potential.value
              : undefined,
          detail: `${visitLabel(point.session)} · ${reading.n} measured · ${reading.missing} missing`,
          compareDetail:
            metric === 'median' && showPotential
              ? `${potential.n} measured full swings`
              : undefined,
          // Same-day visits whose order is not chronologically known get no
          // connecting segment: the chart must not imply a within-day
          // trajectory. Distinct recorded times on the same day stay ordered.
          unordered:
            prev !== undefined &&
            prev.session.date === point.session.date &&
            !chronologyKnown(prev.session, point.session),
        };
      }),
    [sessions, metric, showPotential],
  );

  const summary = useMemo(
    () =>
      clubGroup
        ? summarizeClubMetric([clubGroup], metric, LOWER_IS_BETTER[metric])[0]
        : null,
    [clubGroup, metric],
  );
  const measured = points.filter((p) => p.value !== null);
  const headline = summary?.latest ?? null;
  const first = summary?.first ?? null;
  const delta = summary?.delta ?? null;
  const lowerIsBetter = LOWER_IS_BETTER[metric];
  const directional = DELTA_IS_DIRECTIONAL[metric];
  const deltaText =
    delta === null
      ? undefined
      : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(decimals(metric))} ${METRIC_UNIT[metric]}`;
  // An ambiguous endpoint date means the first (or latest) visit could be
  // either of the same-day values: say so explicitly instead of silently
  // showing no change or an arbitrary direction.
  const withheldDeltaText =
    delta === null && summary?.deltaReason === 'ambiguous'
      ? 'Change not shown — same-day visits with no recorded order'
      : undefined;
  const deltaTone = !directional
    ? 'neutral'
    : delta === null
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

  const unit = METRIC_UNIT[metric];
  const seriesName = METRIC_SERIES_NAME[metric];
  // The headline names the selected cohort's statistic explicitly, so a
  // strong-strike median is never read as typical carry.
  const headlineLabel =
    metric === 'median'
      ? settings.contact === 'strong'
        ? 'Strong-strike median carry'
        : settings.contact === 'typical'
          ? 'Typical median carry'
          : 'Median carry'
      : seriesName;
  const chartLabel = `${effectiveClub} ${seriesName.toLowerCase()} per session`;
  const compareActive = metric === 'median' && showPotential;
  // The inspected point is looked up by session id; when the selected session
  // leaves the series (club/window change) the selection simply clears.
  const inspectedPoint =
    inspectedId !== null
      ? (points.find((p) => p.id === inspectedId) ?? null)
      : null;
  const inspectedIndex = inspectedPoint
    ? points.findIndex((p) => p.id === inspectedPoint.id)
    : -1;
  const inspectedSession = inspectedPoint
    ? (sessions.find((s) => s.session.id === inspectedPoint.id) ?? null)
    : null;
  const inspectedReading = inspectedSession
    ? pointReading(inspectedSession, metric)
    : null;

  return (
    <Card className="performance-trend">
      <SectionHeader
        title="Performance trend"
        aside={
          <div className="card-controls">
            <Select
              label="Club"
              value={effectiveClub}
              onChange={setClub}
              options={clubs.map((c) => ({ value: c, label: c }))}
            />
            <HelpPopover label="How to read this chart">
              <p>
                Each point is one session (S1, S2… in date order — sessions without a
                recorded time are not ordered within a day). {seriesName} per session on
                the {BASES[basis].label} basis. Same-day visits with no recorded order
                get no connecting line, and the change vs the first session is not
                shown when the first or latest day has unordered visits. Tap a point
                (or use the Inspect session picker) to select that exact visit.
              </p>
              {metric === 'median' && (
                <p>
                  The optional potential line is the strong-strike potential (P80 carry)
                  of each session's full swings — it needs 10+ measured carries in a
                  session and stays a gap below that.
                </p>
              )}
              {metric === 'iqr' && (
                <p>
                  Spread is the carry IQR: the width of the middle half of measured
                  carries. Lower means less variability — a smaller number is more
                  consistent. It needs at least 4 measured shots.
                </p>
              )}
              <p>
                Missing measurements stay gaps, never zero. Fewer than 10 measured shots
                in a session is sample-limited. Session differences alone do not prove
                long-term improvement.
              </p>
              <p>
                Ratings are never charted over time — no historical rating series exists.
              </p>
            </HelpPopover>
          </div>
        }
      />
      <div className="trend-controls">
        <SegmentedControl
          label="Metric"
          options={METRICS}
          value={metric}
          onChange={setMetric}
        />
        {metric === 'median' && (
          <button
            type="button"
            className="ds-toggle"
            aria-pressed={showPotential}
            title="Overlay each session's strong-strike potential (P80 carry) on the median carry line"
            onClick={() => setShowPotential((current) => !current)}
          >
            Potential (P80) series: {showPotential ? 'shown' : 'hidden'}
          </button>
        )}
      </div>
      {headline ? (
        <Metric
          label={`${headlineLabel} · latest session`}
          value={fmt(headline.value, metric)}
          unit={unit}
          delta={
            deltaText
              ? `${deltaText} vs first session${first ? ` · ${shortDate(first.session.date)}` : ''}`
              : withheldDeltaText
          }
          deltaTone={deltaTone}
        />
      ) : (
        <Metric label={headlineLabel} value="—" unit={unit} />
      )}
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Over {measured.length} of {points.length} sessions · {BASES[basis].label}
      </p>
      <ChartSummary label={`${chartLabel} summary`}>
        {measured.length
          ? summary?.deltaReason === 'ambiguous'
            ? `${seriesName}: latest ${fmt(headline?.value ?? null, metric)} ${unit} across ${measured.length} of ${points.length} sessions; change vs the earliest measured session is not shown because same-day visits have no recorded order.${compareActive ? ' Dashed line: strong-strike potential (P80) per session.' : ''}`
            : `${seriesName} from ${first ? fmt(first.value, metric) : '—'} to ${fmt(headline?.value ?? null, metric)} ${unit} across ${measured.length} of ${points.length} sessions.${compareActive ? ' Dashed line: strong-strike potential (P80) per session.' : ''}`
          : 'No measured values in this window.'}
      </ChartSummary>
      <TrendChart
        data={points}
        unit={unit}
        label={chartLabel}
        name={seriesName}
        compare={compareActive ? 'Strong-strike potential (P80)' : undefined}
        onSelect={(point) => setInspectedId(point.id ?? null)}
      />
      {compareActive && (
        <p className="chart-legend muted" aria-hidden="true">
          <span className="legend-dot primary" /> {seriesName}
          <span className="legend-dot compare" /> Strong-strike potential (P80)
        </p>
      )}
      <div className="trend-inspect">
        <Select
          label="Inspect session"
          value={inspectedPoint?.id ?? ''}
          onChange={(id) => setInspectedId(id || null)}
          options={[
            { value: '', label: 'No session selected' },
            ...points.map((p, i) => ({
              value: p.id ?? `S${i + 1}`,
              label: p.label,
            })),
          ]}
        />
      </div>
      <p className="muted" style={{ margin: '10px 0 0' }}>
        {inspectedPoint && inspectedSession && inspectedReading ? (
          <>
            Selected S{inspectedIndex + 1} · {visitLabel(inspectedSession.session)} —{' '}
            {fmt(inspectedReading.value, metric)} {unit} · {inspectedReading.n} measured ·{' '}
            {inspectedReading.missing} missing ·{' '}
            <a href={sessionHref(inspectedSession.session.id)}>open session recap</a>
          </>
        ) : (
          <>
            Tap a point (or pick a session above) to inspect it.{' '}
            <TrendingUp size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />
          </>
        )}
      </p>
      {summary && summary.measured > 0 && (
        <MetricGrid>
          {summary.first && (
            <Metric
              small
              label={`First session · ${shortDate(summary.first.session.date)}`}
              value={fmt(summary.first.value, metric)}
              unit={unit}
              delta={`${summary.first.n} measured`}
            />
          )}
          {summary.latest && (
            <Metric
              small
              label={`Latest session · ${shortDate(summary.latest.session.date)}`}
              value={fmt(summary.latest.value, metric)}
              unit={unit}
              delta={`${summary.latest.n} measured`}
            />
          )}
          {summary.best && (
            <Metric
              small
              label={`${lowerIsBetter ? 'Most consistent' : 'Best'} session · ${shortDate(summary.best.session.date)}`}
              value={fmt(summary.best.value, metric)}
              unit={unit}
              delta={`${summary.best.n} measured`}
            />
          )}
        </MetricGrid>
      )}
    </Card>
  );
}
