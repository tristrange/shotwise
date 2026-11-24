import { useEffect, useRef } from 'react';
import { clubGaps, type AnalysisSettings } from '../domain/analytics';
import { localToday, type Dataset } from '../domain/model';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';
import { clubHref } from './ClubProfiles';
import { PracticeInsights } from './PracticeInsights';
import { WedgePractice } from './WedgePractice';

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
  const scale = Math.max(...rows.map((row) => row.high ?? row.median), 1) * 1.1;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, []);

  return (
    <>
      <div className="section-heading">
        <h1 id="gapping" tabIndex={-1} ref={heading}>
          Club gapping
        </h1>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Carry by club</span>
            <h2>Typical carry and the gap to the next club</h2>
          </div>
          <div className="card-controls">
            <PerformanceToggle settings={settings} onChange={onSettingsChange} />
            {settings.contact !== 'strong' && (
              <MishitToggle settings={settings} onChange={onSettingsChange} />
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
        <p>
          Unreviewed non-wedge shots can count, and so can unreviewed
          pitching-wedge shots. Other wedges need explicit full intent.
          Partial and mishit shots are excluded. The dot is median carry
          and the bar is the middle 80%. Grey rows have fewer than ten shots. A
          negative gap means this club carried farther than the one above. Gap
          recommendations use medians from comparable visits on multiple dates.
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
                    <span className="gap-club">
                      <a href={clubHref(row.club)}>{row.club}</a>
                    </span>
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
                      {row.flag === 'small' && <small>small median gap</small>}
                      {row.flag === 'reversed' && (
                        <small>medians reversed</small>
                      )}
                      {row.flag === 'large' && <small>large gap</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      <WedgePractice data={data} basis={basis} query={query} />
      <PracticeInsights data={data} settings={settings} />
    </>
  );
}
