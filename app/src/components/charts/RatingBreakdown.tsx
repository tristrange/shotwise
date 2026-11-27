import type { ReactNode } from 'react';
import {
  MIN_RATING_SAMPLES,
  RATINGS_VERSION,
  RATING_BASIS,
  RATING_WEIGHTS,
  weakestEvidence,
  type CategoryId,
  type CategoryRating,
  type ClubRating,
} from '../../domain/ratings';
import { REFERENCE_STATISTIC_LABEL } from '../../domain/benchmarks';
import { HelpPopover, Disclosure, Badge } from '../ds';
import { ScoreBar } from './ScoreBar';
import { scoreBand } from './scoreBand';

type RatingReferenceType = NonNullable<
  ClubRating['distancePotential']['reference']
>['type'];
const REFERENCE_LABEL: Record<RatingReferenceType, string> = {
  'personal-goal': 'personal goal',
  'historical-potential': 'historical personal potential',
  'external-benchmark': 'external benchmark',
};

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat(undefined, { style: 'percent' });
const scoreText = (n: number | null) => (n === null ? '—' : n.toFixed(0));

const EVIDENCE_LABEL: Record<string, string> = {
  none: 'too few shots',
  early: 'early estimate',
  provisional: 'provisional',
  'provisional-high-sample': 'provisional · high sample',
  supported: 'well supported',
};

/**
 * Short reason a category score is withheld, per the coverage audit: each
 * label names the actual missing ingredient. Exact sample counts and the
 * detailed eligibility rules stay in the contextual help popover.
 */
function withheldReason(id: CategoryId, cat: CategoryRating): string | null {
  if (cat.score !== null) return null;
  switch (id) {
    case 'distancePotential':
      return (cat as ClubRating['distancePotential']).p80 === null
        ? 'insufficient eligible carry measurements'
        : 'no compatible distance reference';
    case 'consistency':
      return 'insufficient eligible carry measurements';
    case 'directionalControl':
      // Lateral data present but under-sampled, or launch-only fallback: both
      // mean too few lateral finishing-position measurements.
      return (cat as ClubRating['directionalControl']).measurementBasis === 'none'
        ? 'no direction measurements'
        : 'insufficient lateral finishing-position measurements';
    case 'reliability':
      return 'insufficient assessed full swings';
  }
}

/** Short reason plus the exact count behind it, for the contextual help. */
function withheldDetail(id: CategoryId, cat: CategoryRating): string | null {
  const reason = withheldReason(id, cat);
  if (!reason) return null;
  return `${reason} (${cat.n} of ${MIN_RATING_SAMPLES[id]} needed)`;
}

/**
 * Four-category rating breakdown (ADR-0005): concise bars, numbers and a
 * one-line measurement each; a withheld category names the actual reason it
 * is missing. Sample counts, visit counts, evidence levels, uncertainty
 * intervals and reference metadata live behind the contextual help popover —
 * dense evidence stays available without repetitive text.
 * Keeps the legacy rating-breakdown/rating-row classes for existing tests.
 */
