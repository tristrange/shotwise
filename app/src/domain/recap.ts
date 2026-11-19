import { reviewCoverage } from './analytics';
import {
  BASES,
  clubOrder,
  effectiveClub,
  fullSwingCandidate,
  isUnknownClub,
  shiftDate,
  venueKey,
  type Basis,
  type Dataset,
  type MetricKey,
  type Session,
  type Shot,
} from './model';
import { quantile } from './statistics';

const BASELINE_SESSIONS = 3;
const MIN_PRIOR_PER_SESSION = 5;
const MIN_LOWER_TAIL = 20;
const SUBSTANTIAL_SHARE_CHANGE = 0.25;

type SessionShots = { session: Session; shots: Shot[] };
type History = {
  current: SessionShots;
  earlier: SessionShots[];
  unresolved: SessionShots[];
};
type Observation<T> = {
  session: Session;
  value: T | null;
  measured: number;
  missing: number;
  shotIds: string[];
  unknownIntentShare: number | null;
  targetedShare: number | null;
};
type Shares = { left: number; straight: number; right: number };
type WithheldReason =
  | 'small-current-sample'
  | 'no-matching-history'
  | 'small-prior-sample'
  | 'too-few-prior-dates'
  | 'unresolved-chronology'
  | 'different-venue'
  | 'different-shot-mix'
  | 'different-measurement-coverage';
type Finding =
  | { kind: 'withheld'; reasons: WithheldReason[] }
  | { kind: 'not-noteworthy'; reason: 'below-threshold' | 'within-prior-range' }
  | { kind: 'higher' | 'lower' | 'mixed' };

const median = (values: number[]) => quantile(values, 0.5);

function newestSessions<T extends { session: Session }>(
  rows: T[],
  limit: number,
) {
  const cutoff = rows[limit - 1]?.session;
  if (!cutoff) return rows;
  const cutoffDate = rows.filter(({ session }) => session.date === cutoff.date);
  // An untimed session could fall anywhere on its date.
  const unorderedDate = cutoffDate.some(({ session }) => session.time === null);
  return rows.filter(
    ({ session }, index) =>
      index < limit ||
      (session.date === cutoff.date &&
        (unorderedDate || session.time === cutoff.time)),
  );
}

function observe<T>(
  { session, shots }: SessionShots,
  key: MetricKey,
  summarize: (values: number[]) => T | null,
): Observation<T> {
  const values: number[] = [];
  const shotIds: string[] = [];
  let unknownIntent = 0;
  let targeted = 0;
  for (const shot of shots) {
    const value = shot.measurements[key];
    if (value === null) continue;
    values.push(value);
    shotIds.push(shot.id);
    if (shot.review.intent === 'unknown') unknownIntent++;
    if ((shot.measurements.target ?? 0) > 0) targeted++;
  }
  const measured = values.length;
  return {
    session,
    value: summarize(values),
    measured,
    missing: shots.length - measured,
    shotIds,
    unknownIntentShare: measured ? unknownIntent / measured : null,
    targetedShare: measured ? targeted / measured : null,
  };
}

function compareMetric<T>(
  history: History,
  key: MetricKey,
  summarize: (values: number[]) => T | null,
  aggregate: (values: T[]) => T | null,
  minPrior = 1,
) {
  const current = observe(history.current, key, summarize);
  const prior = history.earlier.map((visit) => observe(visit, key, summarize));
  const venue = venueKey(current.session);
  const differentVenue = ({ session }: Observation<T>) => {
    const other = venueKey(session);
    return Boolean(venue && other && venue !== other);
  };
  const hasEvidence = ({ value, measured }: Observation<T>) =>
    value !== null && measured >= minPrior;
  const baselineSessions = newestSessions(
    prior.filter((sample) => hasEvidence(sample) && !differentVenue(sample)),
    BASELINE_SESSIONS,
  );
  const unresolved = history.unresolved
    .map((visit) => observe(visit, key, summarize))
    .filter((sample) => sample.measured > 0 && !differentVenue(sample));

  return {
    key,
    current,
    baseline: {
      value: aggregate(
        baselineSessions.flatMap(({ value }) =>
          value === null ? [] : [value],
        ),
      ),
      sessions: baselineSessions,
      measured: baselineSessions.reduce((n, sample) => n + sample.measured, 0),
      missing: baselineSessions.reduce((n, sample) => n + sample.missing, 0),
      dates: [...new Set(baselineSessions.map(({ session }) => session.date))],
    },
    previous: newestSessions(prior, 1),
    unresolved,
    differentVenue: newestSessions(
      prior.filter((sample) => hasEvidence(sample) && differentVenue(sample)),
      BASELINE_SESSIONS,
    ),
  };
}

