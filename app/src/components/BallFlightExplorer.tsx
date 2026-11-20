import { useState } from 'react';
import {
  EXPLORER_AXES,
  explorerAxis,
  explorerClubs,
  explorerPlot,
  type ExplorerAxis,
  type ExplorerQuery,
} from '../domain/explorer';
import {
  effectiveClub,
  localToday,
  type Dataset,
  type Session,
} from '../domain/model';
import type { AnalysisSettings } from '../domain/analytics';
import { BasisButton } from './AnalysisControls';
import { ScatterPlot, type ScatterTick } from './ScatterPlot';
import { ShapeViewTabs } from './ShotShapes';
import { sessionOptionLabel } from './CompareSessions';

const INTENT_OPTIONS: { value: ExplorerQuery['intent']; label: string }[] = [
  { value: 'all', label: 'All intents' },
  { value: 'full', label: 'Full swings' },
  { value: 'partial', label: 'Partial swings' },
  { value: 'unknown', label: 'Unknown intent' },
];

/** Selector labels identify a visit exactly without embedding other filenames. */
function sessionSelectLabel(session: Session) {
  const parts = [session.date];
  if (session.time) parts.push(session.time.slice(0, 5));
  if (session.venue) parts.push(session.venue);
  parts.push(`id ${session.id.slice(0, 8)}`);
  return parts.join(' · ');
}

function valueText(value: number, unit: string) {
  return unit === '°' ? `${value.toFixed(1)}°` : `${value.toFixed(1)} ${unit}`;
}

function missingText(value: number | null, unit: string) {
  return value === null ? 'Missing' : valueText(value, unit);
}

