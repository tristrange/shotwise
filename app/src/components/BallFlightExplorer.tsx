import { useMemo, useState } from 'react';
import {
  EXPLORER_AXES,
  explorerAxis,
  explorerClubs,
  explorerPlot,
  type ExplorerAxis,
  type ExplorerQuery,
} from '../domain/explorer';
import { resolveShots } from '../domain/assessment';
import { CLASSIFIER_VERSION } from '../domain/classify';
import { effectiveClub, localToday, type Dataset } from '../domain/model';
import type { AnalysisSettings } from '../domain/analytics';
import { BasisButton } from './AnalysisControls';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  HelpPopover,
  SectionHeader,
  SegmentedControl,
  Select,
} from './ds';
import type { SegmentedOption } from './ds';
import { PerformanceScatterPlot, type ScatterTick } from './charts';
import { sessionOptionLabel } from './CompareSessions';

const INTENT_OPTIONS: { value: ExplorerQuery['intent']; label: string }[] = [
  { value: 'all', label: 'All intents' },
  { value: 'full', label: 'Full swings' },
  { value: 'partial', label: 'Partial swings' },
  { value: 'unknown', label: 'Unknown intent' },
];
const CONTACT_OPTIONS: { value: ExplorerQuery['contact']; label: string }[] = [
  { value: 'all', label: 'All shots' },
  { value: 'typical', label: 'Typical' },
  { value: 'strong', label: 'Strong-strike' },
];
const SCOPE_OPTIONS: readonly SegmentedOption<'recent' | 'all' | 'session'>[] =
  [
    {
      value: 'recent',
      label: 'Recent',
      title: 'Latest 50 shots for this club from the last 60 days',
    },
    { value: 'all', label: 'All-time', title: 'Every non-archived session' },
    {
      value: 'session',
      label: 'Session',
      title: 'One exact named visit, using its complete eligible population',
    },
  ];
const SHOTS_PER_PAGE = 50;

function valueText(value: number, unit: string) {
  return unit === '°' ? `${value.toFixed(1)}°` : `${value.toFixed(1)} ${unit}`;
}

function missingText(value: number | null, unit: string) {
  return value === null ? 'Missing' : valueText(value, unit);
}

/** Plot domain from 0 (or the lowest value) up to a rounded maximum. */
function domainOf(values: number[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const value of values) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  return [Math.floor(lo), hi === lo ? 1 : Math.ceil(hi)];
}

function ticksOf([lo, hi]: [number, number]): ScatterTick[] {
  const mid = (lo + hi) / 2;
  return [lo, mid, hi].map((value) => ({
    value,
    text: value.toFixed(1),
  }));
}

export function reviewShotHref(shotId: string, sessionId: string) {
  return `#sessions/${sessionId}?shot=${shotId}`;
}

