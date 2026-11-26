import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { type AnalysisQuery } from '../domain/analytics';
import {
  BASES,
  type Basis,
  type Dataset,
  type MetricKey,
} from '../domain/model';
import { wedgePractice } from '../domain/wedgePractice';
import { carryBandOf } from './clubProfileData';
import { sessionHref, visitLabel } from './SessionRecap';
import { Badge, Disclosure, EmptyState, HelpPopover } from './ds';
import {
  ChartContainer,
  ChartSummary,
  ChartTooltipContent,
  DistributionPlot,
  PerformanceScatterPlot,
  sharedBandScale,
  usePrefersReducedMotion,
  type ScatterTick,
} from './charts';

type WedgeGroup = ReturnType<typeof wedgePractice>['groups'][number];
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat(undefined, {
  maximumSignificantDigits: 21,
});
const intentLabels = { full: 'Full', partial: 'Partial', unknown: 'Unknown' };
const intentTones = { full: 'brand', partial: 'warn', unknown: 'neutral' } as const;

function metres(value: number | null) {
  return value === null ? 'Missing' : `${decimal.format(value)} m`;
}

function groupKey(group: WedgeGroup) {
  return JSON.stringify([
    group.club,
    group.kind === 'target' ? group.target : group.intent,
  ]);
}

function groupName(group: WedgeGroup) {
  return group.kind === 'target'
    ? `${group.club} · ${exact.format(group.target)} m target`
    : `${group.club} · ${intentLabels[group.intent]} intent`;
}

function ticksOf([lo, hi]: [number, number]): ScatterTick[] {
  const mid = (lo + hi) / 2;
  return [lo, mid, hi].map((value) => ({ value, text: value.toFixed(1) }));
}

/**
 * Scatter x domain for a wedge group: every shot keeps its original position
 * (x = index + 1) even when its carry is missing and therefore not plotted,
 * so the axis must span the whole group — sizing it from the measured subset
 * would push later points outside the plot viewport.
 */
export function wedgeScatterXDomain(totalShots: number): [number, number] {
  return [0.5, Math.max(1, totalShots) + 0.5];
}

/** Intent mix bar: full swings vs intentional partial practice, never by colour alone (the counts are in the text line). */
function IntentBar({ group }: { group: WedgeGroup }) {
  if (group.kind !== 'target') return null;
  const { full, partial, unknown } = group.intentCounts;
  const total = full + partial + unknown;
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <span
      className="wedge-intent-bar"
      role="img"
      aria-label={`${full} full, ${partial} partial, ${unknown} unknown intent`}
    >
      {full > 0 && (
        <span className="seg full" style={{ width: pct(full) }} title={`${full} full`} />
      )}
      {partial > 0 && (
        <span
          className="seg partial"
          style={{ width: pct(partial) }}
          title={`${partial} partial`}
        />
      )}
      {unknown > 0 && (
        <span
          className="seg unknown"
          style={{ width: pct(unknown) }}
          title={`${unknown} unknown`}
        />
      )}
    </span>
  );
}