/** Plot domain from 0 (or the lowest value) up to a rounded maximum. */
function domainOf(values: number[]): [number, number] {
  const lo = Math.floor(Math.min(0, ...values));
  let hi = Math.ceil(Math.max(0, ...values));
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
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
  const [contact, setContact] = useState<'all' | 'typical'>('all');

  const today = localToday();
  const clubs = explorerClubs(data, today);
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
    scope:
      scope === 'session' ? { session: sessionId } : scope,
    intent,
    contact,
    today,
  };
  const plot = activeClub ? explorerPlot(data, query) : undefined;
  const sessionNames = new Map(
    data.sessions.map((s) => [s.id, `${s.date} · ${s.venue || s.filename}`]),
  );
  const xInfo = plot ? plot.xAxis : explorerAxis(xAxis, settings.basis);
  const yInfo = plot ? plot.yAxis : explorerAxis(yAxis, settings.basis);
  const xLabel = `${xInfo.label} (${xInfo.unit})`;
  const yLabel = `${yInfo.label} (${yInfo.unit})`;
  const inspected = plot?.shots.find((shot) => shot.id === selected);
  const inspectedX = inspected?.measurements[xInfo.metric] ?? null;
  const inspectedY = inspected?.measurements[yInfo.metric] ?? null;
  const plotPoints = (plot?.points ?? []).map((point) => {
    const name = sessionNames.get(point.shot.sessionId) ?? '';
    const xText = valueText(point.x, xInfo.unit);
    const yText = valueText(point.y, yInfo.unit);
    return {
      id: point.shot.id,
      x: point.x,
      y: point.y,
      label: `Plot ${plot?.club ?? ''} row ${point.shot.rowIndex} · ${name} · ${xInfo.label.toLowerCase()} ${xText} · ${yInfo.label.toLowerCase()} ${yText}`,
      title: `Row ${point.shot.rowIndex} · Shot #${point.shot.sourceNumber || '—'} · ${name}: ${xInfo.label} ${xText}, ${yInfo.label} ${yText}`,
    };
  });
  const xDomain = domainOf(plotPoints.map((p) => p.x));
  const yDomain = domainOf(plotPoints.map((p) => p.y));

  return (
    <>
      <div className="section-heading">
        <h1>Ball-flight explorer</h1>
      </div>
      <ShapeViewTabs view="explorer" />
      <section className="panel" aria-label="Ball-flight explorer">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Ball-flight explorer</span>
            <h2>
              {xInfo.label} vs {yInfo.label}
              {plot ? ` · ${plot.club}` : ''}
            </h2>
            {plot && (
              <p className="context">
                {plot.points.length} of {plot.shots.length} shots plotted ·{' '}
                {plot.omitted} omitted without both measurements · missing X (
                {xInfo.label}): {plot.missingX} · missing Y ({yInfo.label}):{' '}
                {plot.missingY}
              </p>
            )}
          </div>
          <div className="card-controls">
            <BasisButton
              basis={settings.basis}
              onChange={(basis) =>
                onSettingsChange({ ...settings, basis })
              }
            />
          </div>
        </div>
        <p>
          Paired measurements for one effective club on the{' '}
          {plot?.basisLabel ?? ''} basis. A point is plotted only when both
          selected measurements exist; zero is a recorded value, not missing.
          X: {xLabel} · Y: {yLabel}. This view describes recorded measurements
          only — it does not estimate relationships, trends, or swing mechanics.
        </p>
        {!clubs.length && (
          <p>No shots match this view. Import a session to begin.</p>
        )}
        {clubs.length > 0 && (
          <>
            <div className="form-grid explorer-controls">
              <label>
                Effective club
                <select
                  value={activeClub}
                  onChange={(e) => setClub(e.target.value)}
                >
                  {clubs.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                X axis
                <select
                  value={xAxis}
                  onChange={(e) => setXAxis(e.target.value as ExplorerAxis)}
                >
                  {EXPLORER_AXES.map((axis) => (
                    <option key={axis} value={axis}>
                      {explorerAxis(axis, settings.basis).label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Y axis
                <select
                  value={yAxis}
                  onChange={(e) => setYAxis(e.target.value as ExplorerAxis)}
                >
                  {EXPLORER_AXES.map((axis) => (
                    <option key={axis} value={axis}>
                      {explorerAxis(axis, settings.basis).label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="scope-control">
                <span className="control-label" id="explorer-time-scope">
                  Time scope
                </span>
                <div
                  className="segmented"
                  role="group"
                  aria-labelledby="explorer-time-scope"
                >
                  <button
                    className={scope === 'recent' ? 'active' : ''}
                    aria-pressed={scope === 'recent'}
                    title="Latest 50 shots for this club from the last 60 days"
                    onClick={() => setScope('recent')}
                  >
                    Recent
                  </button>
                  <button
                    className={scope === 'all' ? 'active' : ''}
                    aria-pressed={scope === 'all'}
                    title="Every non-archived session"
                    onClick={() => setScope('all')}
                  >
                    All-time
                  </button>
                  <button
                    className={scope === 'session' ? 'active' : ''}
                    aria-pressed={scope === 'session'}
                    title="One exact named visit, using its complete eligible population"
                    onClick={() => setScope('session')}
                  >
                    Session
                  </button>
                </div>
              </div>
              <label>
                Session
                <select
                  value={sessionId}
                  disabled={scope !== 'session'}
                  onChange={(e) => setSessionId(e.target.value)}
                >
                  <option value="">Choose a session</option>
                  {sessionOptions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {sessionSelectLabel(session)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shot intent
                <select
                  value={intent}
                  onChange={(e) =>
                    setIntent(e.target.value as ExplorerQuery['intent'])
                  }
                >
                  {INTENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Contact
                <select
                  value={contact}
                  onChange={(e) =>
                    setContact(e.target.value as 'all' | 'typical')
                  }
                >
                  <option value="all">All contact</option>
                  <option value="typical">Reviewed typical</option>
                </select>
              </label>
            </div>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => {
                  setXAxis(yAxis);
                  setYAxis(xAxis);
                }}
              >
                Swap axes
              </button>
            </div>
            {scope === 'session' && !namedSession && (
              <p className="notice" role="status">
                Choose a session to plot that visit&apos;s complete eligible
                shots.
              </p>
            )}
            {scope === 'session' && namedSession && (
              <p className="context">
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
              <ScatterPlot
                label={`${plot.club} explorer plot · ${xLabel} vs ${yLabel}`}
                caption={`Basis: ${plot.basisLabel}`}
                xLabel={xLabel}
                yLabel={yLabel}
                xTicks={ticksOf(xDomain)}
                yTicks={ticksOf(yDomain)}
                xDomain={xDomain}
                yDomain={yDomain}
                points={plotPoints}
                selectedId={selected}
                onSelect={setSelected}
              />
            )}
            {plot && plot.shots.length > 0 && plotPoints.length === 0 && (
              <p>
                No paired {xInfo.label} and {yInfo.label} measurements for{' '}
                {plot.club} in this view.
              </p>
            )}
            <div
              className="shape-detail notice"
              role="region"
              aria-label={`Selected shot measurements for ${plot?.club ?? ''}`}
              aria-live="polite"
            >
              {plot && inspected ? (
                <>
                  <strong>
                    {effectiveClub(inspected)} · Row {inspected.rowIndex} · Shot #
                    {inspected.sourceNumber || '—'} ·{' '}
                    {sessionNames.get(inspected.sessionId)}
                  </strong>
                  <p>
                    {xInfo.label}: {missingText(inspectedX, xInfo.unit)} ·{' '}
                    {yInfo.label}: {missingText(inspectedY, yInfo.unit)}
                  </p>
                  <p>
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
                <div className="table-wrap">
                  <table aria-label={`${plot.club} explorer shots`}>
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Source row / shot #</th>
                        <th>
                          X · {xLabel}
                        </th>
                        <th>
                          Y · {yLabel}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {plot.shots.map((shot) => (
                        <tr key={shot.id}>
                          <td>{sessionNames.get(shot.sessionId)}</td>
                          <td>
                            <button
                              className="text-button"
                              aria-label={`Inspect row ${shot.rowIndex}`}
                              onClick={() => setSelected(shot.id)}
                            >
                              {shot.rowIndex} / {shot.sourceNumber || '—'}
                            </button>
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
      </section>
    </>
  );
}
