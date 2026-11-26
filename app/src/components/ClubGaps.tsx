import { useEffect, useMemo, useRef } from 'react';
import { GAP_THRESHOLDS, type AnalysisSettings } from '../domain/analytics';
import { BASES, localToday, type Dataset } from '../domain/model';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';
import { AdjacentGaps } from './AdjacentGaps';
import { GappingChart } from './GappingChart';
import { gappingView } from './gappingData';
import { PracticeInsights } from './PracticeInsights';
import { WedgePractice } from './WedgePractice';
import { Card, EmptyState, HelpPopover, SectionHeader } from './ds';

/**
 * The Gapping page (D9): compact analysis controls up top, then one unified
 * shared-scale chart of club distances with selectable views (distribution /
 * potential / simple), the concise adjacent-club gap comparison, wedge
 * practice graphics, and practice insights. Detailed measurements and
 * methodology live behind contextual help and disclosures; all figures come
 * from the tested domain functions via `gappingView` / `wedgePractice`.
 */
export function ClubGaps({
  data,
  settings,
  onSettingsChange,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
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
  const view = useMemo(() => gappingView(data, basis, query), [data, basis, query]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, []);

  const cohort =
    settings.contact === 'strong'
      ? 'Strong-strike'
      : settings.contact === 'typical'
        ? 'Typical'
        : 'All shots';

  return (
    <>
      <div className="section-heading">
        <h1 id="gapping" tabIndex={-1} ref={heading}>
          Club gapping
        </h1>
      </div>
      <Card className="gapping-head">
        <SectionHeader
          title="Carry by club"
          sub={`${settings.mode === 'recent' ? 'Recent' : 'All-time'} · ${BASES[basis].label} · ${cohort}${settings.hideLikelyMishits && settings.contact !== 'strong' ? ' · likely mishits hidden' : ''}`}
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
                onChange={(mode) => onSettingsChange({ ...settings, mode })}
              />
              <BasisButton
                basis={basis}
                onChange={(next) =>
                  onSettingsChange({ ...settings, basis: next })
                }
              />
              <HelpPopover label="How gapping is calculated">
                <p>
                  Unreviewed non-wedge shots can count, and so can unreviewed
                  pitching-wedge shots. Other wedges need explicit full intent.
                  Partial and mishit shots are excluded.
                </p>
                <p>
                  Each club's band is the middle 80% of measured carries from
                  the broader all-shots cohort; the line is the selected
                  cohort's median. Fewer than {GAP_THRESHOLDS.minSamples} shots
                  is sample-limited and the spread is not shown. The dashed
                  marker is the strong-strike potential (P80), which needs{' '}
                  {GAP_THRESHOLDS.minSamples}+ measured carries.
                </p>
                <p>
                  A negative adjacent gap means this club carried farther than
                  the one above. Gap flags use medians from comparable visits on
                  multiple dates and the approved thresholds — overlap alone
                  never triggers a recommendation.
                </p>
              </HelpPopover>
            </div>
          }
        />
      </Card>
      {view.rows.length === 0 ? (
        <Card>
          <EmptyState title="No comparable shots for these filters.">
            Shots need a readable club and carry, and must not be marked
            partial or mishit.
          </EmptyState>
        </Card>
      ) : (
        <>
          <GappingChart view={view} basis={basis} settings={settings} />
          <AdjacentGaps rows={view.rows} />
        </>
      )}
      <WedgePractice data={data} basis={basis} query={query} />
      <PracticeInsights data={data} settings={settings} />
    </>
  );
}
