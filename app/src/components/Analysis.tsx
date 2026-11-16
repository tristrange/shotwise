import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BASES,
  effectiveClub,
  localToday,
  type Basis,
  type Dataset,
  type Review,
} from '../domain/model';
import { reviewCoverage, selectCohort, summarize } from '../domain/analytics';

const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(1));
export function Analysis({
  data,
  initialMode = 'recent',
}: {
  data: Dataset;
  initialMode?: 'recent' | 'progress' | 'all';
}) {
  const [mode, setMode] = useState(initialMode);
  const [basis, setBasis] = useState<Basis>('premium-flat');
  const [intent, setIntent] = useState<Review['intent'] | 'all'>('all');
  const [contact, setContact] = useState<'all' | 'typical'>('all');
  const [club, setClub] = useState('');
  const query = { mode, today: localToday(), intent, contact };
  const selected = selectCohort(data.shots, data.sessions, query);
  const clubs = [...new Set(selected.map(effectiveClub))].sort();
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
    .map((name) => ({
      name,
      carry: summarize(
        selected.filter((s) => effectiveClub(s) === name),
        basis,
      ).carry.median,
      n: selected.filter((s) => effectiveClub(s) === name).length,
      measured: summarize(
        selected.filter((s) => effectiveClub(s) === name),
        basis,
      ).carry.n,
      missing: summarize(
        selected.filter((s) => effectiveClub(s) === name),
        basis,
      ).carry.missing,
    }));
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
          <span className="eyebrow">YOUR GAME, IN CONTEXT</span>
          <h1>{initialMode === 'progress' ? 'Progress' : 'Your overview'}</h1>
          <p>
            Understand the shots you have, with the context to read them
            clearly.
          </p>
        </div>
      </div>
      <div className="filters panel">
        <label>
          View
          <select
            value={mode}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'recent' || v === 'progress' || v === 'all') setMode(v);
            }}
          >
            <option value="recent">Recent</option>
            <option value="progress">Progress</option>
            <option value="all">All-time</option>
          </select>
        </label>
        <label>
          Measurement basis
          <select
            value={basis}
            onChange={(e) => {
              const v = e.target.value;
              if (
                v === 'premium-flat' ||
                v === 'range-flat' ||
                v === 'premium' ||
                v === 'range'
              )
                setBasis(v);
            }}
          >
            {Object.entries(BASES).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Intent
          <select
            value={intent}
            onChange={(e) => {
              const v = e.target.value;
              if (
                v === 'all' ||
                v === 'full' ||
                v === 'partial' ||
                v === 'unknown'
              )
                setIntent(v);
            }}
          >
            <option value="all">All intent</option>
            <option value="full">Full</option>
            <option value="partial">Partial</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          Contact
          <select
            value={contact}
            onChange={(e) =>
              setContact(e.target.value === 'typical' ? 'typical' : 'all')
            }
          >
            <option value="all">All contact</option>
            <option value="typical">Reviewed typical</option>
          </select>
        </label>
        <label>
          Club
          <select value={club} onChange={(e) => setClub(e.target.value)}>
            <option value="">All clubs</option>
            {clubs.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="context">
        {summary.n} shots · {summary.sessions} sessions ·{' '}
        {dates.length ? `${dates[0]} to ${dates.at(-1)}` : 'No dates'} · Contact
        reviewed {coverage.reviewed}/{coverage.total} · Full-swing mishits{' '}
        {coverage.mishits}/{coverage.fullReviewed} reviewed (
        {coverage.unassessed} unassessed)
      </p>
      {mode === 'recent' && (
        <p className="notice">
          Recent includes up to the latest 50 shots per club in the last 60
          days, keeping the full cutoff date.{' '}
          {summary.n === 0 && (
            <>
              No recent shots for these filters. Latest session:{' '}
              {[...data.sessions]
                .filter((s) => !s.archived)
                .map((s) => s.date)
                .sort()
                .at(-1) ?? 'none'}
              .{' '}
              <button className="text-button" onClick={() => setMode('all')}>
                View all-time
              </button>
            </>
          )}
        </p>
      )}
      <div className="stat-grid">
        <div className="stat">
          <span>SHOTS</span>
          <strong>{summary.n}</strong>
          <small>Across {summary.sessions} sessions</small>
        </div>
        <div className="stat">
          <span>MEDIAN CARRY</span>
          <strong>
            {fmt(summary.carry.median)} <em>m</em>
          </strong>
          <small>
            {summary.carry.n} measured · {summary.carry.missing} missing
          </small>
        </div>
        <div className="stat">
          <span>MEDIAN BALL SPEED</span>
          <strong>
            {fmt(summary.speed.median)} <em>kph</em>
          </strong>
          <small>
            {summary.speed.n} measured · {summary.speed.missing} missing
          </small>
        </div>
        <div className="stat">
          <span>MEDIAN APEX</span>
          <strong>
            {fmt(summary.apex.median)} <em>m</em>
          </strong>
          <small>
            {summary.apex.n} measured · {summary.apex.missing} missing
          </small>
        </div>
      </div>
      {mode === 'progress' ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SESSION BY SESSION</span>
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
              <span className="eyebrow">CLUB COMPARISON</span>
              <h2>Median carry by club</h2>
            </div>
            <span className="pill">{BASES[basis].label}</span>
          </div>
          {rows.length > 0 ? (
            <div
              className="chart"
              role="img"
              aria-label="Median carry by club. Values are available in the table below."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rows}
                  margin={{ top: 15, right: 20, bottom: 0, left: -15 }}
                >
                  <CartesianGrid vertical={false} stroke="#e6e9df" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar
                    isAnimationActive={false}
                    dataKey="carry"
                    name="Median carry (m)"
                    fill="#315a43"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
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
                    <td>{fmt(r.carry)} m</td>
                    <td>
                      {r.n}{' '}
                      {r.measured < 10 && (
                        <span className="pill">Sample limited</span>
                      )}
                    </td>
                    <td>
                      {r.measured} / {r.missing}
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
            <span className="eyebrow">THE DETAILS</span>
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
        <p>
          Direction:{' '}
          {(
            [
              ['Launch', summary.launchDirection],
              ['Curve', summary.curve],
              ['Lateral from centre (measured)', summary.lateral],
            ] satisfies [string, typeof summary.lateral][]
          )
            .map(
              ([name, d]) =>
                `${name}: ${d.left}/${d.n}, ${d.straight}/${d.n}, ${d.right}/${d.n} left/straight/right (n=${d.n}, ${d.missing} missing)`,
            )
            .join(' · ')}
          . These describe ball flight, not a swing diagnosis.
        </p>
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
