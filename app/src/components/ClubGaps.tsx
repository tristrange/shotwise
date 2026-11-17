import {
  clubGaps,
  practiceInsights,
  type AnalysisSettings,
} from '../domain/analytics';
import { BASES, localToday, type Dataset } from '../domain/model';
import { AnalysisControls } from './AnalysisControls';

export function ClubGaps({
  data,
  settings,
  onSettingsChange,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
}) {
  const { basis, ...filters } = settings;
  const query = { ...filters, today: localToday() };
  const rows = clubGaps(data, basis, query);
  const insights = practiceInsights(data, basis, query);
  const scale = Math.max(...rows.map((row) => row.high ?? row.median), 1) * 1.1;

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Your bag</span>
          <h1>Club gapping</h1>
          <p>
            See where your clubs leave a hole and where they overlap, so you
            know what to spend practice time on.
          </p>
        </div>
      </div>
      <AnalysisControls settings={settings} onChange={onSettingsChange} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Carry by club</span>
            <h2>Typical carry and the gap to the next club</h2>
          </div>
          <span className="pill">{BASES[basis].label}</span>
        </div>
        <p>
          Within the selected filters, shots need a readable club and carry.
          Unreviewed shots are included unless you choose a review filter. Shots
          marked partial or mishit are always left out of gapping and insights.
          The dot is the median carry; the bar is the middle 80%. Fewer than ten
          shots is shown in grey and not flagged. Gaps compare medians with the
          club above; a negative gap means this club carried farther.
        </p>
        {rows.length === 0 ? (
          <p>
            No comparable shots for these filters. Shots need a readable club
            and carry, and must not be marked partial or mishit.
          </p>
        ) : (
          <div className="gap-list">
            <div className="gap-head">
              <span>Club</span>
              <span>Typical carry · spread</span>
              <span>Shots</span>
              <span>Gap</span>
            </div>
            <div role="list" aria-label="Club carry distances">
              {rows.map((row) => {
                const low = row.low ?? row.median;
                const high = row.high ?? row.median;
                return (
                  <div
                    className={`gap-row${row.reliable ? '' : ' low'}`}
                    key={row.club}
                    role="listitem"
                  >
                    <span className="gap-club">{row.club}</span>
                    <div className="gap-carry">
                      <div className="gap-stats">
                        <strong>Median {row.median.toFixed(0)} m</strong>
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
                    </div>
                    <span className="gap-n">
                      {row.n}
                      <small>{row.n === 1 ? 'shot' : 'shots'}</small>
                    </span>
                    <span
                      className={`gap-value${row.flag === 'large' ? ' big' : ''}`}
                    >
                      {row.gap === null ? '—' : `Gap: ${row.gap.toFixed(0)} m`}
                      {row.flag === 'overlap' && <small>bands overlap</small>}
                      {row.flag === 'large' && <small>large gap</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Where to spend time</span>
            <h2>Practice insights</h2>
          </div>
        </div>
        {insights.length === 0 ? (
          <p>No clear patterns yet. Keep logging shots and check back later.</p>
        ) : (
          <div className="insight-list">
            {insights.map((insight) => (
              <div className="insight" key={insight.id}>
                <p>{insight.text}</p>
                <span>
                  {insight.rule} · {insight.shots} shots
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
