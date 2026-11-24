import { clubProgress } from '../domain/progress';
import type { AnalysisSettings } from '../domain/analytics';
import { localToday, type Dataset } from '../domain/model';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';

type SessionPoint = ReturnType<typeof clubProgress>[number]['sessions'][number];

function ProgressPlot({
  club,
  points,
  metric,
}: {
  club: string;
  points: SessionPoint[];
  metric: 'median' | 'iqr';
}) {
  const label = metric === 'median' ? 'median carry' : 'carry spread';
  const width = Math.max(360, points.length * 90 + 40);
  const step = (width - 40) / points.length;
  const maximum =
    Math.ceil(Math.max(1, ...points.map((p) => p[metric] ?? 0)) / 10) * 10;
  return (
    <figure>
      <figcaption>
        {metric === 'median'
          ? 'Median carry · higher is farther'
          : 'Carry spread · lower is more consistent'}{' '}
        (m)
      </figcaption>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- WebKit needs explicit arrow-key scrolling for this focusable region. */}
      <div
        className="progress-plot"
        role="region"
        aria-label={`${club} ${label} chart`}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard focus enables horizontal scrolling.
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 80 : -80 });
        }}
      >
        <svg
          width="100%"
          height="250"
          viewBox={`0 0 ${width} 250`}
          style={{ minWidth: width }}
          aria-hidden="true"
        >
          {[0, maximum / 2, maximum].map((tick) => {
            const y = 190 - (tick / maximum) * 150;
            return (
              <g key={tick}>
                <line x1="36" x2={width} y1={y} y2={y} stroke="var(--border)" />
                <text x="30" y={y + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const x = 40 + step * (index + 0.5);
            const value = point[metric];
            const height = ((value ?? 0) / maximum) * 150;
            return (
              <g key={point.session.id}>
                {value !== null && (
                  <rect
                    x={x - 16}
                    y={190 - height}
                    width="32"
                    height={height}
                    fill={
                      point.n < 10 ? 'var(--surface-subtle)' : 'var(--accent)'
                    }
                    stroke="var(--accent)"
                    strokeDasharray={point.n < 10 ? '3 2' : undefined}
                  />
                )}
                <text x={x} y={182 - height} textAnchor="middle">
                  {value === null ? '—' : value.toFixed(1)}
                </text>
                <text x={x} y="214" textAnchor="middle">
                  S{index + 1} · {point.session.date.slice(5)}
                </text>
                <text x={x} y="234" textAnchor="middle">
                  n={point.n}
                  {point.n < 10 ? ' · limited' : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

export function ClubProgress({
  data,
  settings,
  onSettingsChange,
  cohort,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
  cohort: string;
}) {
  const { basis, ...filters } = settings;
  const query = { ...filters, today: localToday() };
  const groups = clubProgress(data, basis, query);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Session by session</span>
          <h2>Carry over time</h2>
          <p className="context">{cohort}</p>
        </div>
        <div className="card-controls">
          <PerformanceToggle settings={settings} onChange={onSettingsChange} />
          {settings.contact !== 'strong' && (
            <MishitToggle settings={settings} onChange={onSettingsChange} />
          )}
          <ViewToggle mode={settings.mode} onChange={(mode) => onSettingsChange({ ...settings, mode })} />
          <BasisButton basis={basis} onChange={(next) => onSettingsChange({ ...settings, basis: next })} />
        </div>
      </div>
      <p>
        Compare each club with itself. Higher median carry means more distance;
        a smaller spread means more consistent distances. Spread is the width of
        the middle half of measured carries (IQR), not an error margin.
      </p>
      <p>
        Fewer than 10 measured shots: sample limited (outlined bars). Spread
        needs at least 4; missing values stay blank. S1, S2… match the table
        below each chart. Sessions without a recorded time are not ordered
        within a day. Session differences alone do not prove improvement.
      </p>
      {groups.length === 0 && <p>No club sessions match these filters.</p>}
      {groups.map(({ club, sessions }) => (
        <section className="club-progress" key={club}>
          <h3>{club}</h3>
          <div className="progress-plots">
            <ProgressPlot club={club} points={sessions} metric="median" />
            <ProgressPlot club={club} points={sessions} metric="iqr" />
          </div>
          <div className="table-wrap">
            <table aria-label={`${club} session details`}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Session</th>
                  <th>Median carry</th>
                  <th>Carry spread (IQR)</th>
                  <th>Measured / missing</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((point, index) => (
                  <tr key={point.session.id}>
                    <td>{point.session.date}</td>
                    <td>{point.session.time ?? 'Unknown'}</td>
                    <td>
                      S{index + 1} ·{' '}
                      {point.session.venue || point.session.filename}
                    </td>
                    <td>
                      {point.median === null
                        ? 'No carry'
                        : `${point.median.toFixed(1)} m`}
                    </td>
                    <td>
                      {point.iqr === null
                        ? 'Needs 4 measured shots'
                        : `${point.iqr.toFixed(1)} m`}
                    </td>
                    <td>
                      {point.n} / {point.missing}{' '}
                      {point.n < 10 && (
                        <span className="pill">Sample limited</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </section>
  );
}
