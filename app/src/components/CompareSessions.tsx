import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  idSchema,
  venueKey,
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
  onToggle,
}: {
  club: SessionComparison['common'][number];
  basisLabel: string;
  onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
}) {
  const { reference, comparison, carryDelta, iqrDelta } = club;
  const sparse = reference.carry.n < 4 || comparison.carry.n < 4;
  return (
    <details className="recap-club compare-club" onToggle={onToggle}>
      <summary>
        {club.club} · {reference.included} vs {comparison.included} included
        shots{sparse && <span className="pill">sparse</span>}
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
              <td>Included shots</td>
              <td>{reference.included}</td>
              <td>{comparison.included}</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Measured (n)</td>
              <td>{reference.carry.n}</td>
              <td>{comparison.carry.n}</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Missing</td>
              <td>{reference.carry.missing}</td>
              <td>{comparison.carry.missing}</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Median carry</td>
              <td>{metres(reference.carry.median)}</td>
              <td>{metres(comparison.carry.median)}</td>
              <td>{signedMetres(carryDelta)}</td>
            </tr>
            <tr>
              <td>Carry IQR</td>
              <td>{metres(reference.carry.iqr)}</td>
              <td>{metres(comparison.carry.iqr)}</td>
              <td>{signedMetres(iqrDelta)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {sparse && (
        <p className="notice">
          Sparse sample: fewer than 4 measured carries on at least one side, so
          IQR is unavailable there.
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
  const clubListRef = useRef<HTMLDivElement>(null);
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
  // At most one club detail expanded at a time.
  function onClubToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open) return;
    for (const open of clubListRef.current?.querySelectorAll('details[open]') ??
      []) {
      if (open !== event.currentTarget)
        (open as HTMLDetailsElement).open = false;
    }
  }
  const bothAvailable =
    comparison !== null &&
    !comparison.duplicate &&
    comparison.reference.available &&
    comparison.comparison.available;
  const venuesDiffer =
    bothAvailable &&
    comparison.reference.session !== null &&
    comparison.comparison.session !== null &&
    Boolean(venueKey(comparison.reference.session)) &&
    venueKey(comparison.reference.session) !==
      venueKey(comparison.comparison.session);
  return (
    <section className="panel compare-panel" aria-labelledby="compare-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Session comparison</span>
          <h2 id="compare-heading" tabIndex={-1} ref={headingRef}>
            Compare sessions
          </h2>
        </div>
        <BasisButton basis={basis} onChange={onBasisChange} />
      </div>
      <p>
        Pick two sessions to compare their included shots club by club. The pair
        is stored in the link, so reload and Back keep your selection.
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
              onChange={(e) => setIntent(e.target.value as CompareIntent)}
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
              Venues differ ({comparison.reference.session?.venue || 'none'} vs{' '}
              {comparison.comparison.session?.venue || 'none'}), so observed
              differences are descriptive only.
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
              Only in reference:{' '}
              {comparison.referenceOnly
                .map(({ club, included }) => `${club} (${included})`)
                .join(', ')}
            </p>
          )}
          {comparison.comparisonOnly.length > 0 && (
            <p>
              Only in comparison:{' '}
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
            <div ref={clubListRef}>
              {comparison.common.map((club) => (
                <ClubDetails
                  key={club.club}
                  club={club}
                  basisLabel={comparison.basisLabel}
                  onToggle={onClubToggle}
                />
              ))}
            </div>
          )}
          <p className="muted">
            Observed differences are descriptive, not a verdict on either
            session. Differences use comparison minus reference in native units.
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
