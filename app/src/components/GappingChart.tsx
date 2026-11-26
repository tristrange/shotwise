import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { GAP_THRESHOLDS, type AnalysisSettings } from '../domain/analytics';
import { BASES, type Basis } from '../domain/model';
import { clubDisplayName } from './clubNames';
import { clubHref } from './ClubProfiles';
import { type GappingRow, type GappingView } from './gappingData';
import {
  Badge,
  Card,
  HelpPopover,
  Metric,
  MetricGrid,
  SectionHeader,
  SegmentedControl,
  type SegmentedOption,
} from './ds';
import {
  ChartContainer,
  ChartSummary,
  ChartTooltipContent,
  DistributionPlot,
  usePrefersReducedMotion,
} from './charts';

type ChartView = 'distribution' | 'potential' | 'simple';

const VIEWS: readonly SegmentedOption<ChartView>[] = [
  {
    value: 'distribution',
    label: 'Distribution',
    title: 'Median, IQR and P10–P90 carry band per club on one shared distance axis',
  },
  {
    value: 'potential',
    label: 'Potential',
    title: 'Selected-cohort median carry vs strong-strike potential (P80) per club',
  },
  {
    value: 'simple',
    label: 'Distances',
    title: 'Compact median carry bars per club on one shared distance axis',
  },
];

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const fmt = (n: number | null) => (n === null ? '—' : decimal.format(n));

/** Median label names the selected cohort's statistic, never a bare number. */
function medianLabel(contact: AnalysisSettings['contact']) {
  return contact === 'strong'
    ? 'Strong-strike median carry'
    : contact === 'typical'
      ? 'Typical median carry'
      : 'Median carry';
}

function flagText(flag: GappingRow['flag']) {
  return flag === 'small'
    ? 'small median gap'
    : flag === 'reversed'
      ? 'medians reversed'
      : flag === 'large'
        ? 'large gap'
        : null;
}

function flagTone(flag: GappingRow['flag']): 'warn' | 'neg' | 'brand' | null {
  return flag === 'small'
    ? 'warn'
    : flag === 'reversed'
      ? 'neg'
      : flag === 'large'
        ? 'brand'
        : null;
}

/** Axis tick step that keeps ~4–6 labelled ticks across the shared scale. */
function axisStep(span: number): number {
  for (const step of [5, 10, 20, 25, 50, 100]) {
    if (step * 4 >= span) return step;
  }
  return 100;
}

/**
 * Shared distance axis under the distribution rows. Tick positions use the
 * same mapping as the stretched plot SVGs (4px pad inside a 300-unit
 * viewBox), expressed as percentages so they stay aligned at any width.
 */
function axisTicks(min: number, max: number): { value: number; pct: number }[] {
  const span = max - min || 1;
  const step = axisStep(span);
  const ticks: { value: number; pct: number }[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push({ value: v, pct: ((4 + ((v - min) / span) * 292) / 300) * 100 });
  }
  return ticks;
}

function AxisRow({ min, max }: { min: number; max: number }) {
  return (
    <div className="gap-axis" aria-hidden="true">
      {axisTicks(min, max).map((tick) => (
        <span key={tick.value} style={{ left: `${tick.pct}%` }}>
          {tick.value}
        </span>
      ))}
    </div>
  );
}

function rowLabel(row: GappingRow): string {
  const parts = [
    `Median ${fmt(row.band.median)} m`,
    row.band.p10 !== null && row.band.p90 !== null
      ? `middle 80% ${fmt(row.band.p10)}–${fmt(row.band.p90)} m`
      : 'spread needs 10 shots',
    row.potential !== null
      ? `strong-strike potential ${fmt(row.potential)} m`
      : null,
    `${row.n} ${row.n === 1 ? 'shot' : 'shots'}${row.reliable ? '' : ' · sample limited'}`,
  ].filter(Boolean);
  return `${row.club}: ${parts.join(' · ')}. Select for details`;
}

/**
 * The unified gapping chart: one shared distance axis per view, switchable
 * between carry distribution (median + IQR + P10–P90 + P80 marker), distance
 * potential (selected-cohort median vs strong-strike P80 bars) and simple
 * median carry bars. Club selection is touch-friendly (chips and tappable
 * rows/bars) and drives the concise detail panel with carry, potential,
 * spread and sample coverage. All figures come from `gappingView`, which
 * wraps the tested `clubGaps` domain function.
 */
