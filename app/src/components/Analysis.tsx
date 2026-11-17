import { useState } from 'react';
import {
  BASES,
  clubOrder,
  effectiveClub,
  isUnknownClub,
  localToday,
  type Dataset,
} from '../domain/model';
import {
  metricStats,
  reviewCoverage,
  selectCohort,
  summarize,
  type AnalysisSettings,
} from '../domain/analytics';
import { AnalysisControls } from './AnalysisControls';

const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(1));
export function Analysis({
  data,
  settings,
  onSettingsChange,
  progressView = false,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
  progressView?: boolean;
}) {
  const { basis, ...filters } = settings;
  const [club, setClub] = useState('');
  const query = { ...filters, today: localToday() };
  const selected = selectCohort(data.shots, data.sessions, query);
  const clubs = [...new Set(selected.map(effectiveClub))]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b));
  const sessionDates = new Map(data.sessions.map((s) => [s.id, s.date]));
  const shots = (
    club ? selected.filter((s) => effectiveClub(s) === club) : selected
  ).toSorted(
    (a, b) =>
      (sessionDates.get(b.sessionId) ?? '').localeCompare(
        sessionDates.get(a.sessionId) ?? '',
      ) ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.rowIndex - b.rowIndex,
  );
  const summary = summarize(shots, basis);
  const coverage = reviewCoverage(
    selectCohort(data.shots, data.sessions, {
      ...query,
      contact: 'all',
      club: club || undefined,
    }),
  );
  const dates = data.sessions
    .filter((s) => shots.some((x) => x.sessionId === s.id))
    .map((s) => s.date)
    .sort();
  const rows = clubs
    .filter((name) => !club || name === club)
    .map((name) => {
      const stats = metricStats(
        selected.filter((s) => effectiveClub(s) === name),
        BASES[basis].carry,
      );
      return {
        name,
        median: stats.median,
        low: stats.p10,
        high: stats.p90,
        n: stats.n,
        missing: stats.missing,
        reliable: stats.n >= 10,
      };
    });
  const scale = Math.max(...rows.map((row) => row.high ?? row.median ?? 0), 1) * 1.1;
  const progress = data.sessions
    .filter((s) => shots.some((x) => x.sessionId === s.id))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? '').localeCompare(b.time ?? ''),
    )
    .map((s) => ({
      session: s,
      stats: summarize(
        shots.filter((x) => x.sessionId === s.id),
        basis,
      ),
    }));
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Ball flight</span>
          <h1>{progressView ? 'Progress' : 'Your overview'}</h1>
          <p>
            {progressView
              ? 'Median carry for each session, oldest first.'
              : 'Median carry by club, with the sample size behind each figure.'}
          </p>
        </div>
      </div>
      <AnalysisControls settings={settings} onChange={onSettingsChange}>
        <label>
          Club
          <select value={club} onChange={(e) => setClub(e.target.value)}>
            <option value="">All clubs</option>
            {clubs.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </AnalysisControls>
      <p className="context">
        {summary.n} shots · {summary.sessions} sessions ·{' '}
        {dates.length ? `${dates[0]} to ${dates.at(-1)}` : 'No dates'} · Contact
        reviewed {coverage.reviewed}/{coverage.total} · Full-swing mishits{' '}
        {coverage.mishits}/{coverage.fullReviewed} reviewed (
        {coverage.unassessed} unassessed)
      </p>
      {settings.mode === 'recent' && summary.n === 0 && (
        <p className="notice">
          No recent shots for these filters. Latest session:{' '}
          {[...data.sessions]
            .filter((s) => !s.archived)
            .map((s) => s.date)
            .sort()
            .at(-1) ?? 'none'}
          .{' '}
          <button
            className="text-button"
            onClick={() => onSettingsChange({ ...settings, mode: 'all' })}
          >
            View all-time
          </button>
        </p>
      )}
      <div className="stat-grid">
        <div className="stat lead">
          <span>Median carry</span>
          <strong>
            {fmt(summary.carry.median)} <em>m</em>
          </strong>
          <small>
            {summary.carry.n} measured · {summary.carry.missing} missing
          </small>
        </div>
        <div className="stat">
          <span>Shots</span>
          <strong>{summary.n}</strong>
          <small>Across {summary.sessions} sessions</small>
        </div>
        <div className="stat">
          <span>Median ball speed</span>
          <strong>
            {fmt(summary.speed.median)} <em>kph</em>
          </strong>
          <small>
            {summary.speed.n} measured · {summary.speed.missing} missing
          </small>
        </div>
        <div className="stat">
          <span>Median apex</span>
          <strong>
            {fmt(summary.apex.median)} <em>m</em>
          </strong>
          <small>
            {summary.apex.n} measured · {summary.apex.missing} missing
          </small>
        </div>
      </div>
      {progressView ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Session by session</span>
              <h2>Carry over time</h2>
            </div>
            <span className="pill">Medians</span>
          </div>
          <p>
            Each session stands alone. Sessions without a recorded time are not
            ordered within a day.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Session</th>
                  <th>Median carry</th>
                  <th>Shots</th>
                </tr>
              </thead>
              <tbody>
                {progress.map(({ session, stats }) => (
                  <tr key={session.id}>
                    <td>{session.date}</td>
                    <td>{session.time ?? 'Unknown'}</td>
                    <td>{session.venue || session.filename}</td>
                    <td>{fmt(stats.carry.median)} m</td>
                    <td>
                      {stats.carry.n}{' '}
                      {stats.carry.n < 5 && (
                        <span className="pill">Sparse</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Club comparison</span>
              <h2>Median carry by club</h2>
            </div>
            <span className="pill">{BASES[basis].label}</span>
          </div>
          {rows.length > 0 ? (
            <div className="gap-list" role="list" aria-label="Median carry by club">
              <div className="gap-head">
                <span>Club</span>
                <span>Typical carry · spread</span>
                <span>Shots</span>
                <span>Median</span>
              </div>
              {rows.map((row) => {
                const low = row.low ?? row.median ?? 0;
                const high = row.high ?? row.median ?? 0;
                return (
                  <div
                    className={`gap-row${row.reliable ? '' : ' low'}`}
                    key={row.name}
                    role="listitem"
                  >
                    <span className="gap-club">{row.name}</span>
                    <div className="gap-carry">
                      <div className="gap-stats">
                        <small>
                          {row.low !== null && row.high !== null
                            ? `Middle 80%: ${row.low.toFixed(0)}–${row.high.toFixed(0)} m`
                            : 'Spread needs 10 shots'}
                        </small>
                      </div>
                      <div className="gap-track" aria-hidden="true">
                        <span
                          className="gap-band"
                          style={{
                            left: `${(low / scale) * 100}%`,
                            width: `${((high - low) / scale) * 100}%`,
                          }}
                        />
                        <span
                          className="gap-dot"
                          style={{ left: `${((row.median ?? 0) / scale) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="gap-n">
                      {row.n}
                      <small>{row.n === 1 ? 'shot' : 'shots'}</small>
                    </span>
                    <span className="gap-value">
                      {fmt(row.median)} m
                      {!row.reliable && <small>few shots</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p>
              No shots match this view yet. Import a session to get started.
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Club</th>
                  <th>Median carry</th>
                  <th>Shots</th>
                  <th>Measured / missing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setClub(r.name)}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td>{fmt(r.median)} m</td>
                    <td>
                      {r.n}{' '}
                      {!r.reliable && (
                        <span className="pill">Sample limited</span>
                      )}
                    </td>
                    <td>
                      {r.n} / {r.missing}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Distribution</span>
            <h2>Shot distribution</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>n / missing</th>
                <th>Mean</th>
                <th>Median</th>
                <th>IQR</th>
                <th>P10–P90</th>
                <th>SD</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Carry (m)', summary.carry],
                  ['Ball speed (kph)', summary.speed],
                  ['Apex (m)', summary.apex],
                  ['Launch (°)', summary.launch],
                ] satisfies [string, typeof summary.carry][]
              ).map(([name, s]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    {s.n} / {s.missing}
                  </td>
                  <td>{fmt(s.mean)}</td>
                  <td>{fmt(s.median)}</td>
                  <td>{fmt(s.iqr)}</td>
                  <td>
                    {fmt(s.p10)}–{fmt(s.p90)}
                  </td>
                  <td>{fmt(s.sd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Ball flight, not a swing diagnosis. Counts are left / straight / right.</p>
        <dl className="direction-list">
          {(
            [
              ['Launch direction', summary.launchDirection],
              ['Curve', summary.curve],
              ['Lateral from centre', summary.lateral],
            ] satisfies [string, typeof summary.lateral][]
          ).map(([name, d]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>
                {d.left} / {d.straight} / {d.right}{' '}
                <small>
                  {d.n} measured · {d.missing} missing
                </small>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {club && (
        <section className="panel">
          <h2>{club} shots</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Source row / shot #</th>
                  <th>Recorded / effective club</th>
                  <th>Carry</th>
                  <th>Intent / contact</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {data.sessions.find((x) => x.id === s.sessionId)?.date}
                    </td>
                    <td>
                      {s.rowIndex} / {s.sourceNumber}
                    </td>
                    <td>
                      {s.recordedClub} / {effectiveClub(s)}
                    </td>
                    <td>{fmt(s.measurements[BASES[basis].carry])}</td>
                    <td>
                      {s.review.intent} / {s.review.contact}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
