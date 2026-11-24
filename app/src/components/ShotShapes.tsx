import { useMemo, useState } from 'react';
import { shotShapes } from '../domain/shotShapes';
import { resolvedClub, resolveShots } from '../domain/assessment';
import {
  BASES,
  clubOrder,
  localToday,
  type Dataset,
} from '../domain/model';
import type { AnalysisSettings } from '../domain/analytics';
import { BasisButton, MishitToggle, ViewToggle } from './AnalysisControls';

const direction = (value: number | null, unit: string) =>
  value === null
    ? 'Missing'
    : `${Math.abs(value).toFixed(1)}${unit} ${value < 0 ? 'left' : value > 0 ? 'right' : 'straight'}`;

/** Shape and Explorer share the Shot shape destination; existing #shape links stay valid. */
export function ShapeViewTabs({ view }: { view: 'shape' | 'explorer' }) {
  return (
    <div className="view-tabs">
      <div className="segmented" role="group" aria-label="Shot shape views">
        <button
          className={view === 'shape' ? 'active' : ''}
          aria-pressed={view === 'shape'}
          onClick={() => {
            window.location.hash = 'shape';
          }}
        >
          Shape
        </button>
        <button
          className={view === 'explorer' ? 'active' : ''}
          aria-pressed={view === 'explorer'}
          onClick={() => {
            window.location.hash = 'shape/explorer';
          }}
        >
          Explorer
        </button>
      </div>
    </div>
  );
}