type NumberComparison = ReturnType<typeof compareMetric<number>>;

function substantialChange(
  comparison: NumberComparison,
  share: (sample: Observation<number>) => number | null,
) {
  const current = share(comparison.current);
  const prior = median(
    comparison.baseline.sessions.flatMap((sample) => share(sample) ?? []),
  );
  return (
    current !== null &&
    prior !== null &&
    Math.abs(current - prior) >= SUBSTANTIAL_SHARE_CHANGE - Number.EPSILON
  );
}

function measurementShare(sample: Observation<number>) {
  const total = sample.measured + sample.missing;
  return total ? sample.measured / total : null;
}

function differentShotMix(comparison: NumberComparison) {
  return (
    substantialChange(comparison, (sample) => sample.unknownIntentShare) ||
    substantialChange(comparison, (sample) => sample.targetedShare)
  );
}

function mixedVenues(comparison: NumberComparison) {
  return (
    new Set(
      comparison.baseline.sessions
        .map(({ session }) => venueKey(session))
        .filter(Boolean),
    ).size > 1
  );
}

const HIGHLIGHT_RULES = {
  carry: { current: 10, prior: 20, metres: 5, fraction: 0.05 },
  spread: { current: 12, prior: 24, metres: 3, fraction: 0.2 },
};
type HighlightMetric = keyof typeof HIGHLIGHT_RULES;

function minimumChange(metric: HighlightMetric, reference: number) {
  const { metres, fraction } = HIGHLIGHT_RULES[metric];
  return Math.max(metres, Math.abs(reference) * fraction);
}

function withFinding(comparison: NumberComparison, metric: HighlightMetric) {
  const { current, baseline, previous, unresolved, differentVenue } =
    comparison;
  const rule = HIGHLIGHT_RULES[metric];
  const sparseHistory =
    baseline.measured < rule.prior || baseline.dates.length < 2;
  const reasons: WithheldReason[] = [];
  if (current.measured < rule.current) reasons.push('small-current-sample');
  if (!previous.length && !unresolved.length)
    reasons.push('no-matching-history');
  if (baseline.measured < rule.prior) reasons.push('small-prior-sample');
  if (baseline.dates.length < 2) reasons.push('too-few-prior-dates');
  if (unresolved.length) reasons.push('unresolved-chronology');
  if (mixedVenues(comparison) || (differentVenue.length && sparseHistory)) {
    reasons.push('different-venue');
  }
  if (differentShotMix(comparison)) reasons.push('different-shot-mix');
  if (substantialChange(comparison, measurementShare)) {
    reasons.push('different-measurement-coverage');
  }

  const observed = current.value;
  const reference = baseline.value;
  const delta =
    observed === null || reference === null ? null : observed - reference;
  let finding: Finding;
  if (reasons.length) {
    finding = { kind: 'withheld', reasons };
  } else if (
    delta === null ||
    reference === null ||
    observed === null ||
    Math.abs(delta) < minimumChange(metric, reference)
  ) {
    finding = { kind: 'not-noteworthy', reason: 'below-threshold' };
  } else if (
    baseline.sessions.some(
      ({ value }) =>
        value !== null && (delta > 0 ? observed <= value : observed >= value),
    )
  ) {
    finding = { kind: 'not-noteworthy', reason: 'within-prior-range' };
  } else {
    finding = { kind: delta > 0 ? 'higher' : 'lower' };
  }
  return { ...comparison, delta, finding };
}