export function RatingBreakdown({
  rating,
  referenceHref,
}: {
  rating: ClubRating;
  /** Deep link to the club profile's personal-reference configuration, offered when no compatible distance reference exists. */
  referenceHref?: string;
}) {
  const d = rating.distancePotential;
  const c = rating.consistency;
  const dir = rating.directionalControl;
  const rel = rating.reliability;
  const categories = [d, c, dir, rel];
  const weakest = weakestEvidence(
    categories.filter((cat) => cat.score !== null).map((cat) => cat.evidence),
  );
  const noReference = d.p80 !== null && d.reference === null;
  const rows: { label: string; score: number | null; sub: ReactNode }[] = [
    {
      label: 'Distance',
      score: d.score,
      sub: d.p80 !== null ? (
        <>
          P80 {decimal.format(d.p80)} m
          {d.reference
            ? ` vs ${REFERENCE_LABEL[d.reference.type]} ${decimal.format(d.reference.valueM)} m`
            : ' · no compatible distance reference'}
        </>
      ) : (
        withheldReason('distancePotential', d)
      ),
    },
    {
      label: 'Consistency',
      score: c.score,
      sub: (
        <>
          {c.iqr !== null && c.median !== null
            ? `IQR ${decimal.format(c.iqr)} m · ${percent.format(c.relIqr ?? 0)} of median ${decimal.format(c.median)} m`
            : null}
          {c.iqr !== null && c.median !== null && c.score === null ? ' · ' : null}
          {c.score === null ? withheldReason('consistency', c) : null}
        </>
      ),
    },
    {
      label: 'Direction',
      score: dir.score,
      sub:
        dir.measurementBasis === 'lateral' ? (
          <>
            P80 offline {dir.relLatP80 === null ? '—' : percent.format(dir.relLatP80)} of carry
            {dir.score === null && <> · {withheldReason('directionalControl', dir)}</>}
          </>
        ) : dir.measurementBasis === 'launch' ? (
          <>
            launch-only view (
            <span className="score-inline" data-band={scoreBand(dir.launchScore)}>
              {scoreText(dir.launchScore)}
            </span>
            ), not in the composite · {withheldReason('directionalControl', dir)}
          </>
        ) : (
          withheldReason('directionalControl', dir)
        ),
    },
    {
      label: 'Reliability',
      score: rel.score,
      sub: (
        <>
          {rel.mishitShare !== null ? `mishit ${percent.format(rel.mishitShare)}` : null}
          {rel.mishitShare !== null && rel.score === null ? ' · ' : null}
          {rel.score === null ? withheldReason('reliability', rel) : null}
        </>
      ),
    },
  ];
  const meta = (cat: CategoryRating) =>
    `${cat.n} shots · ${cat.visits} ${cat.visits === 1 ? 'visit' : 'visits'} · ${EVIDENCE_LABEL[cat.evidence] ?? cat.evidence}`;
  return (
    <div className="rating-breakdown">
      <p className="rating-overall" data-band={scoreBand(rating.composite.value)}>
        Overall <strong>{scoreText(rating.composite.value)}</strong>
        {rating.composite.provisional && (
          <span className="pill"> provisional · {rating.composite.coverage}/4 categories</span>
        )}
        {!rating.composite.provisional && rating.composite.value !== null && (
          <span className="context"> · all four categories</span>
        )}
        <HelpPopover label="Sample sizes, evidence and uncertainty behind these scores">
          <p>
            Weakest category evidence: {EVIDENCE_LABEL[weakest ?? 'none'] ?? weakest}.{' '}
            Ratings use the fixed {RATING_BASIS} rating basis ({RATINGS_VERSION}) — changing
            the display basis never changes them.
          </p>
          <p>Distance — {meta(d)}{d.reference && <> · reference: {REFERENCE_LABEL[d.reference.type]} {decimal.format(d.reference.valueM)} m{d.reference.statistic && d.reference.statistic !== 'other' ? ` (${REFERENCE_STATISTIC_LABEL[d.reference.statistic]})` : ''}{d.reference.match === 'family' ? ' · family-level basis' : ''}{d.reference.recordedOn ? ` · recorded ${d.reference.recordedOn}` : ''}</>}{!d.reference && d.p80 !== null && <> · no compatible reference</>}{withheldDetail('distancePotential', d) && <> · withheld: {withheldDetail('distancePotential', d)}</>}</p>
          <p>Consistency — {meta(c)}{withheldDetail('consistency', c) && <> · withheld: {withheldDetail('consistency', c)}</>}</p>
          <p>
            Direction — {meta(dir)}
            {dir.measurementBasis === 'lateral' && dir.corridorSuccess !== null && <> · corridor success {percent.format(dir.corridorSuccess)}</>}
            {dir.measurementBasis === 'launch' && dir.launchP80Deg !== null && <> · launch P80 {decimal.format(dir.launchP80Deg)}° (display only)</>}
            {withheldDetail('directionalControl', dir) && <> · withheld: {withheldDetail('directionalControl', dir)}</>}
          </p>
          <p>
            Reliability — {meta(rel)}
            {rel.mishitShare !== null && <> · {rel.assessed} assessed{rel.unassessed ? `, ${rel.unassessed} unassessed` : ''}</>}
            {rel.wilson && <> · Wilson 95% {percent.format(rel.wilson[0])}–{percent.format(rel.wilson[1])} (sampling only)</>}
            {rel.sensitivity && rel.sensitivity.allUnassessedMishit !== rel.sensitivity.allUnassessedClean && <> · if unassessed were mishits: down to {scoreText(rel.sensitivity.allUnassessedMishit)}</>}
            {withheldDetail('reliability', rel) && <> · withheld: {withheldDetail('reliability', rel)}</>}
          </p>
        </HelpPopover>
      </p>
      {rows.map((row) => (
        <ScoreBar
          key={row.label}
          label={row.label}
          score={row.score}
          sub={
            <>
              {row.sub}
              {noReference && referenceHref && row.label === 'Distance' && (
                <>
                  {' · '}
                  <a className="text-button" href={referenceHref}>
                    set a personal reference
                  </a>
                </>
              )}
            </>
          }
        />
      ))}
      {weakest === 'early' && (
        <p className="context">
          <Badge early>early estimate</Badge> small sample — treat as indicative, not validated.
        </p>
      )}
      <Disclosure summary="How this rating is calculated">
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
      </Disclosure>
    </div>
  );
}
