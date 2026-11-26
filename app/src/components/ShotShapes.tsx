import { useMemo, useState } from 'react';
import { shotShapes } from '../domain/shotShapes';
import { resolvedClub, resolveShots } from '../domain/assessment';
import { BASES, clubOrder, localToday, type Dataset } from '../domain/model';
import type { AnalysisSettings } from '../domain/analytics';
import { BasisButton, MishitToggle, ViewToggle } from './AnalysisControls';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  HelpPopover,
  SectionHeader,
  SegmentedControl,
  Select,
} from './ds';
import type { SegmentedOption } from './ds';
import { PerformanceScatterPlot } from './charts';

const direction = (value: number | null, unit: string) =>
  value === null
    ? 'Missing'
    : `${Math.abs(value).toFixed(1)}${unit} ${value < 0 ? 'left' : value > 0 ? 'right' : 'straight'}`;

/** Shape and Explorer share the Shot shape destination; existing #shape links stay valid. */
export function ShapeViewTabs({ view }: { view: 'shape' | 'explorer' }) {
  const options: readonly SegmentedOption<'shape' | 'explorer'>[] = [
    { value: 'shape', label: 'Shape' },
    { value: 'explorer', label: 'Explorer' },
  ];
  return (
    <div className="view-tabs">
      <SegmentedControl
        label="Shot shape views"
        options={options}
        value={view}
        onChange={(next) => {
          window.location.hash =
            next === 'explorer' ? 'shape/explorer' : 'shape';
        }}
      />
    </div>
  );
}

/** Symmetric launch-direction / curve limits so zero sits at the plot centre. */
function axisLimit(values: number[]): number {
  return Math.max(
    1,
    Math.ceil(Math.max(0, ...values.map((value) => Math.abs(value)))),
  );
}

