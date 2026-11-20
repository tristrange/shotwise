import { useEffect, useMemo, useRef, useState } from 'react';
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
import { BasisButton } from './AnalysisControls';

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
  side,
  intent,
}: {
  label: string;
  side: SessionComparison['reference'];
  intent: CompareIntent;
}) {
  return (
    <p>
      <strong>{label}</strong>
      {side.session ? ` · ${sessionOptionLabel(side.session)}` : ''} ·{' '}
      {side.recorded} recorded · {side.included} included
      {intent !== 'all' && ` · ${side.afterIntent} after intent filter`}
    </p>
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
    <details className="recap-club compare-club" name="compare-clubs">
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
              <th>Reference</th>
              <th>Comparison</th>
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
              <th>Reference</th>
              <th>Comparison</th>
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
              <th>Reference</th>
              <th>Comparison</th>
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
  const comparison =
    referenceId && comparisonId
      ? compareSessions(data, referenceId, comparisonId, basis, intent)
      : null;
  const bothAvailable =
    comparison !== null &&
    !comparison.duplicate &&
    comparison.reference.available &&
    comparison.comparison.available;
  return (
    <section className="panel compare-panel" aria-labelledby="compare-heading">
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
        </div>
      </div>
      <p>Pick two sessions to compare their included shots club by club.</p>
      <div className="compare-controls">
        <div className="form-grid">
          <label>
            Reference session
            <select
              value={referenceId ?? ''}
              onChange={(e) =>
                onSelect(e.target.value || undefined, comparisonId)
              }
            >
              <option value="">Choose a session</option>
              {options.map((session) => (
                <option key={session.id} value={session.id}>
                  {sessionOptionLabel(session)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Comparison session
            <select
              value={comparisonId ?? ''}
              onChange={(e) =>
                onSelect(referenceId, e.target.value || undefined)
              }
            >
              <option value="">Choose a session</option>
              {options.map((session) => (
                <option key={session.id} value={session.id}>
                  {sessionOptionLabel(session)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shot intent
            <select
              value={intent}
              onChange={(e) => {
                const next = COMPARE_INTENTS.find(
                  (value) => value === e.currentTarget.value,
                );
                if (next) setIntent(next);
              }}
            >
              {COMPARE_INTENTS.map((value) => (
                <option key={value} value={value}>
                  {INTENT_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={!referenceId || !comparisonId}
            onClick={() => onSelect(comparisonId, referenceId)}
          >
            Swap sessions
          </button>
        </div>
      </div>
      {!referenceId || !comparisonId ? (
        <p className="notice" role="status">
          Choose a reference and a comparison session to see their shared clubs.
        </p>
      ) : comparison && comparison.duplicate ? (
        <p className="notice" role="status">
          Choose two different sessions to compare.
        </p>
      ) : comparison && bothAvailable ? (
        <>
          <div className="compare-sides">
            <SideSummary
              label="Reference"
              side={comparison.reference}
              intent={intent}
            />
            <SideSummary
              label="Comparison"
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
              <p className="muted">
                Median carry and shot counts are shown in reference / comparison
                order.
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
      ) : (
        comparison && (
          <p className="notice" role="status">
            {!comparison.reference.available && !comparison.comparison.available
              ? 'Both selected sessions are archived or unavailable. Choose other sessions from the selectors.'
              : !comparison.reference.available
                ? 'The reference session is archived or unavailable. Choose another reference session.'
                : 'The comparison session is archived or unavailable. Choose another comparison session.'}
          </p>
        )
      )}
    </section>
  );
}
