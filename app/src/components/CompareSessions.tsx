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
  type CompareIntent,
  type SessionComparison,
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

function ClubDetails({
  club,
  basisLabel,
}: {
  club: SessionComparison['common'][number];
  basisLabel: string;
}) {
  const { reference, comparison, carryDelta, iqrDelta } = club;
  const sparse = reference.carry.n < 4 || comparison.carry.n < 4;
  return (
    <details className="recap-club compare-club" name="compare-clubs">
      <summary>
        <strong>{club.club}</strong> · {metres(reference.carry.median)} /{' '}
        {metres(comparison.carry.median)} · {reference.included} /{' '}
        {comparison.included} shots{sparse && <span className="pill">Sparse</span>}
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
          </tbody>
        </table>
      </div>
      {sparse && (
        <p className="notice">
          Carry IQR needs at least 4 measured shots per side.
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
  const referenceVenue = comparison?.reference.session?.venue.trim();
  const comparisonVenue = comparison?.comparison.session?.venue.trim();
  const venuesDiffer =
    referenceVenue &&
    comparisonVenue &&
    referenceVenue.toLowerCase() !== comparisonVenue.toLowerCase();
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
      <p>
        Pick two sessions to compare their included shots club by club.
      </p>
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
          {venuesDiffer && (
            <p className="notice">
              These sessions took place at different venues.
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
            middle half of measured shots (IQR).
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
