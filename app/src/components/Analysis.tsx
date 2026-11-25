import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { resolveShots } from '../domain/assessment';
import {
  BASES,
  clubOrder,
  localToday,
  type Dataset,
} from '../domain/model';
import {
  benchmarkClubGroups,
  metricStats,
  selectCohort,
  summarize,
  type AnalysisSettings,
} from '../domain/analytics';
import { clubStrongStrike } from '../domain/potential';
import { clubRatings } from '../domain/ratings';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';
import { clubHref } from './ClubProfiles';
import { RatingBreakdown, RatingChip } from './ClubRating';
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
  const resolved = useMemo(
    () => resolveShots(data.shots, data.sessions, basis),
    [data.shots, data.sessions, basis],
  );
  const selected = selectCohort(data.shots, data.sessions, query, basis);
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
  // Club rows are club-specific benchmarks: the shared eligibility rule keeps
  // suspected wrong-club labels out of every club figure on this screen.
  const clubGroups = benchmarkClubGroups(selected, resolved);
  const clubs = [...clubGroups.keys()].sort(
    (a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleClub = (name: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  // Reliability (spread band, IQR) and distance potential always come from
  // the broader population, so they stay visible when a performance filter
  // (e.g. Strong-strike) narrows the median (roadmap §6.3, ADR-0002).
  const broaderQuery = {
    ...query,
    contact: 'all',
    hideLikelyMishits: false,
  } as const;
  const broader = selectCohort(data.shots, data.sessions, broaderQuery, basis);
  const broaderGroups = benchmarkClubGroups(broader, resolved);
  const potentialByClub = new Map(
    clubStrongStrike(data, basis, broaderQuery).map((row) => [row.club, row]),
  );
  const rows = clubs.map((name) => {
    const clubShots = clubGroups.get(name) ?? [];
    const broaderShots = broaderGroups.get(name) ?? [];
    const fields = BASES[basis];
    const stats = metricStats(clubShots, fields.carry);
    const broadStats = metricStats(broaderShots, fields.carry);
    return {
      name,
      median: stats.median,
      low: broadStats.p10,
      high: broadStats.p90,
      iqr: broadStats.iqr,
      potential: potentialByClub.get(name) ?? null,
      speed: metricStats(clubShots, fields.speed),
      launch: metricStats(clubShots, fields.launch),
      apex: metricStats(clubShots, fields.apex),
      total: clubShots.length,
      n: stats.n,
      missing: stats.missing,
      reliable: broadStats.n >= 10,
    };
  });
  const scale = Math.max(...rows.map((row) => row.high ?? row.median ?? 0), 1) * 1.1;
  // ADR-0005 ratings: computed once per render on the fixed premium-flat
  // rating basis — independent of the display basis selected above.
  const ratingsByClub = new Map(clubRatings(data, query).map((r) => [r.club, r]));
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
              <PerformanceToggle
                settings={settings}
                onChange={onSettingsChange}
              />
              {settings.contact !== 'strong' && (
                <MishitToggle settings={settings} onChange={onSettingsChange} />
              )}
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
                <span>
                  {settings.contact === 'strong'
                    ? 'Strong-strike median · broader spread'
                    : settings.contact === 'typical'
                      ? 'Typical carry · spread'
                      : 'Median carry · spread'}
                </span>
                <span>Rating</span>
                <span>Shots</span>
                <span>Median</span>
              </div>
              {rows.map((row) => {
                const low = row.low ?? row.median ?? 0;
                const high = row.high ?? row.median ?? 0;
                const open = expanded.has(row.name);
                const rating = ratingsByClub.get(row.name) ?? null;
                const detailId = `club-detail-${row.name.replace(/\W+/g, '-')}`;
                return (
                  <div className="gap-item" key={row.name} role="listitem">
                    <div className={`gap-row${row.reliable ? '' : ' low'}`}>
                      <span className="gap-club">
                        <a href={clubHref(row.name)}>{row.name}</a>
                        <button
                          type="button"
                          className="expand-toggle"
                          aria-expanded={open}
                          aria-controls={detailId}
                          aria-label={`${open ? 'Hide' : 'Show'} details for ${row.name}`}
                          onClick={() => toggleClub(row.name)}
                        >
                          <ChevronDown
                            size={13}
                            className={open ? 'open' : ''}
                            aria-hidden="true"
                          />
                          Details
                        </button>
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
                      <span className="gap-rating">
                        <RatingChip rating={ratingsByClub.get(row.name) ?? null} />
                      </span>
                      <span className="gap-n">
                        {row.n}
                        <small>{row.n === 1 ? 'shot' : 'shots'}</small>
                      </span>
                      <span className="gap-value">
                        {row.median === null ? '—' : `${row.median.toFixed(0)} m`}
                        {!row.reliable && <small>few shots</small>}
                      </span>
                    </div>
                    {open && (
                      <div className="gap-detail" id={detailId}>
                        {rating && <RatingBreakdown rating={rating} />}
                        <div className="detail-grid">
                          <div className="detail-stat">
                            <span className="detail-label">Ball speed</span>
                            <span className="detail-value">
                              {row.speed.median === null
                                ? '—'
                                : `${row.speed.median.toFixed(0)} kph`}
                            </span>
                            <span className="detail-sub">
                              {row.speed.n} of {row.total} measured
                            </span>
                          </div>
                          <div className="detail-stat">
                            <span className="detail-label">Launch</span>
                            <span className="detail-value">
                              {row.launch.median === null
                                ? '—'
                                : `${row.launch.median.toFixed(1)}°`}
                            </span>
                            <span className="detail-sub">
                              {row.launch.n} of {row.total} measured
                            </span>
                          </div>
                          <div className="detail-stat">
                            <span className="detail-label">Apex</span>
                            <span className="detail-value">
                              {row.apex.median === null
                                ? '—'
                                : `${row.apex.median.toFixed(0)} m`}
                            </span>
                            <span className="detail-sub">
                              {row.apex.n} of {row.total} measured
                            </span>
                          </div>
                          <div className="detail-stat">
                            <span className="detail-label">
                              Strong-strike carry (P80)
                            </span>
                            <span className="detail-value">
                              {row.potential?.potential === null ||
                              row.potential === null
                                ? '—'
                                : `${row.potential.potential.toFixed(0)} m`}
                            </span>
                            <span className="detail-sub">
                              {row.potential && !row.potential.reliable && (
                                <span className="pill">Sample limited</span>
                              )}
                              {row.potential &&
                                `${row.potential.n} measured full swings`}
                            </span>
                          </div>
                          <div className="detail-stat">
                            <span className="detail-label">Carry spread (IQR)</span>
                            <span className="detail-value">
                              {row.iqr === null ? '—' : `${row.iqr.toFixed(0)} m`}
                            </span>
                            <span className="detail-sub">
                              {!row.reliable && (
                                <span className="pill">Sample limited</span>
                              )}
                              {row.reliable && `${row.n} of ${row.total} shots measured`}
                            </span>
                          </div>
                        </div>
                        <a className="text-button" href={clubHref(row.name)}>
                          Full club profile →
                        </a>
                      </div>
                    )}
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
