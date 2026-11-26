import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import {
  idSchema,
  type Basis,
  type Dataset,
  type Session,
} from '../domain/model';
import {
  compareSessions,
  COMPARE_INTENTS,
  MIN_PCT_MEASURED,
  MIN_REVIEWED_FULL,
  MIN_SPREAD_MEASURED,
  MIN_TYPICAL_MEASURED,
  type CompareIntent,
  type DirectionComparison,
  type MetricComparison,
  type SessionComparison,
  type Shares,
} from '../domain/compare';
import {
  equipmentDisplayName,
  type LabelEquipmentSummary,
} from '../domain/equipment';
import { BasisButton } from './AnalysisControls';
import { Button, HelpPopover, Select } from './ds';
import {
  axisTick,
  ChartContainer,
  ChartSummary,
  ChartTooltipContent,
  usePrefersReducedMotion,
} from './charts';

/** Hash route for the comparison view; reload and Back keep the pair. */
export function compareHref(reference?: string, comparison?: string) {
  const params = new URLSearchParams();
  if (reference) params.set('reference', reference);
  if (comparison) params.set('comparison', comparison);
  const query = params.toString();
  return `#sessions/compare${query ? `?${query}` : ''}`;
}

export function parseCompareQuery(query: string) {
  const params = new URLSearchParams(query);
  return {
    reference: idSchema.safeParse(params.get('reference')).data,
    comparison: idSchema.safeParse(params.get('comparison')).data,
  };
}

/** Date, time when known, venue, filename and a stable distinct ID fragment. */
export function sessionOptionLabel(session: Session) {
  const parts = [session.date];
  if (session.time) parts.push(session.time.slice(0, 5));
  if (session.venue) parts.push(session.venue);
  parts.push(session.filename);
  parts.push(`id ${session.id.slice(0, 8)}`);
  return parts.join(' · ');
}

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const signed = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  signDisplay: 'always',
});
const percent = new Intl.NumberFormat(undefined, { style: 'percent' });
const signedPercent = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'always',
});

const INTENT_LABELS: Record<CompareIntent, string> = {
  all: 'All intents',
  full: 'Full swings',
  partial: 'Partial swings',
  unknown: 'Unknown intent',
};

function metres(value: number | null) {
  return value === null ? '—' : `${decimal.format(value)} m`;
}
function signedMetres(value: number | null) {
  return value === null ? '—' : `${signed.format(value)} m`;
}
function metricValue(value: number | null, unit: string) {
  if (value === null) return '—';
  return unit === '°'
    ? `${decimal.format(value)}°`
    : `${decimal.format(value)} ${unit}`;
}
function signedMetric(value: number | null, unit: string) {
  if (value === null) return '—';
  return unit === '°'
    ? `${signed.format(value)}°`
    : `${signed.format(value)} ${unit}`;
}
function signedPp(value: number | null) {
  return value === null ? '—' : `${signed.format(value)} pp`;
}
function signedPercentText(value: number | null) {
  return value === null ? '—' : signedPercent.format(value);
}
function countsText(stats: { n: number; missing: number }) {
  return `${stats.n} measured, ${stats.missing} missing`;
}
function shareText(side: DirectionComparison['reference'], key: keyof Shares) {
  return side.shares === null
    ? '—'
    : `${percent.format(side.shares[key])} (${side[key]}/${side.n})`;
}

function SideSummary({
  label,
  chip,
  side,
  intent,
}: {
  label: string;
  chip: 'A' | 'B';
  side: SessionComparison['reference'];
  intent: CompareIntent;
}) {
  return (
    <div className={`compare-side ab-${chip === 'A' ? 'a' : 'b'}`}>
      <span className={`ab-chip ${chip === 'A' ? 'a' : 'b'}`} aria-hidden="true">
        {chip}
      </span>
      <p>
        <strong>{label}</strong>
        {side.session ? ` · ${sessionOptionLabel(side.session)}` : ''} ·{' '}
        {side.recorded} recorded · {side.included} included
        {intent !== 'all' && ` · ${side.afterIntent} after intent filter`}
      </p>
    </div>
  );
}