export function BallFlightExplorer({
  data,
  settings,
  onSettingsChange,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
}) {
  const [selected, setSelected] = useState('');
  const [club, setClub] = useState('');
  const [xAxis, setXAxis] = useState<ExplorerAxis>('speed');
  const [yAxis, setYAxis] = useState<ExplorerAxis>('carry');
  const [scope, setScope] = useState<'recent' | 'all' | 'session'>('recent');
  const [sessionId, setSessionId] = useState('');
  const [intent, setIntent] = useState<ExplorerQuery['intent']>('all');
  const [contact, setContact] = useState<ExplorerQuery['contact']>('all');
  const [shotPage, setShotPage] = useState(0);

  const today = localToday();
  const clubs = explorerClubs(data, today, settings.basis);
  const activeClub = clubs.includes(club) ? club : (clubs[0] ?? '');
  const sessionOptions = [...data.sessions]
    .filter((session) => !session.archived)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.time ?? '').localeCompare(a.time ?? '') ||
        a.id.localeCompare(b.id),
    );
  const namedSession =
    scope === 'session'
      ? sessionOptions.find((session) => session.id === sessionId)
      : undefined;
  const query: ExplorerQuery = {
    club: activeClub,
    x: xAxis,
    y: yAxis,
    basis: settings.basis,
    scope: scope === 'session' ? { session: sessionId } : scope,
    intent,
    contact,
    today,
  };
  const plot = activeClub ? explorerPlot(data, query) : undefined;
  const shotCount = plot?.shots.length ?? 0;
  const lastPage = Math.max(0, Math.ceil(shotCount / SHOTS_PER_PAGE) - 1);
  const page = Math.min(shotPage, lastPage);
  const first = page * SHOTS_PER_PAGE;
  const last = Math.min(first + SHOTS_PER_PAGE, shotCount);
  const sessionNames = new Map(
    data.sessions.map((session) => [session.id, sessionOptionLabel(session)]),
  );
  const xInfo = plot ? plot.xAxis : explorerAxis(xAxis, settings.basis);
  const yInfo = plot ? plot.yAxis : explorerAxis(yAxis, settings.basis);
  const xLabel = `${xInfo.label} (${xInfo.unit})`;
  const yLabel = `${yInfo.label} (${yInfo.unit})`;
  const inspected = plot?.shots.find((shot) => shot.id === selected);
  const inspectedX = inspected?.measurements[xInfo.metric] ?? null;
  const inspectedY = inspected?.measurements[yInfo.metric] ?? null;
  // Automatic likely-mishit provenance (ADR-0001): only shots whose contact is
  // still unreviewed carry the automatic label, and a saved review always
  // wins. Unassessed shots are never styled as confirmed good strikes.
  const resolved = useMemo(
    () => resolveShots(data.shots, data.sessions, 'premium-flat'),
    [data.shots, data.sessions],
  );
  // resolveShots is cached per shots/sessions identity, so this pass is cheap.
  const likelyMishits = new Set<string>();
  for (const shot of plot?.shots ?? []) {
    if (
      shot.review.contact === 'uncertain' &&
      resolved.get(shot.id)?.automatic?.contact.value === 'mishit'
    ) {
      likelyMishits.add(shot.id);
    }
  }
  const plotPoints = (plot?.points ?? []).map((point) => {
    const name = sessionNames.get(point.shot.sessionId) ?? '';
    const xText = valueText(point.x, xInfo.unit);
    const yText = valueText(point.y, yInfo.unit);
    const mishit = likelyMishits.has(point.shot.id);
    return {
      id: point.shot.id,
      x: point.x,
      y: point.y,
      label: `Plot ${plot?.club ?? ''} row ${point.shot.rowIndex} · ${name} · ${xInfo.label.toLowerCase()} ${xText} · ${yInfo.label.toLowerCase()} ${yText}${mishit ? ' · auto likely mishit' : ''}`,
      title: `Row ${point.shot.rowIndex} · Shot #${point.shot.sourceNumber || '—'} · ${name}: ${xInfo.label} ${xText}, ${yInfo.label} ${yText}${mishit ? ' · auto likely mishit (provisional)' : ''}`,
    };
  });
  const xDomain = domainOf(plotPoints.map((p) => p.x));
  const yDomain = domainOf(plotPoints.map((p) => p.y));

  return (
    <>
      <div className="section-heading">
        <h1>Ball-flight explorer</h1>
      </div>
      <Card
        className="explorer-card"
        role="region"
        aria-label="Ball-flight explorer"
      >
        <SectionHeader
          title={`${xInfo.label} vs ${yInfo.label}${plot ? ` · ${plot.club}` : ''}`}
          sub={
            plot
              ? `${plot.points.length} of ${plot.shots.length} shots plotted · ${plot.omitted} omitted without both measurements · missing X (${xInfo.label}): ${plot.missingX} · missing Y (${yInfo.label}): ${plot.missingY}`
              : undefined
          }
          aside={
            <div className="card-controls">
              <BasisButton
                basis={settings.basis}
                onChange={(basis) => onSettingsChange({ ...settings, basis })}
              />
              <HelpPopover label="How points are marked">
                <p>
                  Points marked <em>auto likely mishit</em> come from the
                  automatic classifier ({CLASSIFIER_VERSION}) and only apply
                  while the contact decision is still unreviewed — a saved
                  review always wins. Unassessed shots are not marked, and no
                  mark confirms a good strike.
                </p>
              </HelpPopover>
            </div>
          }
        />
        {!clubs.length && (
          <EmptyState title="No shots match this view">
            Import a session to begin.
          </EmptyState>
        )}
        {clubs.length > 0 && (
          <>
            <div className="explorer-controls">
              <Select
                label="Effective club"
                value={activeClub}
                onChange={(next) => {
                  setClub(next);
                  setShotPage(0);
                }}
                options={clubs.map((name) => ({ value: name, label: name }))}
              />
              <Select
                label="X axis"
                value={xAxis}
                onChange={(next) => setXAxis(next)}
                options={EXPLORER_AXES.map((axis) => ({
                  value: axis,
                  label: explorerAxis(axis, settings.basis).label,
                }))}
              />
              <Select
                label="Y axis"
                value={yAxis}
                onChange={(next) => setYAxis(next)}
                options={EXPLORER_AXES.map((axis) => ({
                  value: axis,
                  label: explorerAxis(axis, settings.basis).label,
                }))}
              />
              <SegmentedControl
                label="Time scope"
                options={SCOPE_OPTIONS}
                value={scope}
                onChange={(next) => {
                  setScope(next);
                  setShotPage(0);
                }}
              />
              <Select
                label="Session"
                value={sessionId}
                disabled={scope !== 'session'}
                onChange={(next) => {
                  setSessionId(next);
                  setShotPage(0);
                }}
                options={[
                  { value: '', label: 'Choose a session' },
                  ...sessionOptions.map((session) => ({
                    value: session.id,
                    label: sessionOptionLabel(session),
                  })),
                ]}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setXAxis(yAxis);
                  setYAxis(xAxis);
                }}
              >
                Swap axes
              </Button>
            </div>
            <Disclosure
              summary="Filters"
              className="explorer-filters-disclosure"
            >
              <div className="explorer-filters">
                <Select
                  label="Shot intent"
                  value={intent}
                  onChange={(next) => {
                    setIntent(next);
                    setShotPage(0);
                  }}
                  options={INTENT_OPTIONS}
                />
                <Select
                  label="Contact"
                  value={contact}
                  onChange={(next) => {
                    setContact(next);
                    setShotPage(0);
                  }}
                  options={CONTACT_OPTIONS}
                />
              </div>
            </Disclosure>
            {scope === 'session' && !namedSession && (
              <p className="notice" role="status">
                Choose a session to plot that visit&apos;s complete eligible
                shots.
              </p>
            )}
            {scope === 'session' && namedSession && (
              <p className="chart-hint">
                Session · {sessionOptionLabel(namedSession)}
              </p>
            )}
            {plot && plot.shots.length === 0 && (
              <p className="notice" role="status">
                No eligible {plot.club} shots in this scope and filter. Try
                All-time, another club, or fewer filters.
              </p>
            )}
            {plot && plot.shots.length > 0 && plotPoints.length > 0 && (
              <>
                <p className="chart-hint">
                  Select a point or use the Left and Right arrow keys on the
                  chart.
                </p>
                <PerformanceScatterPlot
                  label={`${plot.club} explorer plot · ${xLabel} vs ${yLabel}`}
                  caption={`Basis ${plot.basisLabel}`}
                  xLabel={xLabel}
                  yLabel={yLabel}
                  xTicks={ticksOf(xDomain)}
                  yTicks={ticksOf(yDomain)}
                  xDomain={xDomain}
                  yDomain={yDomain}
                  zeroLines
                  points={plotPoints}
                  selectedId={selected}
                  onSelect={setSelected}
                  pointClass={(id) =>
                    likelyMishits.has(id) ? 'mishit' : undefined
                  }
                />
                {likelyMishits.size > 0 && (
                  <p className="chart-legend muted">
                    <span className="legend-dot mishit" aria-hidden="true" />
                    {likelyMishits.size} auto likely{' '}
                    {likelyMishits.size === 1 ? 'mishit' : 'mishits'}{' '}
                    (provisional; unassessed shots are not marked)
                  </p>
                )}
              </>
            )}
            {plot && plot.shots.length > 0 && plotPoints.length === 0 && (
              <p className="notice">
                No paired {xInfo.label} and {yInfo.label} measurements for{' '}
                {plot.club} in this view.
              </p>
            )}
            <div
              className="shape-detail"
              role="region"
              aria-label={`Selected shot measurements for ${plot?.club ?? ''}`}
              aria-live="polite"
            >
              {plot && inspected ? (
                <>
                  <strong>
                    {effectiveClub(inspected)} · Row {inspected.rowIndex} · Shot
                    #{inspected.sourceNumber || '—'} ·{' '}
                    {sessionNames.get(inspected.sessionId)}
                  </strong>
                  <div className="shape-tiles">
                    <p className="shape-tile">
                      {xInfo.label}: {missingText(inspectedX, xInfo.unit)}
                    </p>
                    <p className="shape-tile">
                      {yInfo.label}: {missingText(inspectedY, yInfo.unit)}
                    </p>
                  </div>
                  <p className="context">
                    Basis {plot.basisLabel} · X {xLabel} · Y {yLabel}
                  </p>
                  <p>
                    <a href={reviewShotHref(inspected.id, inspected.sessionId)}>
                      Review shot
                    </a>
                  </p>
                </>
              ) : (
                <p>Select a shot to see its recorded measurements.</p>
              )}
            </div>
            {plot && plot.shots.length > 0 && (
              <>
                <h3>All eligible shots ({plot.shots.length})</h3>
                {lastPage > 0 && (
                  <div className="actions">
                    <Button
                      variant="secondary"
                      disabled={page === 0}
                      onClick={() => setShotPage(page - 1)}
                    >
                      Previous shot page
                    </Button>
                    <span role="status">
                      Shots {first + 1}–{last} of {shotCount}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={page === lastPage}
                      onClick={() => setShotPage(page + 1)}
                    >
                      Next shot page
                    </Button>
                  </div>
                )}
                <div className="table-wrap">
                  <table aria-label={`${plot.club} explorer shots`}>
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Source row / shot #</th>
                        <th>X · {xLabel}</th>
                        <th>Y · {yLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plot.shots.slice(first, last).map((shot) => (
                        <tr key={shot.id}>
                          <td>{sessionNames.get(shot.sessionId)}</td>
                          <td>
                            <Button
                              variant="ghost"
                              small
                              aria-label={`Inspect row ${shot.rowIndex} · ${sessionNames.get(shot.sessionId) ?? ''}`}
                              aria-pressed={selected === shot.id}
                              onClick={() => setSelected(shot.id)}
                            >
                              {shot.rowIndex} / {shot.sourceNumber || '—'}
                            </Button>
                          </td>
                          <td>
                            {missingText(
                              shot.measurements[xInfo.metric] ?? null,
                              xInfo.unit,
                            )}
                          </td>
                          <td>
                            {missingText(
                              shot.measurements[yInfo.metric] ?? null,
                              yInfo.unit,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </Card>
    </>
  );
}