/** Shot-level scatter for one group: carry per shot in group order. Missing carries are never plotted as zero. */
function GroupScatter({
  group,
  basis,
  sessions,
}: {
  group: WedgeGroup;
  basis: Basis;
  sessions: ReadonlyMap<string, Dataset['sessions'][number]>;
}) {
  const [selected, setSelected] = useState('');
  const key = BASES[basis].carry;
  const points = group.shots.flatMap((shot, i) => {
    const carry = shot.measurements[key];
    if (carry === null || carry <= 0) return [];
    const session = sessions.get(shot.sessionId);
    const target = shot.measurements.target;
    return [
      {
        id: shot.id,
        x: i + 1,
        y: carry,
        label: `${visitLabel(session ?? { date: '?', time: null })} row ${shot.rowIndex} · ${decimal.format(carry)} m · ${intentLabels[shot.review.intent]}`,
        title: `Row ${shot.rowIndex} · ${intentLabels[shot.review.intent]} intent · target ${target === null || target < 0 ? 'missing' : `${exact.format(target)} m`} · carry ${decimal.format(carry)} m${session ? ` · ${session.filename}` : ''}`,
      },
    ];
  });
  if (!points.length) {
    return (
      <p className="context">No measured carries to plot in this group.</p>
    );
  }
  const ys = points.map((p) => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.2 || 1;
  const selectedPoint = points.find((p) => p.id === selected);
  // The x axis spans every shot in the group — points keep their original
  // positions (missing carries are simply not plotted), so the domain must
  // come from group.shots.length, not from the measured subset.
  const [xLo, xHi] = wedgeScatterXDomain(group.shots.length);
  return (
    <div className="wedge-scatter">
      <PerformanceScatterPlot
        label={`${groupName(group)} carry per shot`}
        caption={`Basis ${BASES[basis].label}`}
        xLabel="Shot (group order)"
        yLabel="Carry (m)"
        xTicks={ticksOf([1, group.shots.length])}
        yTicks={ticksOf([yMin - yPad, yMax + yPad])}
        xDomain={[xLo, xHi]}
        yDomain={[yMin - yPad, yMax + yPad]}
        points={points}
        selectedId={selected}
        onSelect={setSelected}
      />
      <p className="context">
        {selectedPoint
          ? `Selected: ${selectedPoint.label}`
          : 'Select a point to inspect that shot.'}
      </p>
    </div>
  );
}

function WedgeGroupCard({
  group,
  basis,
  sessions,
  bandScale,
  scatterOpen,
  onToggleScatter,
}: {
  group: WedgeGroup;
  basis: Basis;
  sessions: ReadonlyMap<string, Dataset['sessions'][number]>;
  bandScale: { min: number; max: number };
  scatterOpen: boolean;
  onToggleScatter: () => void;
}) {
  const { carry, speed, launch, apex, shots, direction, intentCounts } = group;
  const name = groupName(group);
  const carryKey = BASES[basis].carry;
  const band = carryBandOf(shots, carryKey);
  const bandComplete =
    band.p10 !== null && band.q1 !== null && band.median !== null &&
    band.q3 !== null && band.p90 !== null;
  const flight = [
    { label: 'Median launch', metric: launch, unit: '°' },
    { label: 'Median ball speed', metric: speed, unit: ' kph' },
    { label: 'Median apex', metric: apex, unit: ' m' },
  ];
  const directions = [
    { label: 'Launch direction', metric: direction.launch },
    { label: 'Curve', metric: direction.curve },
    { label: 'From Centre', metric: direction.lateral },
  ];

  return (
    <article className="wedge-group" aria-label={name}>
      <div className="wedge-group-head">
        <h4>{name}</h4>
        {group.kind === 'intent' && (
          <Badge tone={intentTones[group.intent]}>
            {intentLabels[group.intent]} intent
          </Badge>
        )}
        <IntentBar group={group} />
      </div>
      <p className="context">
        {shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {group.visits}{' '}
        {group.visits === 1 ? 'session' : 'sessions'}
        {group.kind === 'target' &&
          ` · ${intentCounts.full} full, ${intentCounts.partial} partial, ${intentCounts.unknown} unknown intent`}
      </p>
      <p className="wedge-carry">
        <strong>
          Median carry{' '}
          {carry.median === null ? 'unavailable' : metres(carry.median)}
        </strong>
        {' · '}
        {carry.n} of {shots.length} measured
        {carry.iqr === null
          ? ' · Carry spread needs 4 measured shots'
          : ` · Middle half spans ${metres(carry.iqr)}`}
      </p>
      {bandComplete && (
        <DistributionPlot
          band={band}
          min={bandScale.min}
          max={bandScale.max}
          label={`${name} carry distribution`}
          labels={false}
          stretch
        />
      )}
      {flight.some(({ metric }) => metric.median !== null) && (
        <ul className="wedge-metrics">
          {flight.map(
            ({ label, metric, unit }) =>
              metric.median !== null && (
                <li key={label}>
                  {label} {decimal.format(metric.median)}
                  {unit} · {metric.n} of {shots.length} measured
                </li>
              ),
          )}
        </ul>
      )}
      {directions.some(({ metric }) => metric.n > 0) && (
        <>
          <p className="context">
            Recorded direction · {group.aimed} target{' '}
            {group.aimed === 1 ? 'shot' : 'shots'} with proximity
          </p>
          <ul className="wedge-metrics">
            {directions.map(
              ({ label, metric }) =>
                metric.n > 0 && (
                  <li key={label}>
                    {label} · {metric.left} left, {metric.straight} centred,{' '}
                    {metric.right} right · {metric.n} of {group.aimed} measured
                  </li>
                ),
            )}
          </ul>
        </>
      )}
      <div className="wedge-group-actions">
        <button
          type="button"
          className="ds-toggle"
          aria-pressed={scatterOpen}
          onClick={onToggleScatter}
        >
          Shot scatter: {scatterOpen ? 'shown' : 'hidden'}
        </button>
      </div>
      {scatterOpen && (
        <GroupScatter group={group} basis={basis} sessions={sessions} />
      )}
      <Disclosure summary={`View ${shots.length} shot ${shots.length === 1 ? 'row' : 'rows'}`}>
        <div
          className="table-wrap"
          role="region"
          aria-label={`${name} shot rows`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard focus enables horizontal scrolling.
          tabIndex={0}
        >
          <table aria-label={`${name} shots`}>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Source row</th>
                <th scope="col">Intent</th>
                <th scope="col">Recorded target</th>
                <th scope="col">Carry</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot) => {
                const session = sessions.get(shot.sessionId);
                const target = shot.measurements.target;
                return (
                  <tr key={shot.id}>
                    <td>
                      {session && (
                        <a
                          href={sessionHref(session.id)}
                          title={session.filename}
                        >
                          {session.date}
                          {session.time && ` · ${session.time.slice(0, 5)}`}
                        </a>
                      )}
                    </td>
                    <td>{shot.rowIndex}</td>
                    <td>{intentLabels[shot.review.intent]}</td>
                    <td>
                      {target === null || target < 0
                        ? 'Missing'
                        : `${exact.format(target)} m`}
                    </td>
                    <td>{metres(shot.measurements[BASES[basis].carry])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </article>
  );
}

/** Target-group comparison: recorded target vs median carry, side by side on one shared axis. */
function TargetComparison({ groups }: { groups: WedgeGroup[] }) {
  const reduced = usePrefersReducedMotion();
  const data = groups.map((group) => ({
    label:
      group.kind === 'target'
        ? `${group.club} ${exact.format(group.target)} m`
        : group.club,
    target: group.kind === 'target' ? group.target : null,
    median: group.carry.median,
    detail: `${group.shots.length} shots · ${group.visits} ${group.visits === 1 ? 'session' : 'sessions'} · ${group.carry.n} measured`,
  }));
  const max = Math.max(
    ...data.flatMap((d) => [d.target ?? 0, d.median ?? 0]),
    10,
  );
  const xMax = Math.ceil(max / 10) * 10;
  return (
    <>
      <ChartSummary label="Wedge target groups summary">
        {data
          .map(
            (d) =>
              `${d.label}: target ${d.target === null ? '—' : `${exact.format(d.target)} m`}, median carry ${d.median === null ? '—' : `${decimal.format(d.median)} m`}`,
          )
          .join('. ')}
        .
      </ChartSummary>
      <ChartContainer
        label="Wedge target groups: recorded target vs median carry"
        height={Math.max(150, data.length * 52 + 24)}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 20, bottom: 0, left: 0 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            domain={[0, xMax]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => String(v)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={86}
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
            name="Median carry"
            fill="var(--data)"
            radius={[0, 6, 6, 0]}
            isAnimationActive={!reduced}
          />
          <Bar
            dataKey="target"
            name="Recorded target"
            fill="var(--compare)"
            radius={[0, 6, 6, 0]}
            isAnimationActive={!reduced}
          />
        </BarChart>
      </ChartContainer>
      <p className="chart-legend muted" aria-hidden="true">
        <span className="legend-dot primary" /> Median carry
        <span className="legend-dot compare" /> Recorded target
      </p>
      <p className="context">
        Target distance and carry are shown side by side. The carry reference
        for calculating target error is unverified, so the two are not treated
        as directly comparable.
      </p>
    </>
  );
}

export function WedgePractice({
  data,
  basis,
  query,
}: {
  data: Dataset;
  basis: Basis;
  query: AnalysisQuery;
}) {
  const { total, targeted, missingTarget, zeroTarget, groups } = wedgePractice(
    data,
    basis,
    query,
  );
  const sessions = useMemo(
    () => new Map(data.sessions.map((session) => [session.id, session])),
    [data.sessions],
  );
  const [scatterFor, setScatterFor] = useState<string | null>(null);
  // One shared scale for the per-group distribution plots.
  const bandScale = useMemo(() => {
    const carryKey = BASES[basis].carry as MetricKey;
    return sharedBandScale(groups.map((group) => carryBandOf(group.shots, carryKey)));
  }, [groups, basis]);
  const targetGroups = groups.filter((group) => group.kind === 'target');
  const intentGroups = groups.filter((group) => group.kind === 'intent');
  return (
    <section
      className="ds-card wedge-practice"
      aria-labelledby="wedge-practice"
    >
      <div className="ds-section-header">
        <div>
          <h2 id="wedge-practice">Wedge practice</h2>
          <div className="ds-section-sub">
            {query.mode === 'recent' ? 'Recent' : 'All-time'} ·{' '}
            {BASES[basis].label}
          </div>
        </div>
        <HelpPopover label="How wedge practice is grouped">
          <p>
            Wedge shots are grouped by exact recorded target distance; shots
            without a positive target are grouped by reviewed intent, so
            intentional partial-distance practice stays separate from
            full-swing performance. The intent mix inside each target group is
            shown as a bar — green full, amber partial, grey unknown.
          </p>
          <p>
            Target distance and measured carry are shown side by side but are
            not assumed to be directly comparable: the carry reference for
            target error is unverified. Carry spread (the middle half) needs 4
            measured shots; distribution bands need 10+.
          </p>
          <p>
            Full-swing gapping on this page excludes higher-wedge shots without
            explicit full intent; the pitching wedge counts like an iron.
          </p>
        </HelpPopover>
      </div>
      {total === 0 ? (
        <EmptyState title="No wedge shots in this view." />
      ) : (
        <>
          <p>
            <strong>
              {targeted} of {total} wedge shots have a recorded target
            </strong>
          </p>
          <p className="context">
            {missingTarget} missing target · {zeroTarget} recorded as 0 m. Both
            are grouped by shot intent.
          </p>
          <h3>Recorded targets</h3>
          {targetGroups.length > 0 ? (
            <TargetComparison groups={targetGroups} />
          ) : (
            <p>No positive target distances in these shots.</p>
          )}
          {targetGroups.map((group) => (
            <WedgeGroupCard
              key={groupKey(group)}
              group={group}
              basis={basis}
              sessions={sessions}
              bandScale={bandScale}
              scatterOpen={scatterFor === groupKey(group)}
              onToggleScatter={() =>
                setScatterFor((current) =>
                  current === groupKey(group) ? null : groupKey(group),
                )
              }
            />
          ))}
          <h3>Shots without a target</h3>
          {targeted === total && (
            <p>Every wedge shot in this view has a positive target.</p>
          )}
          {intentGroups.map((group) => (
            <WedgeGroupCard
              key={groupKey(group)}
              group={group}
              basis={basis}
              sessions={sessions}
              bandScale={bandScale}
              scatterOpen={scatterFor === groupKey(group)}
              onToggleScatter={() =>
                setScatterFor((current) =>
                  current === groupKey(group) ? null : groupKey(group),
                )
              }
            />
          ))}
        </>
      )}
    </section>
  );
}