function carryIqr(values: number[]) {
  if (values.length < 4) return null;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return q1 === null || q3 === null ? null : q3 - q1;
}

function directionShares(values: number[]): Shares | null {
  if (!values.length) return null;
  return {
    left: values.filter((value) => value < 0).length / values.length,
    straight: values.filter((value) => value === 0).length / values.length,
    right: values.filter((value) => value > 0).length / values.length,
  };
}

function meanShares(values: Shares[]): Shares | null {
  if (!values.length) return null;
  return {
    left: values.reduce((sum, value) => sum + value.left, 0) / values.length,
    straight:
      values.reduce((sum, value) => sum + value.straight, 0) / values.length,
    right: values.reduce((sum, value) => sum + value.right, 0) / values.length,
  };
}

function filterHistory(
  history: History,
  include: (shot: Shot) => boolean,
): History {
  const select = ({ session, shots }: SessionShots) => ({
    session,
    shots: shots.filter(include),
  });
  return {
    current: select(history.current),
    earlier: history.earlier
      .map(select)
      .filter(({ shots }) => shots.length > 0),
    unresolved: history.unresolved
      .map(select)
      .filter(({ shots }) => shots.length > 0),
  };
}

function clubRecap(club: string, history: History, basis: Basis) {
  const fields = BASES[basis];
  const reliability = filterHistory(history, fullSwingCandidate);
  const broader = filterHistory(
    reliability,
    ({ review }) => review.contact !== 'mishit',
  );
  const reviewed = filterHistory(
    broader,
    ({ review }) => review.intent === 'full' && review.contact === 'typical',
  );
  const compareCarry = (
    cohort: History,
    summarize: (values: number[]) => number | null,
    minPrior = MIN_PRIOR_PER_SESSION,
  ) => compareMetric(cohort, fields.carry, summarize, median, minPrior);
  const carry = (cohort: History) =>
    withFinding(compareCarry(cohort, median), 'carry');
  const reviewedCarry = carry(reviewed);
  const broaderCarry = carry(broader);
  const p10 = compareCarry(
    reliability,
    (values) =>
      values.length >= MIN_LOWER_TAIL ? quantile(values, 0.1) : null,
    MIN_LOWER_TAIL,
  );
  const spread = withFinding(compareCarry(reliability, carryIqr), 'spread');
  if (
    spread.finding.kind === 'lower' &&
    p10.current.value !== null &&
    p10.baseline.value !== null &&
    p10.current.value < p10.baseline.value &&
    !p10.unresolved.length &&
    !mixedVenues(p10) &&
    !substantialChange(p10, measurementShare) &&
    !differentShotMix(p10)
  ) {
    spread.finding = { kind: 'mixed' };
  }
  const contact = reviewCoverage(reliability.current.shots);
  const full = contact.fullReviewed + contact.unassessed;
  const flight = (key: MetricKey) =>
    compareMetric(reliability, key, median, median);
  const direction = (key: MetricKey) =>
    compareMetric(reliability, key, directionShares, meanShares);
  const preferred: 'reviewed' | 'broader' =
    reviewedCarry.finding.kind === 'withheld' ? 'broader' : 'reviewed';

  return {
    club,
    included: history.current.shots.length,
    potential: {
      preferred,
      reviewed: reviewedCarry,
      broader: broaderCarry,
    },
    reliability: {
      spread,
      p10,
      contact: {
        full,
        reviewed: contact.fullReviewed,
        mishits: contact.mishits,
        rate: contact.rate,
        reviewedShare: full ? contact.fullReviewed / full : null,
      },
    },
    flight: {
      speed: flight(fields.speed),
      launch: flight(fields.launch),
      apex: flight(fields.apex),
      launchDirection: direction('launchDirection'),
      curve: direction('curve'),
      lateral: direction('fromCentre'),
    },
  };
}

