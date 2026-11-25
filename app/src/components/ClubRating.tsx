import {
  RATINGS_VERSION,
  RATING_BASIS,
  RATING_WEIGHTS,
  weakestEvidence,
  type ClubRating,
} from '../domain/ratings';
import { REFERENCE_STATISTIC_LABEL } from '../domain/benchmarks';

/** Lowercase labels for the three distinct reference concepts (ADR-0005 §4.5). */
type RatingReferenceType = NonNullable<ClubRating['distancePotential']['reference']>['type'];
const REFERENCE_LABEL: Record<RatingReferenceType, string> = {
  'personal-goal': 'personal goal',
  'historical-potential': 'historical personal potential',
  'external-benchmark': 'external benchmark',
};

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat(undefined, { style: 'percent' });

const scoreText = (n: number | null) => (n === null ? '—' : n.toFixed(0));

/**
 * Compact composite chip for a club row (ADR-0005 §5). Full composites show
 * the plain number; provisional composites (2–3 of 4 categories) are marked
 * with a dashed outline and a coverage tag so they are never read as directly
 * comparable with full composites.
 */
export function RatingChip({ rating }: { rating: ClubRating | null }) {
  if (!rating || rating.composite.value === null)
    return (
      <span className="rating-chip none" title="No composite yet — fewer than 2 rated categories">
        —
      </span>
    );
  const { value, provisional, coverage } = rating.composite;
  // Evidence strength is shown independently of category coverage: a full
  // 4/4 composite built from early (small-sample, few-visit) evidence is
  // tagged so it is never read as well-supported.
  const weakest = weakestEvidence(
    [rating.distancePotential, rating.consistency, rating.directionalControl, rating.reliability]
      .filter((cat) => cat.score !== null)
      .map((cat) => cat.evidence),
  );
  const early = weakest === 'early';
  return (
    <span
      className={`rating-chip${provisional ? ' provisional' : ''}${early ? ' early' : ''}`}
      title={
        (provisional
          ? `Provisional composite — ${coverage} of 4 categories rated`
          : `Overall rating — all 4 categories`) +
        ` · weakest evidence: ${EVIDENCE_LABEL[weakest ?? 'none'] ?? weakest} (${RATINGS_VERSION})`
      }
    >
      {scoreText(value)}
      {provisional && <small>prov {coverage}/4</small>}
      {early && <small>early</small>}
    </span>
  );
}

type Row = {
  label: string;
  score: number | null;
  sub: string;
  /** Sample support: contributing shots, visits and the evidence level. */
  meta: string;
};

const EVIDENCE_LABEL: Record<string, string> = {
  none: 'too few shots',
  early: 'early estimate',
  provisional: 'provisional',
  'provisional-high-sample': 'provisional · high sample',
  supported: 'well supported',
};

const meta = (n: number, visits: number, evidence: string) =>
  `${n} shots · ${visits} ${visits === 1 ? 'visit' : 'visits'} · ${EVIDENCE_LABEL[evidence] ?? evidence}`;

/**
 * Expandable four-category breakdown with compact bars, the measurements
 * behind each score and the reference context (ADR-0005 §4–§5, owner UI
 * clarification 5): result first, methodology on demand.
 */