export function ShotShapes({
  data,
  settings,
  onSettingsChange,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
}) {
  const { basis, ...filters } = settings;
  const { shots, points } = shotShapes(
    data,
    {
      ...filters,
      today: localToday(),
    },
    basis,
  );
  const resolved = useMemo(
    () => resolveShots(data.shots, data.sessions, basis),
    [data.shots, data.sessions, basis],
  );
  const clubOf = (shot: (typeof shots)[number]) => {
    const r = resolved.get(shot.id);
    return r ? resolvedClub(r) : '';
  };
  const clubs = [...new Set(shots.map(clubOf))].sort(
    (a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b),
  );
  const [clubChoice, setClubChoice] = useState('');
  const club = clubs.includes(clubChoice) ? clubChoice : (clubs[0] ?? '');
  const [selected, setSelected] = useState('');
  const sessionNames = new Map(
    data.sessions.map((s) => [s.id, `${s.date} · ${s.venue || s.filename}`]),
  );
  const group = club ? shots.filter((s) => clubOf(s) === club) : [];
  const paired = club ? points.filter((p) => clubOf(p.shot) === club) : [];
  const inspected = group.find((s) => s.id === selected);
  const carry = inspected?.measurements[BASES[basis].carry];
  const xLimit = axisLimit(paired.map((p) => p.launchDirection));
  const yLimit = axisLimit(paired.map((p) => p.curve));
  const plotPoints = paired.map(({ shot, launchDirection, curve }) => ({
    id: shot.id,
    x: launchDirection,
    y: curve,
    label: `Plot ${club} row ${shot.rowIndex} · ${sessionNames.get(shot.sessionId)} · launch ${direction(launchDirection, '°')} · curve ${direction(curve, ' m')}`,
    title: `Row ${shot.rowIndex}: launch ${direction(launchDirection, '°')}, curve ${direction(curve, ' m')}`,
  }));
  return (
    <>
      <div className="section-heading">
        <h1>Shot shape</h1>
      </div>
      <ShapeViewTabs view="shape" />
      <Card className="shape-card">
        <SectionHeader
          title="Start direction and curve"
          aside={
            <div className="card-controls">
              <MishitToggle settings={settings} onChange={onSettingsChange} />
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
              <HelpPopover label="How to read this plot">
                <p>
                  Across: where the ball started (left or right). Up/down: how
                  it curved (right or left). Curve is the maximum bend away from
                  the straight launch-to-landing line. This is not a
                  landing-position plot or a swing diagnosis.
                </p>
                <p>
                  Launch direction and From Centre follow the recorded aim line.
                  Direction and curve stay as recorded; the selected measurement
                  basis applies to carry values below. Select a point or use its
                  shot table to inspect the measurements.
                </p>
              </HelpPopover>
            </div>
          }
        />
        <p className="context">
          {shots.length} shots · {points.length} paired measurements
        </p>
        {!clubs.length && (
          <EmptyState title="No shots match this view">
            Try All-time or import a session.
          </EmptyState>
        )}
        {clubs.length > 0 && club && (
          <>
            <div className="shape-controls">
              <Select
                label="Club"
                value={club}
                onChange={setClubChoice}
                options={clubs.map((name) => ({ value: name, label: name }))}
              />
            </div>
            <p className="shape-coverage">
              {paired.length} of {group.length} shots have both measurements;{' '}
              {group.length - paired.length} are absent from the plot.
            </p>
            {paired.length ? (
              <PerformanceScatterPlot
                label={`${club} recorded shot shapes`}
                caption={`Basis ${BASES[basis].label}`}
                xLabel="Launch direction (°)"
                yLabel="Curve (m)"
                xTicks={[
                  { value: -xLimit, text: `${xLimit}° L` },
                  { value: 0, text: '0°' },
                  { value: xLimit, text: `${xLimit}° R` },
                ]}
                yTicks={[
                  { value: yLimit, text: `${yLimit} m R` },
                  { value: 0, text: '0' },
                  { value: -yLimit, text: `${yLimit} m L` },
                ]}
                xDomain={[-xLimit, xLimit]}
                yDomain={[-yLimit, yLimit]}
                zeroLines
                points={plotPoints}
                selectedId={selected}
                onSelect={setSelected}
              />
            ) : (
              <p className="notice">
                No paired launch-direction and curve measurements for this club.
              </p>
            )}
            <div
              className="shape-detail"
              role="region"
              aria-label={`Selected shot measurements for ${club}`}
              aria-live="polite"
            >
              {inspected ? (
                <>
                  <strong>
                    {clubOf(inspected)} · Row {inspected.rowIndex} ·{' '}
                    {sessionNames.get(inspected.sessionId)}
                  </strong>
                  <div className="shape-tiles">
                    <p className="shape-tile">
                      Launch:{' '}
                      {direction(inspected.measurements.launchDirection, '°')}
                    </p>
                    <p className="shape-tile">
                      Curve: {direction(inspected.measurements.curve, ' m')}
                    </p>
                    <p className="shape-tile">
                      From Centre:{' '}
                      {direction(inspected.measurements.fromCentre, ' m')}
                    </p>
                    <p className="shape-tile">
                      Carry:{' '}
                      {carry === null || carry === undefined
                        ? 'Missing'
                        : `${carry.toFixed(1)} m`}{' '}
                      · {BASES[basis].label}
                    </p>
                  </div>
                </>
              ) : (
                <p>Select a shot to see its recorded measurements.</p>
              )}
            </div>
            <Disclosure summary={`Shot measurements (${group.length})`}>
              <div className="table-wrap">
                <table aria-label={`${club} shot measurements`}>
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Source row / shot #</th>
                      <th>Launch direction</th>
                      <th>Curve</th>
                      <th>From Centre</th>
                      <th>Carry · {BASES[basis].label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((shot) => (
                      <tr key={shot.id}>
                        <td>{sessionNames.get(shot.sessionId)}</td>
                        <td>
                          <Button
                            variant="ghost"
                            small
                            aria-label={`Inspect row ${shot.rowIndex}`}
                            onClick={() => setSelected(shot.id)}
                          >
                            {shot.rowIndex} / {shot.sourceNumber || '—'}
                          </Button>
                        </td>
                        <td>
                          {direction(shot.measurements.launchDirection, '°')}
                        </td>
                        <td>{direction(shot.measurements.curve, ' m')}</td>
                        <td>{direction(shot.measurements.fromCentre, ' m')}</td>
                        <td>
                          {shot.measurements[BASES[basis].carry]?.toFixed(1) ??
                            'Missing'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Disclosure>
          </>
        )}
      </Card>
    </>
  );
}
