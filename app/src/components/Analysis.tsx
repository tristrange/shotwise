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
  selectCohort,
  summarize,
  type AnalysisSettings,
} from '../domain/analytics';
import { BasisButton, MishitToggle, ViewToggle } from './AnalysisControls';
import { clubHref } from './ClubProfiles';
import { ClubProgress } from './ClubProgress';
import { Hero } from './Hero';
import { PracticeInsights } from './PracticeInsights';

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
  const query = { ...filters, today: localToday() };
  const selected = selectCohort(data.shots, data.sessions, query);
  const sessionDates = new Map(data.sessions.map((s) => [s.id, s.date]));
  const shots = selected.toSorted(
    (a, b) =>
      (sessionDates.get(b.sessionId) ?? '').localeCompare(
        sessionDates.get(a.sessionId) ?? '',
      ) ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.rowIndex - b.rowIndex,
  );
  const summary = summarize(shots, basis);
  const dates = data.sessions
    .filter((s) => shots.some((x) => x.sessionId === s.id))
    .map((s) => s.date)
    .sort();
  const cohort = `${summary.n} shots · ${summary.sessions} sessions · ${
    dates.length ? `${dates[0]} to ${dates.at(-1)}` : 'No dates'
  }`;
  const clubs = [...new Set(selected.map(effectiveClub))]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b));
  const rows = clubs.map((name) => {
    const clubShots = selected.filter((s) => effectiveClub(s) === name);
    const stats = metricStats(clubShots, BASES[basis].carry);
    return {
      name,
      median: stats.median,
      low: stats.p10,
      high: stats.p90,
      total: clubShots.length,
      n: stats.n,
      missing: stats.missing,
      reliable: stats.n >= 10,
    };
  });
  const scale = Math.max(...rows.map((row) => row.high ?? row.median ?? 0), 1) * 1.1;
  return (
    <>
      {progressView ? (
        <div className="section-heading">
          <h1>Progress</h1>
        </div>
      ) : (
        <>
          <h1 className="sr-only">Overview</h1>
          <Hero
            shots={summary.n}
            sessions={summary.sessions}
            clubs={clubs.length}
            dateRange={dates.length ? `${dates[0]} → ${dates.at(-1)}` : 'No dates'}
          />
          <PracticeInsights data={data} settings={settings} overview />
        </>
      )}
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
      {progressView ? (
        <ClubProgress
          data={data}
          settings={settings}
          onSettingsChange={onSettingsChange}
          cohort={cohort}
        />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Club comparison</span>
              <h2>Median carry by club</h2>
              <p className="context">{cohort}</p>
            </div>
            <div className="card-controls">
              <MishitToggle settings={settings} onChange={onSettingsChange} />
              <ViewToggle
                mode={settings.mode}
                onChange={(mode) => onSettingsChange({ ...settings, mode })}
              />
              <BasisButton
                basis={basis}
                onChange={(next) => onSettingsChange({ ...settings, basis: next })}
              />
            </div>
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
                    <span className="gap-club">
                      <a href={clubHref(row.name)}>{row.name}</a>
                    </span>
                    <div className="gap-carry">
                      {row.median === null ? (
                        <div className="gap-stats">
                          <small>No carry recorded on this basis</small>
                        </div>
                      ) : (
                        <>
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
                              style={{ left: `${(row.median / scale) * 100}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <span className="gap-n">
                      {row.n}
                      <small>{row.n === 1 ? 'shot' : 'shots'}</small>
                    </span>
                    <span className="gap-value">
                      {row.median === null ? '—' : `${row.median.toFixed(0)} m`}
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
                      <a href={clubHref(r.name)}>{r.name}</a>
                    </td>
                    <td>{fmt(r.median)} m</td>
                    <td>
                      {r.total}{' '}
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
                <th>n</th>
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
                  <td>{s.n}</td>
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Left</th>
                <th>Straight</th>
                <th>Right</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Launch direction', summary.launchDirection],
                  ['Curve', summary.curve],
                  ['Lateral from centre', summary.lateral],
                ] satisfies [string, typeof summary.lateral][]
              ).map(([name, d]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{d.left}</td>
                  <td>{d.straight}</td>
                  <td>{d.right}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