export function RatingBreakdown({ rating }: { rating: ClubRating }) {
  const d = rating.distancePotential;
  const c = rating.consistency;
  const dir = rating.directionalControl;
  const rel = rating.reliability;
  const rows: Row[] = [
    {
      label: 'Distance',
      score: d.score,
      sub:
        d.p80 !== null
          ? `P80 ${decimal.format(d.p80)} m` +
            (d.reference
              ? ` vs ${REFERENCE_LABEL[d.reference.type]} ${decimal.format(d.reference.valueM)} m` +
                (d.reference.statistic && d.reference.statistic !== 'other'
                  ? ` ${REFERENCE_STATISTIC_LABEL[d.reference.statistic]}`
                  : '') +
                (d.reference.match === 'family' ? ' (family-level basis)' : '')
              : ' · no compatible reference — rating withheld')
          : 'no measured carries on the rating basis',
      meta: meta(d.n, d.visits, d.evidence),
    },
    {
      label: 'Consistency',
      score: c.score,
      sub:
        c.iqr !== null && c.median !== null
          ? `IQR ${decimal.format(c.iqr)} m · ${percent.format(c.relIqr ?? 0)} of median ${decimal.format(c.median)} m`
          : 'not enough measured carries',
      meta: meta(c.n, c.visits, c.evidence),
    },
    {
      label: 'Direction',
      score: dir.score,
      sub:
        dir.measurementBasis === 'lateral'
          ? `P80 offline ${dir.relLatP80 === null ? '—' : percent.format(dir.relLatP80)} of carry · corridor ${dir.corridorSuccess === null ? '—' : percent.format(dir.corridorSuccess)}`
          : dir.measurementBasis === 'launch'
            ? `no finishing-position data — launch ${scoreText(dir.launchScore)} shown separately, not in the composite`
            : 'direction not measured',
      meta: meta(dir.n, dir.visits, dir.evidence),
    },
    {
      label: 'Reliability',
      score: rel.score,
      sub:
        rel.mishitShare !== null
          ? `mishit ${percent.format(rel.mishitShare)} · ${rel.assessed} assessed${rel.unassessed ? `, ${rel.unassessed} unassessed` : ''}` +
            (rel.wilson
              ? ` · Wilson 95% ${percent.format(rel.wilson[0])}–${percent.format(rel.wilson[1])} (sampling only)`
              : '') +
            (rel.sensitivity && rel.sensitivity.allUnassessedMishit !== rel.sensitivity.allUnassessedClean
              ? ` · if unassessed were mishits: down to ${scoreText(rel.sensitivity.allUnassessedMishit)}`
              : '')
          : 'not enough assessed swings',
      meta: meta(rel.n, rel.visits, rel.evidence),
    },
  ];
  return (
    <div className="rating-breakdown">
      <p className="rating-overall">
        Overall <strong>{scoreText(rating.composite.value)}</strong>
        {rating.composite.provisional && (
          <span className="pill"> provisional · {rating.composite.coverage}/4 categories</span>
        )}
        {!rating.composite.provisional && rating.composite.value !== null && (
          <span className="context"> · all four categories</span>
        )}
      </p>
      {rows.map((row) => (
        <div className={`rating-row${row.score === null ? ' withheld' : ''}`} key={row.label}>
          <span className="rating-label">{row.label}</span>
          <span className="rating-track" aria-hidden="true">
            {row.score !== null && (
              <span
                className="rating-fill"
                style={{ width: `${Math.max(0, Math.min(100, row.score))}%` }}
              />
            )}
          </span>
          <span className="rating-score">{scoreText(row.score)}</span>
          <span className="rating-sub">
            {row.sub} · {row.meta}
          </span>
        </div>
      ))}
      <details>
        <summary>How this rating is calculated</summary>
        <p className="context">
          Designed performance index ({RATINGS_VERSION}), not a validated skill measure. Weights:
          distance {RATING_WEIGHTS.distancePotential * 100}%, consistency{' '}
          {RATING_WEIGHTS.consistency * 100}%, direction {RATING_WEIGHTS.directionalControl * 100}%,
          reliability {RATING_WEIGHTS.reliability * 100}%. Distance = min(100, 100 × P80 ÷ reference);
          consistency and direction use provisional role-based anchors on relative spread; reliability =
          100 × (1 − mishit share). Computed on the fixed {RATING_BASIS} rating basis — changing the
          display basis never changes ratings or classification. Range-ball and premium measurements
          are never pooled. Anchors are provisional product constants, not population benchmarks.
          Sample sufficiency is shown as evidence strength, not statistical validation.
        </p>
      </details>
    </div>
  );
}
