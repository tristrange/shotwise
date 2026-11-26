import { useMemo } from 'react';
import { BASES, clubOrder, localToday, type Dataset } from '../domain/model';
import {
  selectCohort,
  summarize,
  type AnalysisSettings,
} from '../domain/analytics';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';
import { clubHref } from './ClubProfiles';
import { clubCardRows } from './clubCardData';
import { ClubCard } from './ClubCard';
import { PerformanceTrendCard } from './PerformanceTrendCard';
import { Hero } from './Hero';
import { PracticeInsights } from './PracticeInsights';
import { Progress } from './Progress';
import { Disclosure, EmptyState, Metric } from './ds';
import { sharedBandScale } from './charts';

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
  const { basis } = settings;
  const query = useMemo(
    () => ({
      mode: settings.mode,
      intent: settings.intent,
      contact: settings.contact,
      hideLikelyMishits: settings.hideLikelyMishits,
      today: localToday(),
    }),
    [settings],
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
  const dateRange = dates.length ? `${dates[0]} → ${dates.at(-1)}` : 'No dates';
  const cohort = `${summary.n} shots · ${summary.sessions} sessions · ${dateRange}`;
  // Club cards: every figure comes from the shared domain cohort functions via
  // clubCardRows; ratings stay on the fixed premium-flat rating basis. Skipped
  // entirely on the Progress route, which never renders the card list.
  const cardRows = useMemo(
    () => (progressView ? [] : clubCardRows(data, basis, settings)),
    [progressView, data, basis, settings],
  );
  // One shared scale for every club's distribution band, so the plots are
  // comparable across clubs instead of each zooming to its own range.
  const bandScale = useMemo(
    () => sharedBandScale(cardRows.map((row) => row.band)),
    [cardRows],
  );
  const clubs = [...new Set(cardRows.map((r) => r.club))].sort(
    (a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b),
  );
  // The collapsed line names the selected cohort's statistic explicitly, so a
  // strong-strike median is never read as typical carry.
  const carryLabel =
    settings.contact === 'strong'
      ? 'strong-strike median'
      : settings.contact === 'typical'
        ? 'typical carry'
        : 'carry';
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
            dateRange={dateRange}
            compact
          />
          <div className="overview-metrics reveal" data-reveal>
            <Metric label="Shots in view" value={summary.n} />
            <Metric label="Sessions" value={summary.sessions} />
            <Metric label="Clubs" value={clubs.length} />
            <Metric label="Date range" value={dateRange} small />
          </div>
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
        <Progress
          data={data}
          settings={settings}
          onSettingsChange={onSettingsChange}
          cohort={cohort}
        />
      ) : (
        <>
          <section className="panel" aria-label="Club performance">
            <div className="ds-section-header">
              <div>
                <h2>Your clubs</h2>
                <div className="ds-section-sub context">{cohort}</div>
              </div>
              <div className="card-controls">
                <PerformanceToggle
                  settings={settings}
                  onChange={onSettingsChange}
                />
                {settings.contact !== 'strong' && (
                  <MishitToggle
                    settings={settings}
                    onChange={onSettingsChange}
                  />
                )}
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
            {cardRows.length > 0 ? (
              <div
                className="club-card-list"
                role="list"
                aria-label="Your clubs"
              >
                {cardRows.map((row) => (
                  <div role="listitem" key={row.club}>
                    <ClubCard
                      data={row}
                      href={clubHref(row.club)}
                      basisLabel={BASES[basis].label}
                      carryLabel={carryLabel}
                      scaleMin={bandScale.min}
                      scaleMax={bandScale.max}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No shots match this view yet">
                Import a session to get started.
              </EmptyState>
            )}
          </section>
          {cardRows.length > 0 && (
            <section aria-label="Performance trend" className="panel">
              <PerformanceTrendCard data={data} settings={settings} />
            </section>
          )}
        </>
      )}
      {/* Aggregate distribution renders on both Overview and Progress, as before. */}
      <section className="panel">
        <div className="ds-section-header">
          <div>
            <h2>Session distribution</h2>
            <div className="ds-section-sub context">{cohort}</div>
          </div>
        </div>
        <Disclosure summary="Distribution details (mean, median, IQR, P10–P90, SD)">
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
                  <th>Measured / missing</th>
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
                    {/* Counts are shares of MEASURED shots; with no measurements
                            the row shows missing, never a misleading 0/0/0. */}
                    <td>{d.n === 0 ? '—' : d.left}</td>
                    <td>{d.n === 0 ? '—' : d.straight}</td>
                    <td>{d.n === 0 ? '—' : d.right}</td>
                    <td>
                      {d.n} / {d.missing}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </section>
    </>
  );
}
