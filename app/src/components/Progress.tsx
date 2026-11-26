import { useMemo } from 'react';
import { clubProgress, summarizeClubMetric } from '../domain/progress';
import type { AnalysisSettings } from '../domain/analytics';
import { localToday, type Dataset } from '../domain/model';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';
import { PerformanceTrendCard } from './PerformanceTrendCard';
import { clubDisplayName } from './clubNames';
import {
  Card,
  Disclosure,
  EmptyState,
  HelpPopover,
  SectionHeader,
} from './ds';

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const fmt = (n: number | null) => (n === null ? '—' : decimal.format(n));

/**
 * The Progress page: one interactive PerformanceTrendCard (club selector,
 * metric selector, headline + change, tappable chart) instead of a stacked
 * per-club chart pair, plus a concise cross-club carry comparison and the
 * detailed per-club session tables behind disclosures. All figures come from
 * the shared `clubProgress` domain function on the selected cohort and basis.
 */
export function Progress({
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
  const groups = useMemo(
    () => clubProgress(data, basis, query),
    [data, basis, query],
  );
  // Concise cross-club comparison on compatible session measurements: each
  // club's median carry in its first vs latest measured session of the window.
  const crossClub = useMemo(() => {
    const rows = summarizeClubMetric(groups, 'median').filter(
      (row) => row.delta !== null,
    );
    return rows.sort(
      (a, b) => (b.delta ?? 0) - (a.delta ?? 0) || a.club.localeCompare(b.club),
    );
  }, [groups]);
  const notCompared = groups.length - crossClub.length;

  return (
    <>
      <Card className="progress-head">
        <SectionHeader
          title="Session by session"
          sub={cohort}
          aside={
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
                onChange={(mode) =>
                  onSettingsChange({ ...settings, mode })
                }
              />
              <BasisButton
                basis={basis}
                onChange={(next) =>
                  onSettingsChange({ ...settings, basis: next })
                }
              />
            </div>
          }
        />
      </Card>
      {groups.length === 0 ? (
        <Card>
          <EmptyState title="No club sessions match these filters">
            Import a session or widen the window to start exploring.
          </EmptyState>
        </Card>
      ) : (
        <>
          <PerformanceTrendCard data={data} settings={settings} groups={groups} />
          <Card className="cross-club">
            <SectionHeader
              title="Carry trend across clubs"
              sub="Median carry: first vs latest measured session in this window"
              aside={
                <HelpPopover label="How this comparison works">
                  <p>
                    Each club compares its own first and latest measured sessions on the
                    selected basis — the same compatible session measurements as the
                    chart above (median carry per session).
                  </p>
                  <p>
                    This is a descriptive comparison, not a test: differences between
                    isolated sessions do not by themselves prove long-term improvement.
                  </p>
                </HelpPopover>
              }
            />
            {crossClub.length > 0 ? (
              <ul className="cross-club-list" aria-label="Carry trend by club">
                {crossClub.map((row) => {
                  const delta = row.delta ?? 0;
                  const tone =
                    delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'neutral';
                  return (
                    <li key={row.club}>
                      <span className="club-badge" aria-hidden="true">
                        {row.club.toUpperCase()}
                      </span>
                      <span className="cross-club-name">
                        {clubDisplayName(row.club)}
                      </span>
                      <span className="cross-club-values">
                        {fmt(row.first?.value ?? null)} m →{' '}
                        {fmt(row.latest?.value ?? null)} m
                      </span>
                      <span className={`ds-metric-delta ${tone}`}>
                        {delta >= 0 ? '+' : '−'}
                        {Math.abs(delta).toFixed(1)} m
                      </span>
                      <span className="cross-club-sessions muted">
                        {row.measured} of {row.sessions}{' '}
                        {row.sessions === 1 ? 'session' : 'sessions'} measured
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="context">
                No club has two measured sessions in this window yet.
              </p>
            )}
            <p className="context">
              Sorted by change in median carry, largest first
              {notCompared > 0
                ? ` · ${notCompared} ${notCompared === 1 ? 'club has' : 'clubs have'} fewer than two measured sessions and ${notCompared === 1 ? 'is' : 'are'} not compared`
                : ''}
              . Session differences alone do not prove long-term improvement.
            </p>
          </Card>
          <Card className="session-tables">
            <SectionHeader
              title="Session tables"
              sub={`${groups.length} ${groups.length === 1 ? 'club' : 'clubs'} · S1, S2… match the chart labels`}
            />
            <p className="context">
              Fewer than 10 measured shots: sample limited. Spread (IQR) needs at least
              4 measured shots; missing values stay blank, never zero.
            </p>
            {groups.map(({ club, sessions: points }) => (
              <Disclosure
                key={club}
                summary={`${clubDisplayName(club)} session details (${points.length})`}
              >
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
                      {points.map((point, index) => (
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
              </Disclosure>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