/**
 * Shared-scale carry comparison: one pair of A/B bars per common club on a
 * single zero-based distance axis. Tapping a bar (or a club chip) opens that
 * club's detail accordion below.
 */
function CarryCompareChart({
  clubs,
  onSelectClub,
}: {
  clubs: SessionComparison['common'];
  onSelectClub: (club: string) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const data = useMemo(
    () =>
      clubs.map((club) => ({
        club: club.club,
        reference: club.reference.carry.median,
        comparison: club.comparison.carry.median,
        detail: `${club.reference.included} / ${club.comparison.included} included shots · ${club.reference.carry.n} / ${club.comparison.carry.n} measured`,
      })),
    [clubs],
  );
  const max = Math.max(
    ...data.flatMap((d) => [d.reference ?? 0, d.comparison ?? 0]),
    10,
  );
  const xMax = Math.ceil(max / 10) * 10;
  const pick = (entry: unknown) => {
    const club = (entry as { payload?: { club?: string } })?.payload?.club;
    if (club) onSelectClub(String(club));
  };
  return (
    <>
      <ChartSummary label="Median carry per club, reference vs comparison">
        {data
          .map(
            (d) =>
              `${d.club}: reference ${d.reference === null ? '—' : `${decimal.format(d.reference)} m`}, comparison ${d.comparison === null ? '—' : `${decimal.format(d.comparison)} m`}`,
          )
          .join('. ')}
        .
      </ChartSummary>
      <ChartContainer
        label="Median carry by club: reference (A) vs comparison (B)"
        height={Math.max(160, data.length * 48 + 28)}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 20, bottom: 0, left: 0 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            domain={[0, xMax]}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => String(v)}
          />
          <YAxis
            type="category"
            dataKey="club"
            tick={axisTick}
            width={48}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<ChartTooltipContent unit="m" />}
            cursor={{ fill: 'var(--surface-2)' }}
            isAnimationActive={!reduced}
          />
          <Bar
            dataKey="reference"
            name="Reference (A)"
            fill="var(--data)"
            radius={[0, 6, 6, 0]}
            isAnimationActive={!reduced}
            onClick={pick}
          />
          <Bar
            dataKey="comparison"
            name="Comparison (B)"
            fill="var(--compare)"
            radius={[0, 6, 6, 0]}
            isAnimationActive={!reduced}
            onClick={pick}
          />
        </BarChart>
      </ChartContainer>
      <p className="chart-legend muted compare-chart-legend" aria-hidden="true">
        <span className="legend-dot a" /> Reference (A)
        <span className="legend-dot b" /> Comparison (B) · shared 0–{xMax} m scale
      </p>
    </>
  );
}

function FlightRows({
  label,
  unit,
  metric,
  withPct = false,
}: {
  label: string;
  unit: string;
  metric: MetricComparison;
  withPct?: boolean;
}) {
  const sparse =
    metric.reference.n < MIN_SPREAD_MEASURED ||
    metric.comparison.n < MIN_SPREAD_MEASURED;
  return (
    <>
      <tr>
        <th scope="row">
          {label}
          {sparse && <span className="pill">Sparse</span>}
        </th>
        <td>{metricValue(metric.reference.median, unit)}</td>
        <td>{metricValue(metric.comparison.median, unit)}</td>
        <td>{signedMetric(metric.delta, unit)}</td>
      </tr>
      <tr>
        <th scope="row">{label} · measured</th>
        <td>{countsText(metric.reference)}</td>
        <td>{countsText(metric.comparison)}</td>
        <td>—</td>
      </tr>
      {withPct && (
        <tr>
          <th scope="row">{label} · relative</th>
          <td>—</td>
          <td>—</td>
          <td>{signedPercentText(metric.pctDelta)}</td>
        </tr>
      )}
    </>
  );
}