export function ShotShapes({
  data,
  settings,
  onSettingsChange,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
}) {
  const [selected, setSelected] = useState('');
  const { basis, ...filters } = settings;
  const { shots, points } = shotShapes(
    data,
    {
      ...filters,
      today: localToday(),
    },
    basis,
  );
  const resolved = useMemo(
    () => resolveShots(data.shots, data.sessions, basis),
    [data.shots, data.sessions, basis],
  );
  const clubOf = (shot: (typeof shots)[number]) => {
    const r = resolved.get(shot.id);
    return r ? resolvedClub(r) : '';
  };
  const clubs = [...new Set(shots.map(clubOf))].sort(
    (a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b),
  );
  const sessionNames = new Map(
    data.sessions.map((s) => [s.id, `${s.date} · ${s.venue || s.filename}`]),
  );
  return (
    <>
      <div className="section-heading">
        <h1>Shot shape</h1>
      </div>
      <ShapeViewTabs view="shape" />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Recorded ball flight</span>
            <h2>Start direction and curve</h2>
            <p className="context">
              {shots.length} shots · {points.length} paired measurements
            </p>
          </div>
          <div className="card-controls">
            <MishitToggle settings={settings} onChange={onSettingsChange} />
            <ViewToggle
              mode={settings.mode}
              onChange={(mode) => onSettingsChange({ ...settings, mode })}
            />
            <BasisButton
              basis={basis}
              onChange={(next) =>
                onSettingsChange({ ...settings, basis: next })
              }
            />
          </div>
        </div>
        <p>
          Across: where the ball started (left or right). Up/down: how it curved
          (right or left). Curve is the maximum bend away from the straight
          launch-to-landing line. This is not a landing-position plot or a swing
          diagnosis.
        </p>
        <p>
          Launch direction and From Centre follow the recorded aim line.
          Direction and curve stay as recorded; the selected measurement basis
          applies to carry values below. Select a point or use its shot table to
          inspect the measurements.
        </p>
        {!clubs.length && (
          <p>No shots match this view. Try All-time or import a session.</p>
        )}
        {clubs.map((club) => {
          const group = shots.filter((s) => clubOf(s) === club);
          const paired = points.filter((p) => clubOf(p.shot) === club);
          const inspected = group.find((s) => s.id === selected);
          const carry = inspected?.measurements[BASES[basis].carry];
          const xLimit = Math.max(
            1,
            Math.ceil(
              Math.max(0, ...paired.map((p) => Math.abs(p.launchDirection))),
            ),
          );
          const yLimit = Math.max(
            1,
            Math.ceil(Math.max(0, ...paired.map((p) => Math.abs(p.curve)))),
          );
          return (
            <section className="shape-club" key={club}>
              <h3>{club}</h3>
              <p>
                {paired.length} of {group.length} shots have both measurements;{' '}
                {group.length - paired.length} are absent from the plot.
              </p>
              {paired.length ? (
                <svg
                  className="shape-plot"
                  viewBox="0 0 400 320"
                  role="group"
                  aria-label={`${club} recorded shot shapes`}
                >
                  <line
                    x1="60"
                    x2="360"
                    y1="140"
                    y2="140"
                    stroke="var(--border)"
                  />
                  <line
                    x1="210"
                    x2="210"
                    y1="30"
                    y2="250"
                    stroke="var(--border)"
                  />
                  <rect
                    x="60"
                    y="30"
                    width="300"
                    height="220"
                    fill="none"
                    stroke="var(--border)"
                  />
                  <text x="60" y="270" textAnchor="middle">
                    {xLimit}° L
                  </text>
                  <text x="210" y="270" textAnchor="middle">
                    0°
                  </text>
                  <text x="360" y="270" textAnchor="middle">
                    {xLimit}° R
                  </text>
                  <text x="210" y="300" textAnchor="middle">
                    Launch direction (°)
                  </text>
                  <text x="52" y="34" textAnchor="end">
                    {yLimit} R
                  </text>
                  <text x="52" y="144" textAnchor="end">
                    0
                  </text>
                  <text x="52" y="250" textAnchor="end">
                    {yLimit} L
                  </text>
                  <text
                    transform="translate(16 140) rotate(-90)"
                    textAnchor="middle"
                  >
                    Curve (m)
                  </text>
                  {paired.map(({ shot, launchDirection, curve }) => (
                    <circle
                      className="shape-point"
                      key={shot.id}
                      cx={210 + (launchDirection / xLimit) * 150}
                      cy={140 - (curve / yLimit) * 110}
                      r={selected === shot.id ? 7 : 5}
                      role="button"
                      tabIndex={0}
                      aria-label={`Plot ${club} row ${shot.rowIndex} · ${sessionNames.get(shot.sessionId)} · launch ${direction(launchDirection, '°')} · curve ${direction(curve, ' m')}`}
                      aria-pressed={selected === shot.id}
                      onClick={() => setSelected(shot.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelected(shot.id);
                        }
                      }}
                    >
                      <title>
                        Row {shot.rowIndex}: launch{' '}
                        {direction(launchDirection, '°')}, curve{' '}
                        {direction(curve, ' m')}
                      </title>
                    </circle>
                  ))}
                </svg>
              ) : (
                <p>
                  No paired launch-direction and curve measurements for this
                  club.
                </p>
              )}
              <div
                className="shape-detail notice"
                role="region"
                aria-label={`Selected shot measurements for ${club}`}
                aria-live="polite"
              >
                {inspected ? (
                  <>
                    <strong>
                      {clubOf(inspected)} · Row {inspected.rowIndex} ·{' '}
                      {sessionNames.get(inspected.sessionId)}
                    </strong>
                    <p>
                      Launch:{' '}
                      {direction(inspected.measurements.launchDirection, '°')}{' '}
                      · Curve: {direction(inspected.measurements.curve, ' m')} ·
                      From Centre:{' '}
                      {direction(inspected.measurements.fromCentre, ' m')}
                    </p>
                    <p>
                      Carry:{' '}
                      {carry === null || carry === undefined
                        ? 'Missing'
                        : `${carry.toFixed(1)} m`}{' '}
                      · {BASES[basis].label}
                    </p>
                  </>
                ) : (
                  <p>Select a shot to see its recorded measurements.</p>
                )}
              </div>
              <details>
                <summary>Shot measurements ({group.length})</summary>
                <div className="table-wrap">
                  <table aria-label={`${club} shot measurements`}>
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Source row / shot #</th>
                        <th>Launch direction</th>
                        <th>Curve</th>
                        <th>From Centre</th>
                        <th>Carry · {BASES[basis].label}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((shot) => (
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
                            {direction(shot.measurements.launchDirection, '°')}
                          </td>
                          <td>{direction(shot.measurements.curve, ' m')}</td>
                          <td>
                            {direction(shot.measurements.fromCentre, ' m')}
                          </td>
                          <td>
                            {shot.measurements[BASES[basis].carry]?.toFixed(
                              1,
                            ) ?? 'Missing'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          );
        })}
      </section>
    </>
  );
}
