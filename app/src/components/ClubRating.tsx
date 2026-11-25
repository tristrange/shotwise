import {
  RATINGS_VERSION,
  weakestEvidence,
  type ClubRating,
} from '../domain/ratings';

// The dense four-category breakdown lives in the chart kit; this module keeps
// the collapsed chip and re-exports the breakdown so existing imports hold.
export { RatingBreakdown } from './charts/RatingBreakdown';

const scoreText = (n: number | null) => (n === null ? '—' : n.toFixed(0));

const EVIDENCE_LABEL: Record<string, string> = {
  none: 'too few shots',
  early: 'early estimate',
  provisional: 'provisional',
  'provisional-high-sample': 'provisional · high sample',
  supported: 'well supported',
};

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