export function GappingChart({
  view,
  basis,
  settings,
}: {
  view: GappingView;
  basis: Basis;
  settings: AnalysisSettings;
}) {
  const { rows, scale } = view;
  const [chartView, setChartView] = useState<ChartView>('distribution');
  const [club, setClub] = useState<string | null>(null);
  const reduced = usePrefersReducedMotion();
  const effectiveClub = rows.some((r) => r.club === club)
    ? club
    : (rows[0]?.club ?? null);
  const selected = rows.find((r) => r.club === effectiveClub) ?? null;

  const barData = useMemo(
    () =>
      rows.map((row) => ({
        club: row.club,
        median: row.band.median,
        potential: row.potential,
        detail: `${row.n} measured ${row.n === 1 ? 'shot' : 'shots'}${row.reliable ? '' : ' · sample limited'}`,
      })),
    [rows],
  );
  const barMax = useMemo(() => {
    const values = rows.flatMap((r) => [r.band.median, r.potential]);
    const max = Math.max(...values.filter((v): v is number => v !== null), 0);
    return Math.max(10, Math.ceil(max / 10) * 10);
  }, [rows]);

  const summary = useMemo(
    () =>
      rows
        .map(
          (row) =>
            `${row.club}: median ${fmt(row.band.median)} m` +
            (row.band.p10 !== null && row.band.p90 !== null
              ? `, middle 80% ${fmt(row.band.p10)}–${fmt(row.band.p90)} m`
              : ', spread needs 10 shots') +
            (row.potential !== null
              ? `, strong-strike potential ${fmt(row.potential)} m`
              : '') +
            `, ${row.n} shots`,
        )
        .join('. '),
    [rows],
  );

  const chartLabel =
    chartView === 'distribution'
      ? 'Carry distribution by club'
      : chartView === 'potential'
        ? 'Median carry vs strong-strike potential by club'
        : 'Median carry by club';

  return (
    <Card className="gapping-chart">
      <SectionHeader
        title="Club distances"
        sub={`${rows.length} ${rows.length === 1 ? 'club' : 'clubs'} · ${BASES[basis].label} · shared scale ${scale.min}–${scale.max} m`}
        aside={
          <div className="card-controls">
            <SegmentedControl
              label="Chart view"
              options={VIEWS}
              value={chartView}
              onChange={setChartView}
            />
            <HelpPopover label="How to read this chart">
              <p>
                Every club shares one distance axis in each view. The band is
                the middle 80% (P10–P90) of measured carries from the broader
                all-shots cohort — it does not change with the performance
                mode — with the inner band as the middle half (IQR) and the
                solid line as the median of the selected cohort (
                {medianLabel(settings.contact).toLowerCase()}).
              </p>
              <p>
                The dashed marker is the strong-strike potential (P80 carry)
                from all full swings; it needs{' '}
                {GAP_THRESHOLDS.minSamples}+ measured carries and stays a gap
                below that. Fewer than {GAP_THRESHOLDS.minSamples} shots is
                sample-limited: the spread then reads “Spread needs 10 shots”.
                Missing measurements are never drawn as zero.
              </p>
              <p>
                Tap a club chip, a band or a bar to inspect that club's carry,
                potential, spread and sample coverage below the chart.
              </p>
            </HelpPopover>
          </div>
        }
      />
      <div className="club-picker" role="group" aria-label="Select a club">
        {rows.map((row) => (
          <button
            key={row.club}
            type="button"
            className={`gap-club-chip${row.club === effectiveClub ? ' active' : ''}`}
            aria-pressed={row.club === effectiveClub}
            onClick={() => setClub(row.club)}
          >
            <span className="club-badge" aria-hidden="true">
              {row.club.toUpperCase()}
            </span>
            <span className="club-picker-name">{clubDisplayName(row.club)}</span>
          </button>
        ))}
      </div>
      <ChartSummary label={`${chartLabel} summary`}>{summary}</ChartSummary>
      {chartView === 'distribution' && (
        <>
          <div
            className="gap-rows"
            role="list"
            aria-label="Club carry distances"
          >
            {rows.map((row) => {
              const complete =
                row.band.p10 !== null && row.band.p90 !== null;
              const active = row.club === effectiveClub;
              return (
                <div className="gap-row-item" role="listitem" key={row.club}>
                  <a className="gap-club" href={clubHref(row.club)}>
                    {row.club}
                  </a>
                  <button
                    type="button"
                    className={`gap-band-btn${active ? ' active' : ''}`}
                    aria-pressed={active}
                    aria-label={rowLabel(row)}
                    title={rowLabel(row)}
                    onClick={() => setClub(row.club)}
                  >
                    <DistributionPlot
                      band={row.band}
                      min={scale.min}
                      max={scale.max}
                      label={rowLabel(row)}
                      compare={row.potential}
                      labels={false}
                      stretch
                    />
                  </button>
                  <span className="gap-val">
                    <strong>{fmt(row.band.median)} m</strong>
                    <small>
                      {complete
                        ? row.potential !== null
                          ? `P80 ${fmt(row.potential)} m`
                          : 'median'
                        : 'Spread needs 10 shots'}
                    </small>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="gap-axis-row" aria-hidden="true">
            <span />
            <AxisRow min={scale.min} max={scale.max} />
            <span />
          </div>
          <p className="chart-legend muted" aria-hidden="true">
            <span className="legend-dot primary" /> band: P10–P90 + IQR,
            line: median
            <span className="legend-dot compare" /> dashed: P80 potential
          </p>
        </>
      )}
      {chartView === 'potential' && (
        <>
          <ChartContainer
            label={chartLabel}
            height={Math.max(160, rows.length * 44 + 24)}
          >
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 4, right: 20, bottom: 0, left: 0 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                domain={[0, barMax]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => String(v)}
              />
              <YAxis
                type="category"
                dataKey="club"
                width={48}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={<ChartTooltipContent unit="m" />}
                cursor={{ fill: 'var(--surface-2)' }}
                isAnimationActive={!reduced}
              />
              <Bar
                dataKey="median"
                name={medianLabel(settings.contact)}
                fill="var(--data)"
                radius={[0, 6, 6, 0]}
                isAnimationActive={!reduced}
                onClick={(entry) => setClub(String((entry.payload as { club?: string } || {}).club ?? ""))}
              />
              <Bar
                dataKey="potential"
                name="Strong-strike potential (P80)"
                fill="var(--compare)"
                radius={[0, 6, 6, 0]}
                isAnimationActive={!reduced}
                onClick={(entry) => setClub(String((entry.payload as { club?: string } || {}).club ?? ""))}
              />
            </BarChart>
          </ChartContainer>
          <p className="chart-legend muted" aria-hidden="true">
            <span className="legend-dot primary" /> {medianLabel(settings.contact)}
            <span className="legend-dot compare" /> Strong-strike potential (P80)
          </p>
        </>
      )}
      {chartView === 'simple' && (
        <ChartContainer
          label={chartLabel}
          height={Math.max(140, rows.length * 36 + 20)}
        >
          <BarChart
            data={barData}
            layout="vertical"
            margin={{ top: 4, right: 20, bottom: 0, left: 0 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              domain={[0, barMax]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => String(v)}
            />
            <YAxis
              type="category"
              dataKey="club"
              width={48}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<ChartTooltipContent unit="m" />}
              cursor={{ fill: 'var(--surface-2)' }}
              isAnimationActive={!reduced}
            />
            <Bar
              dataKey="median"
              name={medianLabel(settings.contact)}
              fill="var(--data)"
              radius={[0, 6, 6, 0]}
              isAnimationActive={!reduced}
              onClick={(entry) => setClub(String((entry.payload as { club?: string } || {}).club ?? ""))}
            />
          </BarChart>
        </ChartContainer>
      )}
      {selected && (
        <div
          className="gap-detail"
          role="region"
          aria-live="polite"
          aria-label={`Gapping details for ${selected.club}`}
        >
          <div className="gap-detail-head">
            <span className="club-badge" aria-hidden="true">
              {selected.club.toUpperCase()}
            </span>
            <strong>{clubDisplayName(selected.club)}</strong>
            <a href={clubHref(selected.club)}>
              Open the {clubDisplayName(selected.club)} profile
            </a>
          </div>
          <MetricGrid>
            <Metric
              label={medianLabel(settings.contact)}
              value={fmt(selected.band.median)}
              unit="m"
              delta={`${selected.n} ${selected.n === 1 ? 'shot' : 'shots'}${selected.reliable ? '' : ' · sample limited'}`}
            />
            <Metric
              label="Strong-strike potential (P80)"
              value={fmt(selected.potential)}
              unit="m"
              delta={
                selected.potential === null
                  ? `needs ${GAP_THRESHOLDS.minSamples}+ measured`
                  : 'from all full swings'
              }
            />
            <Metric
              label="Middle 80% (P10–P90)"
              value={
                selected.band.p10 !== null && selected.band.p90 !== null
                  ? `${fmt(selected.band.p10)}–${fmt(selected.band.p90)}`
                  : '—'
              }
              unit="m"
              delta={selected.reliable ? undefined : 'Spread needs 10 shots'}
            />
            <Metric
              label="IQR (middle half)"
              value={
                selected.band.q1 !== null && selected.band.q3 !== null
                  ? fmt(selected.band.q3 - selected.band.q1)
                  : '—'
              }
              unit="m"
            />
            <Metric
              label={
                selected.gap === null
                  ? 'Gap to next longer club'
                  : `Gap vs ${rows[rows.indexOf(selected) - 1]?.club ?? ''}`
              }
              value={
                selected.gap === null
                  ? '—'
                  : `${selected.gap >= 0 ? '+' : '−'}${fmt(Math.abs(selected.gap))}`
              }
              unit="m"
              delta={
                flagText(selected.flag) ? (
                  <Badge tone={flagTone(selected.flag) ?? 'neutral'}>
                    {flagText(selected.flag)}
                  </Badge>
                ) : selected.gap !== null && !selected.reliable ? (
                  'Sample limited'
                ) : undefined
              }
            />
          </MetricGrid>
        </div>
      )}
    </Card>
  );
}