type ClubRecap = ReturnType<typeof clubRecap>;

function recapHighlights(clubs: ClubRecap[]) {
  const ranked = clubs
    .flatMap(({ club, potential, reliability }) => {
      const comparisons = {
        carry: potential[potential.preferred],
        spread: reliability.spread,
      };
      return (['carry', 'spread'] satisfies HighlightMetric[]).flatMap(
        (metric) => {
          const { finding, delta, baseline } = comparisons[metric];
          if (
            finding.kind === 'withheld' ||
            finding.kind === 'not-noteworthy' ||
            delta === null ||
            baseline.value === null
          )
            return [];
          return [
            {
              club,
              metric,
              kind: finding.kind,
              delta,
              strength: Math.abs(delta) / minimumChange(metric, baseline.value),
              positive:
                metric === 'carry'
                  ? finding.kind === 'higher'
                  : finding.kind === 'lower',
            },
          ];
        },
      );
    })
    .sort((a, b) => b.strength - a.strength);
  const highlights = ranked.slice(0, 3);
  const first = highlights[0];
  if (
    first &&
    highlights.every(({ positive }) => positive === first.positive)
  ) {
    const other = ranked.find(({ positive }) => positive !== first.positive);
    if (other) highlights.splice(2, 1, other);
  }
  return highlights.map(({ club, metric, kind, delta }) => ({
    club,
    metric,
    kind,
    delta,
  }));
}

function compareStarts(a: Session, b: Session) {
  return (
    a.date.localeCompare(b.date) ||
    (a.time !== null && b.time !== null ? a.time.localeCompare(b.time) : 0)
  );
}

/** Compare the selected session using only the evidence available before it. */
export function sessionRecap(data: Dataset, sessionId: string, basis: Basis) {
  const session = data.sessions.find(
    (item) => item.id === sessionId && !item.archived,
  );
  if (!session) return null;
  const start = shiftDate(session.date, -59);
  const candidates = data.sessions
    .filter(
      (item) => !item.archived && item.id !== session.id && item.date >= start,
    )
    .map((item) => ({ session: item, order: compareStarts(item, session) }))
    .filter(({ order }) => order <= 0)
    .sort(
      ({ session: a }, { session: b }) =>
        b.date.localeCompare(a.date) ||
        (b.time ?? '').localeCompare(a.time ?? '') ||
        a.id.localeCompare(b.id),
    );
  const included = new Map(
    [session, ...candidates.map((candidate) => candidate.session)].map(
      (item) => [item.id, new Map<string, Shot[]>()],
    ),
  );
  let recorded = 0;
  let includedCount = 0;
  for (const shot of data.shots) {
    if (shot.sessionId === session.id) recorded++;
    const groups = included.get(shot.sessionId);
    if (!groups || shot.review.exclusion.kind === 'excluded') continue;
    if (shot.sessionId === session.id) includedCount++;
    const club = effectiveClub(shot);
    const group = groups.get(club) ?? [];
    group.push(shot);
    groups.set(club, group);
  }
  for (const groups of included.values()) {
    for (const shots of groups.values()) {
      shots.sort((a, b) => a.rowIndex - b.rowIndex || a.id.localeCompare(b.id));
    }
  }

  const current = included.get(session.id) ?? new Map<string, Shot[]>();
  const clubs = [...current.keys()]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b))
    .map((club) => {
      const history: History = {
        current: { session, shots: current.get(club) ?? [] },
        earlier: [],
        unresolved: [],
      };
      for (const { session: candidate, order } of candidates) {
        const shots = included.get(candidate.id)?.get(club);
        if (!shots) continue;
        (order < 0 ? history.earlier : history.unresolved).push({
          session: candidate,
          shots,
        });
      }
      return clubRecap(club, history, basis);
    });

  return {
    session,
    basis,
    basisLabel: BASES[basis].label,
    recorded,
    included: includedCount,
    clubs,
    highlights: recapHighlights(clubs),
  };
}