function DirectionRows({
  label,
  direction,
}: {
  label: string;
  direction: DirectionComparison;
}) {
  return (
    <>
      <tr>
        <th scope="row">{label} · measured</th>
        <td>{countsText(direction.reference)}</td>
        <td>{countsText(direction.comparison)}</td>
        <td>—</td>
      </tr>
      {(['left', 'straight', 'right'] as const).map((side) => (
        <tr key={side}>
          <th scope="row">
            {label} · {side}
          </th>
          <td>{shareText(direction.reference, side)}</td>
          <td>{shareText(direction.comparison, side)}</td>
          <td>{signedPp(direction.deltaPp?.[side] ?? null)}</td>
        </tr>
      ))}
    </>
  );
}

function equipmentText(summary: LabelEquipmentSummary) {
  const names = summary.equipment.map(equipmentDisplayName).join(', ');
  return `${summary.assigned}/${summary.shots} assigned · ${summary.coverage}${
    summary.needsReview > 0 ? ` · Needs review: ${summary.needsReview}` : ''
  }${names ? ` · ${names}` : ''}`;
}

function ClubDetails({
  club,
  basisLabel,
}: {
  club: SessionComparison['common'][number];
  basisLabel: string;
}) {
  const {
    reference,
    comparison,
    carryDelta,
    carryPctDelta,
    iqrDelta,
    sparse,
    typical,
    flight,
    direction,
    review,
  } = club;
  const reviewThin = review.reference.thin || review.comparison.thin;
  return (
    <details
      className="recap-club compare-club"
      name="compare-clubs"
      id={`compare-club-${club.club}`}
    >
      <summary>
        <strong>{club.club}</strong> · {metres(reference.carry.median)} /{' '}
        {metres(comparison.carry.median)} · {reference.included} /{' '}
        {comparison.included} shots
        {sparse && <span className="pill">Sparse</span>}
      </summary>
      <div className="table-wrap">
        <table>
          <caption>
            Carry on basis {basisLabel} · difference is comparison minus
            reference
          </caption>
          <thead>
            <tr>
              <th>Carry</th>
              <th className="ab-a">Reference (A)</th>
              <th className="ab-b">Comparison (B)</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Included shots</th>
              <td>{reference.included}</td>
              <td>{comparison.included}</td>
              <td>—</td>
            </tr>
            <tr>
              <th scope="row">Assigned equipment</th>
              <td>{equipmentText(reference.equipment)}</td>
              <td>{equipmentText(comparison.equipment)}</td>
              <td>—</td>
            </tr>
            <tr>
              <th scope="row">Measured</th>
              <td>{reference.carry.n}</td>
              <td>{comparison.carry.n}</td>
              <td>—</td>
            </tr>
            <tr>
              <th scope="row">Missing</th>
              <td>{reference.carry.missing}</td>
              <td>{comparison.carry.missing}</td>
              <td>—</td>
            </tr>
            <tr>
              <th scope="row">Median carry</th>
              <td>{metres(reference.carry.median)}</td>
              <td>{metres(comparison.carry.median)}</td>
              <td>{signedMetres(carryDelta)}</td>
            </tr>
            <tr>
              <th scope="row">Carry IQR</th>
              <td>{metres(reference.carry.iqr)}</td>
              <td>{metres(comparison.carry.iqr)}</td>
              <td>{signedMetres(iqrDelta)}</td>
            </tr>
            <tr>
              <th scope="row">Relative carry change</th>
              <td>—</td>
              <td>—</td>
              <td>{signedPercentText(carryPctDelta)}</td>
            </tr>
            {typical.kind === 'unavailable' ? (
              <tr>
                <th scope="row">Typical carry</th>
                <td>Unavailable</td>
                <td>Unavailable</td>
                <td>—</td>
              </tr>
            ) : (
              <>
                <tr>
                  <th scope="row">
                    Typical carry ·{' '}
                    {typical.kind === 'reviewed'
                      ? 'reviewed typical'
                      : 'broader cohort'}
                  </th>
                  <td>{metres(typical.reference.median)}</td>
                  <td>{metres(typical.comparison.median)}</td>
                  <td>{signedMetres(typical.delta)}</td>
                </tr>
                <tr>
                  <th scope="row">Typical carry · measured</th>
                  <td>{countsText(typical.reference)}</td>
                  <td>{countsText(typical.comparison)}</td>
                  <td>—</td>
                </tr>
                <tr>
                  <th scope="row">Typical carry · relative</th>
                  <td>—</td>
                  <td>—</td>
                  <td>{signedPercentText(typical.pctDelta)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {typical.kind === 'unavailable' ? (
        <p className="notice">{typical.reason}</p>
      ) : (
        <p className="muted">
          Typical carry uses the {typical.label} on both sides; the reviewed
          cohort needs at least {MIN_TYPICAL_MEASURED} measured carries per
          side.
        </p>
      )}
      <div className="table-wrap">
        <table>
          <caption>
            Ball flight on basis {basisLabel} · medians · difference is
            comparison minus reference
          </caption>
          <thead>
            <tr>
              <th>Flight</th>
              <th className="ab-a">Reference (A)</th>
              <th className="ab-b">Comparison (B)</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            <FlightRows
              label="Ball speed"
              unit="kph"
              metric={flight.speed}
              withPct
            />
            <FlightRows label="Launch angle" unit="°" metric={flight.launch} />
            <FlightRows label="Apex" unit="m" metric={flight.apex} />
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table>
          <caption>
            Start direction, curve and lateral offset on basis {basisLabel} ·
            shares of measured shots · difference in percentage points
          </caption>
          <thead>
            <tr>
              <th>Direction</th>
              <th className="ab-a">Reference (A)</th>
              <th className="ab-b">Comparison (B)</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            <DirectionRows
              label="Start direction"
              direction={direction.launchDirection}
            />
            <DirectionRows label="Curve" direction={direction.curve} />
            <DirectionRows
              label="Lateral offset"
              direction={direction.lateral}
            />
          </tbody>
        </table>
      </div>
      {review.reference.fullSwings || review.comparison.fullSwings ? (
        <div className="table-wrap">
          <table>
            <caption>
              Contact review · confirmed mishits over reviewed full swings ·
              automatic unusual-shot flags are kept separate
            </caption>
            <thead>
              <tr>
                <th>Review</th>
                <th>Reference</th>
                <th>Comparison</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Full swings reviewed</th>
                <td>
                  {review.reference.reviewed} of {review.reference.fullSwings}{' '}
                  full swings
                  {review.reference.reviewedShare !== null &&
                    ` (${percent.format(review.reference.reviewedShare)})`}
                </td>
                <td>
                  {review.comparison.reviewed} of {review.comparison.fullSwings}{' '}
                  full swings
                  {review.comparison.reviewedShare !== null &&
                    ` (${percent.format(review.comparison.reviewedShare)})`}
                </td>
                <td>{signedPp(review.reviewedShareDeltaPp)}</td>
              </tr>
              <tr>
                <th scope="row">Confirmed mishits</th>
                <td>
                  {review.reference.mishits} of {review.reference.reviewed}{' '}
                  reviewed full swings
                  {review.reference.rate !== null &&
                    ` (${percent.format(review.reference.rate)})`}
                </td>
                <td>
                  {review.comparison.mishits} of {review.comparison.reviewed}{' '}
                  reviewed full swings
                  {review.comparison.rate !== null &&
                    ` (${percent.format(review.comparison.rate)})`}
                </td>
                <td>{signedPp(review.rateDeltaPp)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          No full swings in this selection for contact review.
        </p>
      )}
      {reviewThin && (
        <p className="notice">
          Review coverage is thin on at least one side (fewer than{' '}
          {MIN_REVIEWED_FULL} contact-reviewed full swings).
        </p>
      )}
      {sparse && (
        <p className="notice">
          Carry IQR needs at least {MIN_SPREAD_MEASURED} measured shots per
          side.
        </p>
      )}
    </details>
  );
}

export function CompareSessions({
  data,
  referenceId,
  comparisonId,
  onSelect,
  basis,
  onBasisChange,
}: {
  data: Dataset;
  referenceId: string | undefined;
  comparisonId: string | undefined;
  onSelect: (
    reference: string | undefined,
    comparison: string | undefined,
  ) => void;
  basis: Basis;
  onBasisChange: (basis: Basis) => void;
}) {
  const [intent, setIntent] = useState<CompareIntent>('all');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = headingRef.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }, []);
  const options = useMemo(
    () =>
      [...data.sessions]
        .filter((session) => !session.archived)
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            (b.time ?? '').localeCompare(a.time ?? '') ||
            a.id.localeCompare(b.id),
        ),
    [data.sessions],
  );
  const referenceUnavailable = Boolean(
    referenceId && !options.some((session) => session.id === referenceId),
  );
  const comparisonUnavailable = Boolean(
    comparisonId && !options.some((session) => session.id === comparisonId),
  );
  const comparison =
    referenceId && comparisonId && !referenceUnavailable && !comparisonUnavailable
      ? compareSessions(data, referenceId, comparisonId, basis, intent)
      : null;
  // Open (and scroll to) one club's detail accordion from a chart bar or chip.
  const openClub = (club: string) => {
    const el = document.getElementById(`compare-club-${club}`);
    if (!el) return;
    if (!(el as HTMLDetailsElement).open) {
      (el.querySelector('summary') as HTMLElement | null)?.click();
    }
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <section
      className="ds-card compare-panel"
      aria-labelledby="compare-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="compare-heading" tabIndex={-1} ref={headingRef}>
            Compare sessions
          </h2>
        </div>
        <div className="card-controls">
          <a className="text-button" href="#sessions">
            Back to logbook
          </a>
          <BasisButton basis={basis} onChange={onBasisChange} />
          <HelpPopover label="How this comparison works">
            <p>
              Both sessions use their complete non-archived included shots on the
              same measurement basis and intent filter. Only clubs present in
              both are compared; “Only in reference/comparison” lists the rest.
            </p>
            <p>
              Differences are comparison minus reference. Direction and review
              differences are percentage points (pp); relative changes are
              percentages and need a positive reference with at least{' '}
              {MIN_PCT_MEASURED} measured shots per side. A longer carry is not
              automatically better — venue, shot-mix and coverage differences
              are flagged above the chart.
            </p>
          </HelpPopover>
        </div>
      </div>
      <p className="context">
        Pick two sessions to compare their included shots club by club — A is
        the reference, B the comparison.
      </p>
      <div className="compare-controls">
        <div className="compare-selects">
          <Select
            label="Reference session"
            value={referenceUnavailable ? '' : (referenceId ?? '')}
            onChange={(value) => onSelect(value || undefined, comparisonId)}
            options={[
              { value: '', label: 'Choose a session' },
              ...options.map((session) => ({
                value: session.id,
                label: sessionOptionLabel(session),
              })),
            ]}
          />
          <Select
            label="Comparison session"
            value={comparisonUnavailable ? '' : (comparisonId ?? '')}
            onChange={(value) => onSelect(referenceId, value || undefined)}
            options={[
              { value: '', label: 'Choose a session' },
              ...options.map((session) => ({
                value: session.id,
                label: sessionOptionLabel(session),
              })),
            ]}
          />
          <Select
            label="Shot intent"
            value={intent}
            onChange={(value) => {
              const next = COMPARE_INTENTS.find((v) => v === value);
              if (next) setIntent(next);
            }}
            options={COMPARE_INTENTS.map((value) => ({
              value,
              label: INTENT_LABELS[value],
            }))}
          />
        </div>
        <div className="actions" style={{ margin: 0 }}>
          <Button
            variant="secondary"
            disabled={!comparison}
            onClick={() => onSelect(comparisonId, referenceId)}
          >
            Swap sessions
          </Button>
        </div>
      </div>
      {referenceUnavailable || comparisonUnavailable ? (
        <p className="notice" role="status">
          {referenceUnavailable && comparisonUnavailable
            ? 'Both selected sessions are archived or unavailable. Choose other sessions from the selectors.'
            : referenceUnavailable
              ? 'The reference session is archived or unavailable. Choose another reference session.'
              : 'The comparison session is archived or unavailable. Choose another comparison session.'}
        </p>
      ) : !referenceId || !comparisonId ? (
        <p className="notice" role="status">
          Choose a reference and a comparison session to see their shared clubs.
        </p>
      ) : comparison && comparison.duplicate ? (
        <p className="notice" role="status">
          Choose two different sessions to compare.
        </p>
      ) : comparison ? (
        <>
          <div className="compare-sides">
            <SideSummary
              label="Reference"
              chip="A"
              side={comparison.reference}
              intent={intent}
            />
            <SideSummary
              label="Comparison"
              chip="B"
              side={comparison.comparison}
              intent={intent}
            />
          </div>
          {comparison.venueDiffers && (
            <p className="notice">
              These sessions took place at different venues.
            </p>
          )}
          {comparison.shotMixDiffers && (
            <p className="notice">
              The mix of shots differs between these visits.
            </p>
          )}
          {comparison.coverageDiffers && (
            <p className="notice">
              Carry measurement coverage on the {comparison.basisLabel} basis
              differs between these visits.
            </p>
          )}
          {intent !== 'all' && (
            <p className="notice">
              Shot intent filter “{INTENT_LABELS[intent]}” removes{' '}
              {comparison.reference.included - comparison.reference.afterIntent}{' '}
              reference and{' '}
              {comparison.comparison.included -
                comparison.comparison.afterIntent}{' '}
              comparison included shots.
            </p>
          )}
          {comparison.referenceOnly.length > 0 && (
            <p>
              Only in reference{' · '}
              {comparison.referenceOnly
                .map(({ club, included }) => `${club} (${included})`)
                .join(', ')}
            </p>
          )}
          {comparison.comparisonOnly.length > 0 && (
            <p>
              Only in comparison{' · '}
              {comparison.comparisonOnly
                .map(({ club, included }) => `${club} (${included})`)
                .join(', ')}
            </p>
          )}
          {comparison.common.length === 0 ? (
            <p className="notice" role="status">
              No clubs in common between these sessions on the selected intent
              filter. Change either session selection or the intent filter.
            </p>
          ) : (
            <>
              <CarryCompareChart
                clubs={comparison.common}
                onSelectClub={openClub}
              />
              <div
                className="compare-club-chips"
                role="group"
                aria-label="Select a club"
              >
                {comparison.common.map((club) => (
                  <button
                    key={club.club}
                    type="button"
                    className="gap-club-chip"
                    onClick={() => openClub(club.club)}
                  >
                    <span className="club-badge" aria-hidden="true">
                      {club.club.toUpperCase()}
                    </span>
                    <span>{club.club}</span>
                  </button>
                ))}
              </div>
              <p className="muted">
                Median carry and shot counts are shown in reference / comparison
                order. Select a club above or tap a bar for its details.
              </p>
              {comparison.common.map((club) => (
                <ClubDetails
                  key={club.club}
                  club={club}
                  basisLabel={comparison.basisLabel}
                />
              ))}
            </>
          )}
          <p className="muted">
            Differences describe these visits. Carry spread is the width of the
            middle half of measured shots (IQR). Relative changes need a
            positive reference and at least {MIN_PCT_MEASURED} measured shots
            per side; direction differences are in percentage points.
          </p>
        </>
      ) : null}
    </section>
  );
}
