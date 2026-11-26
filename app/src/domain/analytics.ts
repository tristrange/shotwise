import { quantile } from './statistics';
import {
  isFullSwingResolved,
  resolvedClub,
  resolveShots,
  type ResolvedShot,
} from './assessment';
import { assessUnusualShots } from './unusualShots';
import {
  BASES,
  clubOrder,
  effectiveClub,
  isUnknownClub,
  isWedge,
  shiftDate,
  venueKey,
  type Basis,
  type Dataset,
  type MetricKey,
  type Review,
  type Session,
  type Shot,
} from './model';

export type AnalysisQuery = {
  mode: 'recent' | 'all';
  today: string;
  intent: Review['intent'] | 'all';
  /**
   * Performance mode (roadmap §6.1): 'all' keeps every included shot,
   * 'typical' keeps resolved typical-contact shots, 'strong' keeps only
   * strong strikes — full swings at or above the club's P80 carry.
   */
  contact: 'all' | 'typical' | 'strong';
  club?: string;
  hideLikelyMishits?: boolean;
  /**
   * Optional single-visit scope (e.g. the Explorer's named session): applied
   * before strong-strike thresholds are computed, so P80 and the minimum
   * sample come from the scoped visit's own population. Assessment resolution
   * still sees the full history.
   */
  scopeSessionId?: string;
};
export type AnalysisSettings = Pick<
  AnalysisQuery,
  'mode' | 'intent' | 'contact' | 'hideLikelyMishits'
> & {
  basis: Basis;
};
export const RULE_VERSION = 'club-label-1';

/** P80 is the recommended robust upper-tail estimator (roadmap §6.2, ADR-0002). */
export const POTENTIAL_QUANTILE = 0.8;
/** Minimum measured carries before a strong-strike (P80) threshold exists. */
export const MIN_POTENTIAL_SAMPLES = 10;
/** P80 carry of a value list — the strong-strike ("distance potential") estimate. */
export function potentialCarry(values: number[]): number | null {
  if (values.length < MIN_POTENTIAL_SAMPLES) return null;
  return quantile(values, POTENTIAL_QUANTILE);
}
export function metricStats(shots: Shot[], key: MetricKey) {
  const values = shots.flatMap((s) =>
    s.measurements[key] === null ? [] : [s.measurements[key]],
  );
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return {
    n,
    missing: shots.length - n,
    median: quantile(values, 0.5),
    mean,
    sd:
      n >= 2 && mean !== null
        ? Math.sqrt(
            values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1),
          )
        : null,
    iqr: n >= 4 && q1 !== null && q3 !== null ? q3 - q1 : null,
    p10: n >= 10 ? quantile(values, 0.1) : null,
    p80: n >= 10 ? quantile(values, 0.8) : null,
    p90: n >= 10 ? quantile(values, 0.9) : null,
  };
}
export function directionStats(shots: Shot[], key: MetricKey) {
  const values = shots.flatMap((s) =>
    s.measurements[key] === null ? [] : [s.measurements[key]],
  );
  return {
    n: values.length,
    missing: shots.length - values.length,
    left: values.filter((v) => v < 0).length,
    straight: values.filter((v) => v === 0).length,
    right: values.filter((v) => v > 0).length,
    median: quantile(values, 0.5),
  };
}

export function summarize(shots: Shot[], basis: Basis) {
  const fields = BASES[basis];
  return {
    n: shots.length,
    sessions: new Set(shots.map((s) => s.sessionId)).size,
    carry: metricStats(shots, fields.carry),
    total: metricStats(shots, fields.total),
    speed: metricStats(shots, fields.speed),
    launch: metricStats(shots, fields.launch),
    apex: metricStats(shots, fields.apex),
    launchDirection: directionStats(shots, 'launchDirection'),
    curve: directionStats(shots, 'curve'),
    lateral: directionStats(shots, 'fromCentre'),
  };
}
/**
 * The shared analysis cohort (ADR-0001): included shots of non-archived
 * sessions, narrowed by the query. Intent, contact and club are read through
 * the resolved assessment layer, so automatic classifications apply whenever
 * the user has not reviewed a shot — review is optional. Shots whose recorded
 * club is suspected wrong are excluded from club-specific views (query.club)
 * but kept in session-wide views; the recorded label is never reassigned.
 */
export function selectCohort(
  shots: Shot[],
  sessions: Session[],
  query: AnalysisQuery,
  basis: Basis = 'premium-flat',
): Shot[] {
  const sessionMap = new Map(
    sessions.filter((s) => !s.archived).map((s) => [s.id, s]),
  );
  const resolved = resolveShots(shots, sessions, basis);
  const clubOf = (s: Shot) => {
    const r = resolved.get(s.id);
    return r ? resolvedClub(r) : effectiveClub(s);
  };
  let selected = shots.filter(
    (s) =>
      sessionMap.has(s.sessionId) && s.review.exclusion.kind === 'included',
  );
  if (query.mode === 'recent') {
    const start = shiftDate(query.today, -59);
    selected = selected.filter((s) => {
      const date = sessionMap.get(s.sessionId)?.date;
      return date !== undefined && date >= start && date <= query.today;
    });
    // The per-club recency cap runs over benchmark-eligible shots only, so a
    // suspected wrong-club row cannot displace valid older rows inside the
    // window; suspected rows stay in session-wide views with their label.
    const perClub = new Map<string, Shot[]>();
    const suspected: Shot[] = [];
    for (const shot of selected) {
      const r = resolved.get(shot.id);
      if (r?.suspectedWrongClub) {
        suspected.push(shot);
        continue;
      }
      const club = clubOf(shot);
      const group = perClub.get(club) ?? [];
      group.push(shot);
      perClub.set(club, group);
    }
    const capped = [...perClub.values()].flatMap((group) => {
      const sorted = [...group].sort((a, b) =>
        (sessionMap.get(b.sessionId)?.date ?? '').localeCompare(
          sessionMap.get(a.sessionId)?.date ?? '',
        ),
      );
      const boundary = sorted[49];
      if (!boundary) return sorted;
      const cutoff = sessionMap.get(boundary.sessionId)?.date ?? '';
      return sorted.filter(
        (s) => (sessionMap.get(s.sessionId)?.date ?? '') >= cutoff,
      );
    });
    selected = [...capped, ...suspected];
  }
  if (query.scopeSessionId)
    selected = selected.filter((s) => s.sessionId === query.scopeSessionId);
  // Strong-strike mode already excludes mishits via its own contact check, so
  // the mishit filter is normalized off to keep that view purely about strike
  // strength rather than silently dropping auto-flagged unusual shots too.
  const hideMishits = query.contact === 'strong' ? false : query.hideLikelyMishits;
  const assessments = hideMishits ? assessUnusualShots(shots, sessions) : null;
  // Strong-strike mode: per-club P80 thresholds over the typical full-swing
  // population of the current selection (after any visit scope, so thresholds
  // come from the scoped visit); clubs below the minimum sample have no
  // threshold and drop out of this view (marked unreliable elsewhere).
  const strongThresholds =
    query.contact === 'strong'
      ? strongStrikeThresholds(selected, resolved, clubOf, basis)
      : null;
  return selected.filter((s) => {
    const r = resolved.get(s.id);
    if (!r) return false;
    const assessment = assessments?.get(s.id);
    const club = clubOf(s);
    const carry = s.measurements[BASES[basis].carry];
    const threshold = strongThresholds?.get(club);
    const strong =
      threshold !== undefined &&
      isFullSwingResolved(r) &&
      r.contact !== 'mishit' &&
      !r.suspectedWrongClub &&
      !isUnknownClub(club) &&
      carry !== null &&
      carry > 0 &&
      threshold <= carry;
    return (
      (!hideMishits ||
        (r.contact !== 'mishit' &&
          !(assessment?.kind === 'assessed' && assessment.unusual))) &&
      (!query.club ||
        (club === query.club && !r.suspectedWrongClub)) &&
      (query.intent === 'all' || r.intent === query.intent) &&
      (query.contact === 'all' ||
        (query.contact === 'typical' && r.contact === 'typical') ||
        (query.contact === 'strong' && strong))
    );
  });
}

/**
 * Shared club-benchmark eligibility (ADR-0001): a resolved shot enters
 * club-specific benchmarks only with a known resolved club and no
 * exclusion-grade wrong-club suspicion. Session-wide views keep suspected
 * rows under their recorded label.
 */
export function clubBenchmarkEligible(r: ResolvedShot): boolean {
  return !r.suspectedWrongClub && !isUnknownClub(resolvedClub(r));
}

/** Group selected shots by resolved club for club benchmarks, dropping suspected and unknown rows. */
export function benchmarkClubGroups(
  shots: Shot[],
  resolved: Map<string, ResolvedShot>,
): Map<string, Shot[]> {
  const groups = new Map<string, Shot[]>();
  for (const shot of shots) {
    const r = resolved.get(shot.id);
    if (!r || !clubBenchmarkEligible(r)) continue;
    const club = resolvedClub(r);
    const group = groups.get(club) ?? [];
    group.push(shot);
    groups.set(club, group);
  }
  return groups;
}

/**
 * Per-club P80 carry thresholds over the typical (resolved full-swing,
 * non-mishit, known-club, non-suspected) population — the strong-strike
 * boundary used by the 'strong' performance mode (ADR-0002).
 */
function strongStrikeThresholds(
  selected: Shot[],
  resolved: Map<string, ResolvedShot>,
  clubOf: (s: Shot) => string,
  basis: Basis,
): Map<string, number> {
  const key = BASES[basis].carry;
  const byClub = new Map<string, number[]>();
  for (const shot of selected) {
    const r = resolved.get(shot.id);
    if (!r) continue;
    const club = clubOf(shot);
    const carry = shot.measurements[key];
    if (
      !isFullSwingResolved(r) ||
      r.contact === 'mishit' ||
      r.suspectedWrongClub ||
      isUnknownClub(club) ||
      (carry ?? 0) <= 0
    )
      continue;
    byClub.set(club, [...(byClub.get(club) ?? []), carry!]);
  }
  const thresholds = new Map<string, number>();
  for (const [club, values] of byClub) {
    const threshold = potentialCarry(values);
    if (threshold !== null) thresholds.set(club, threshold);
  }
  return thresholds;
}
/**
 * Review coverage of a shot set, plus how much of the rest the automatic
 * layer assessed when a resolved map is supplied. Manual review stays the
 * authoritative measure; `assessed`/`automatic` show that analytics no longer
 * depend on review being complete.
 *
 * `unassessed` is manual-review-only (full swings the golfer has not reviewed);
 * `unassessedResolved` is the resolved-cohort counterpart used by the
 * reliability score (full swings whose resolved contact is still uncertain,
 * manual or automatic). The two denominators answer different questions and
 * must not be mixed.
 */
export function reviewCoverage(
  shots: Shot[],
  resolved?: Map<string, ResolvedShot>,
) {
  const eligible = shots.filter((s) => s.review.exclusion.kind === 'included');
  const reviewed = eligible.filter((s) => s.review.contact !== 'uncertain');
  const full = reviewed.filter((s) => s.review.intent === 'full');
  const mishits = full.filter((s) => s.review.contact === 'mishit').length;
  const resolvedContact = (s: Shot) => resolved?.get(s.id)?.contact;
  const assessed = resolved
    ? eligible.filter((s) => {
        const contact = resolvedContact(s);
        return contact !== undefined && contact !== 'uncertain';
      })
    : reviewed;
  const automatic = resolved
    ? eligible.filter(
        (s) =>
          s.review.contact === 'uncertain' &&
          resolvedContact(s) !== undefined &&
          resolvedContact(s) !== 'uncertain',
      )
    : [];
  return {
    total: eligible.length,
    reviewed: reviewed.length,
    fullReviewed: full.length,
    mishits,
    rate: full.length ? mishits / full.length : null,
    unassessed: eligible.filter(
      (s) => s.review.intent === 'full' && s.review.contact === 'uncertain',
    ).length,
    unassessedResolved: resolved
      ? eligible.filter((s) => {
          const r = resolved.get(s.id);
          return r !== undefined && r.intent === 'full' && r.contact === 'uncertain';
        }).length
      : null,
    assessed: assessed.length,
    automatic: automatic.length,
  };
}
export type ClubFlag = {
  shotId: string;
  baselineCount: number;
  sessions: number;
  carryMedian: number;
  speedMedian: number;
  carryThreshold: number;
  speedThreshold: number;
  ruleVersion: string;
};
export function clubFlags(
  shots: Shot[],
  sessions: Session[],
): Map<string, ClubFlag> {
  const sessionMap = new Map(
    sessions.filter((s) => !s.archived).map((s) => [s.id, s]),
  );
  const ordered = [...shots]
    .filter((s) => sessionMap.has(s.sessionId))
    .sort((a, b) => {
      const sa = sessionMap.get(a.sessionId);
      const sb = sessionMap.get(b.sessionId);
      return (
        (sa?.date ?? '').localeCompare(sb?.date ?? '') ||
        (sa?.time ?? '').localeCompare(sb?.time ?? '') ||
        a.sessionId.localeCompare(b.sessionId) ||
        a.rowIndex - b.rowIndex
      );
    });
  const flags = new Map<string, ClubFlag>();
  const past = new Map<string, Shot[]>();
  for (const shot of ordered) {
    const club = effectiveClub(shot);
    const session = sessionMap.get(shot.sessionId);
    if (
      !session ||
      isWedge(club) ||
      isUnknownClub(club) ||
      shot.review.intent !== 'full' ||
      shot.review.exclusion.kind === 'excluded' ||
      shot.review.contact === 'mishit'
    )
      continue;
    const candidates = (past.get(club) ?? []).filter((s) => {
      const other = sessionMap.get(s.sessionId);
      if (!other || other.date < shiftDate(session.date, -59)) return false;
      return (
        other.date < session.date ||
        (s.sessionId === shot.sessionId && s.rowIndex < shot.rowIndex) ||
        (other.time !== null &&
          session.time !== null &&
          other.time < session.time)
      );
    });
    const boundary = candidates.at(-50);
    const cutoff = boundary
      ? sessionMap.get(boundary.sessionId)?.date
      : undefined;
    const baseline = cutoff
      ? candidates.filter(
          (s) => (sessionMap.get(s.sessionId)?.date ?? '') >= cutoff,
        )
      : candidates;
    const count = new Set(baseline.map((s) => s.sessionId)).size;
    if (
      shot.review.club.kind === 'unreviewed' &&
      baseline.length >= 30 &&
      count >= 3
    ) {
      const carry = baseline.flatMap((s) =>
        s.measurements.flatCarryRange === null
          ? []
          : [s.measurements.flatCarryRange],
      );
      const speed = baseline.flatMap((s) =>
        s.measurements.speedRange === null ? [] : [s.measurements.speedRange],
      );
      const carryMedian = quantile(carry, 0.5);
      const speedMedian = quantile(speed, 0.5);
      if (
        carry.length >= 30 &&
        speed.length >= 30 &&
        carryMedian !== null &&
        speedMedian !== null
      ) {
        const carryMad =
          quantile(
            carry.map((v) => Math.abs(v - carryMedian)),
            0.5,
          ) ?? 0;
        const speedMad =
          quantile(
            speed.map((v) => Math.abs(v - speedMedian)),
            0.5,
          ) ?? 0;
        const carryThreshold = carryMedian + 4 * 1.4826 * carryMad;
        const speedThreshold = speedMedian + 4 * 1.4826 * speedMad;
        if (
          carryMad > 0 &&
          speedMad > 0 &&
          shot.measurements.flatCarryRange !== null &&
          shot.measurements.speedRange !== null &&
          shot.measurements.flatCarryRange > carryThreshold &&
          shot.measurements.speedRange > speedThreshold
        )
          flags.set(shot.id, {
            shotId: shot.id,
            baselineCount: baseline.length,
            sessions: count,
            carryMedian,
            speedMedian,
            carryThreshold,
            speedThreshold,
            ruleVersion: RULE_VERSION,
          });
      }
    }
    if (
      !flags.has(shot.id) &&
      shot.measurements.flatCarryRange !== null &&
      shot.measurements.speedRange !== null
    ) {
      const group = past.get(club) ?? [];
      group.push(shot);
      past.set(club, group);
    }
  }
  return flags;
}

export type MostImproved = {
  club: string;
  delta: number;
  recentMedian: number;
  baselineMedian: number;
  recentShots: number;
  baselineShots: number;
  recentDate: string;
};

const MIN_RECENT_SHOTS = 3;
const MIN_BASELINE_SHOTS = 10;

/** Club with the biggest carry gain in the latest session versus its earlier sessions. */
export function mostImprovedClub(
  data: Dataset,
  basis: Basis,
): MostImproved | null {
  const sessions = new Map(
    data.sessions.filter((s) => !s.archived).map((s) => [s.id, s]),
  );
  const included = data.shots.filter(
    (s) =>
      sessions.has(s.sessionId) && s.review.exclusion.kind === 'included',
  );
  const latest = [...sessions.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (b.time ?? '').localeCompare(a.time ?? '') ||
      b.id.localeCompare(a.id),
  )[0];
  if (!latest) return null;

  const resolved = resolveShots(data.shots, data.sessions, basis);
  // Club-specific benchmark: suspected wrong-club labels stay out (ADR-0001).
  const benchmark = included.filter(
    (s) => resolved.get(s.id)?.suspectedWrongClub !== true,
  );
  const clubOf = (s: Shot) => {
    const r = resolved.get(s.id);
    return r ? resolvedClub(r) : effectiveClub(s);
  };
  const recent = benchmark.filter((s) => s.sessionId === latest.id);
  const earlier = benchmark.filter((s) => {
    const session = sessions.get(s.sessionId);
    return (
      session !== undefined && session.id !== latest.id && session.date <= latest.date
    );
  });
  const key = BASES[basis].carry;
  const values = (shots: Shot[]) =>
    shots.flatMap((s) =>
      s.measurements[key] === null ? [] : [s.measurements[key]],
    );

  let best: MostImproved | null = null;
  for (const club of new Set(recent.map(clubOf))) {
    if (isUnknownClub(club)) continue;
    const recentValues = values(recent.filter((s) => clubOf(s) === club));
    const baselineValues = values(earlier.filter((s) => clubOf(s) === club));
    if (
      recentValues.length < MIN_RECENT_SHOTS ||
      baselineValues.length < MIN_BASELINE_SHOTS
    )
      continue;
    const recentMedian = quantile(recentValues, 0.5);
    const baselineMedian = quantile(baselineValues, 0.5);
    if (recentMedian === null || baselineMedian === null) continue;
    const delta = recentMedian - baselineMedian;
    if (delta <= 0) continue;
    if (!best || delta > best.delta)
      best = {
        club,
        delta,
        recentMedian,
        baselineMedian,
        recentShots: recentValues.length,
        baselineShots: baselineValues.length,
        recentDate: latest.date,
      };
  }
  return best;
}

/**
 * Shots that can be compared per club: resolved full swing, resolved
 * non-mishit contact, a resolved known club with carry on this basis, and not
 * a suspected wrong-club label (excluded from club benchmarks per ADR-0001).
 */
function eligibleShots(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): Shot[] {
  const key = BASES[basis].carry;
  const resolved = resolveShots(data.shots, data.sessions, basis);
  return selectCohort(data.shots, data.sessions, query, basis).filter(
    (shot) => {
      const r = resolved.get(shot.id);
      return (
        r !== undefined &&
        isFullSwingResolved(r) &&
        r.contact !== 'mishit' &&
        !r.suspectedWrongClub &&
        (shot.measurements[key] ?? 0) > 0 &&
        !isUnknownClub(resolvedClub(r))
      );
    },
  );
}

export type ClubGap = {
  club: string;
  n: number;
  median: number;
  low: number | null;
  high: number | null;
  /** IQR quartiles of the mode-invariant band cohort (null below 4 measured). */
  q1: number | null;
  q3: number | null;
  /** P80 carry — the strong-strike ("distance potential") estimate (ADR-0002). */
  potential: number | null;
  reliable: boolean;
  gap: number | null;
  flag: 'large' | 'small' | 'reversed' | null;
};

const MIN_GAP_SAMPLES = 10;
const LARGE_GAP_M = 30;
const SMALL_GAP_M = 10;

/** Approved adjacent-gap rule thresholds — surfaced verbatim in UI help text, never re-derived there. */
export const GAP_THRESHOLDS = {
  minSamples: MIN_GAP_SAMPLES,
  smallM: SMALL_GAP_M,
  largeM: LARGE_GAP_M,
} as const;

/** Carry bands and median gaps against the next club down. */
export function clubGaps(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): ClubGap[] {
  const key = BASES[basis].carry;
  const resolved = resolveShots(data.shots, data.sessions, basis);
  const groups = new Map<string, Shot[]>();
  for (const shot of eligibleShots(data, basis, query)) {
    const r = resolved.get(shot.id);
    if (!r) continue;
    const club = resolvedClub(r);
    groups.set(club, [...(groups.get(club) ?? []), shot]);
  }
  // P80 (distance potential) and the spread band (P10–P90) are computed once
  // per club from the mode-invariant eligible cohort — never from the
  // strong-filtered subset — so neither changes with the selected performance
  // mode (ADR-0002). The median still follows the selected mode.
  const potentialCarries = new Map<string, number[]>();
  const bandGroups = new Map<string, Shot[]>();
  for (const shot of eligibleShots(data, basis, {
    ...query,
    contact: 'all',
    hideLikelyMishits: false,
  })) {
    const r = resolved.get(shot.id);
    if (!r) continue;
    const carry = shot.measurements[key];
    if ((carry ?? 0) <= 0) continue; // zero/negative carries are missing, not distances
    const club = resolvedClub(r);
    potentialCarries.set(club, [...(potentialCarries.get(club) ?? []), carry!]);
    bandGroups.set(club, [...(bandGroups.get(club) ?? []), shot]);
  }

  const rows: ClubGap[] = [...groups]
    .map(([club, shots]) => {
      const stats = metricStats(shots, key);
      const bandShots = bandGroups.get(club) ?? [];
      const band = metricStats(bandShots, key);
      // IQR quartiles come from the same band cohort as low/high (P10–P90),
      // guarded like `iqr` by the 4-measured minimum.
      const bandValues = bandShots.flatMap((s) =>
        s.measurements[key] === null ? [] : [s.measurements[key]],
      );
      return {
        club,
        n: stats.n,
        median: stats.median ?? 0,
        low: band.p10,
        high: band.p90,
        q1: band.n >= 4 ? quantile(bandValues, 0.25) : null,
        q3: band.n >= 4 ? quantile(bandValues, 0.75) : null,
        potential: potentialCarry(potentialCarries.get(club) ?? []),
        reliable: band.n >= MIN_GAP_SAMPLES,
        gap: null,
        flag: null,
      };
    })
    .sort(
      (a, b) =>
        clubOrder(a.club) - clubOrder(b.club) || a.club.localeCompare(b.club),
    );

  for (let i = 1; i < rows.length; i++) {
    const upper = rows[i - 1];
    const lower = rows[i];
    if (!upper || !lower) continue;
    const gap = upper.median - lower.median;
    lower.gap = gap;
    if (!upper.reliable || !lower.reliable) continue;
    if (gap < 0) lower.flag = 'reversed';
    else if (gap <= SMALL_GAP_M) lower.flag = 'small';
    else if (gap > LARGE_GAP_M) lower.flag = 'large';
  }
  return rows;
}

type PracticeCarry = {
  club: string;
  median: number;
  iqr: number;
  missing: number;
  shotIds: string[];
};

export type PracticeEvidence = {
  session: Session;
  key: MetricKey;
  shotIds: string[];
} & (
  | {
      kind: 'gapping';
      longer: PracticeCarry;
      shorter: PracticeCarry;
      gap: number;
    }
  | { kind: 'inconsistency'; carry: PracticeCarry }
  | {
      kind: 'direction';
      club: string;
      side: 'left' | 'right';
      count: number;
      missing: number;
    }
);

export type PracticeInsight = {
  id: string;
  dates: number;
  shots: number;
  improving: boolean;
  evidence: [PracticeEvidence, ...PracticeEvidence[]];
};

const MIN_INSIGHT_SHOTS = 10;
const WIDE_CARRY_SHARE = 0.25;
const ONE_SIDED_CURVE_SHARE = 0.7;

type PracticeObservation = {
  evidence: PracticeEvidence;
  severity: number;
  supports: boolean;
  clear: boolean;
};

function compareVisits(a: Session, b: Session) {
  return (
    b.date.localeCompare(a.date) ||
    (b.time ?? '').localeCompare(a.time ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/** Rank recurring patterns from comparable whole visits in the selected window. */
export function practiceInsights(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): PracticeInsight[] {
  const key = BASES[basis].carry;
  const start = query.mode === 'recent' ? shiftDate(query.today, -59) : '';
  const sessions = new Map(
    data.sessions
      .filter(
        ({ archived, date }) =>
          !archived && date >= start && date <= query.today,
      )
      .map((session) => [session.id, session]),
  );
  const visits = new Map<string, Map<string, Shot[]>>();
  const carryClubs = new Set<string>();
  const resolved = resolveShots(data.shots, data.sessions, basis);

  // Use the review filters without the rolling chart's per-club shot cap.
  for (const shot of selectCohort(
    data.shots,
    data.sessions,
    {
      ...query,
      mode: 'all',
    },
    basis,
  )) {
    const r = resolved.get(shot.id);
    if (
      !r ||
      !sessions.has(shot.sessionId) ||
      !isFullSwingResolved(r) ||
      r.contact === 'mishit' ||
      r.suspectedWrongClub
    )
      continue;
    const club = resolvedClub(r);
    if (isUnknownClub(club)) continue;
    const groups = visits.get(shot.sessionId) ?? new Map<string, Shot[]>();
    const group = groups.get(club) ?? [];
    group.push(shot);
    groups.set(club, group);
    visits.set(shot.sessionId, groups);
    if ((shot.measurements[key] ?? 0) > 0) carryClubs.add(club);
  }

  const order = [...carryClubs].sort(
    (a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b),
  );
  const patterns = new Map<
    string,
    { id: string; observations: PracticeObservation[] }
  >();
  function record(
    evidence: PracticeEvidence,
    severity: number,
    supports: boolean,
    clear = !supports,
  ) {
    const clubs =
      evidence.kind === 'gapping'
        ? [evidence.longer.club, evidence.shorter.club]
        : [evidence.kind === 'direction' ? evidence.club : evidence.carry.club];
    const id = JSON.stringify([evidence.kind, ...clubs]);
    const groupKey = JSON.stringify([
      id,
      venueKey(evidence.session),
      evidence.kind === 'direction' ? evidence.side : '',
    ]);
    const pattern = patterns.get(groupKey) ?? { id, observations: [] };
    pattern.observations.push({ evidence, severity, supports, clear });
    patterns.set(groupKey, pattern);
  }

  for (const [sessionId, groups] of visits) {
    const session = sessions.get(sessionId);
    if (!session) continue;
    const carries = new Map<string, PracticeCarry>();
    for (const [club, shots] of groups) {
      shots.sort((a, b) => a.rowIndex - b.rowIndex || a.id.localeCompare(b.id));
      const carry = metricStats(shots, key);
      if (
        carry.n >= MIN_INSIGHT_SHOTS &&
        carry.median !== null &&
        carry.iqr !== null
      ) {
        const shotIds = shots
          .filter((shot) => (shot.measurements[key] ?? 0) > 0)
          .map(({ id }) => id);
        const measured = {
          club,
          median: carry.median,
          iqr: carry.iqr,
          missing: carry.missing,
          shotIds,
        };
        carries.set(club, measured);
        if (carry.median > 0) {
          const severity = carry.iqr / (carry.median * WIDE_CARRY_SHARE);
          record(
            { kind: 'inconsistency', session, key, shotIds, carry: measured },
            severity,
            severity > 1,
          );
        }
      }
      const curve = directionStats(shots, 'curve');
      if (curve.n >= MIN_INSIGHT_SHOTS) {
        const shotIds = shots
          .filter((shot) => shot.measurements.curve !== null)
          .map(({ id }) => id);
        const clear =
          Math.max(curve.left, curve.right) / curve.n < ONE_SIDED_CURVE_SHARE;
        for (const side of ['left', 'right'] as const) {
          const count = curve[side];
          const severity = count / curve.n / ONE_SIDED_CURVE_SHARE;
          record(
            {
              kind: 'direction',
              session,
              key: 'curve',
              shotIds,
              club,
              side,
              count,
              missing: curve.missing,
            },
            severity,
            count / curve.n >= ONE_SIDED_CURVE_SHARE,
            clear,
          );
        }
      }
    }
    for (let i = 1; i < order.length; i++) {
      const upper = order[i - 1];
      const lower = order[i];
      const longer = upper === undefined ? undefined : carries.get(upper);
      const shorter = lower === undefined ? undefined : carries.get(lower);
      if (!longer || !shorter) continue;
      const gap = longer.median - shorter.median;
      const shotIds = [...longer.shotIds, ...shorter.shotIds];
      record(
        { kind: 'gapping', session, key, shotIds, longer, shorter, gap },
        (2 * SMALL_GAP_M - gap) / SMALL_GAP_M,
        gap <= SMALL_GAP_M,
      );
    }
  }

  const ranked = [...patterns.values()].flatMap(({ id, observations }) => {
    observations.sort((a, b) =>
      compareVisits(a.evidence.session, b.evidence.session),
    );
    const byDate = new Map<string, PracticeObservation[]>();
    for (const observation of observations) {
      const date = observation.evidence.session.date;
      const day = byDate.get(date) ?? [];
      day.push(observation);
      byDate.set(date, day);
    }

    const days = [...byDate.values()];
    // Conflicting visits on a date supply neither recurrence nor improvement.
    const supporting = days.filter((day) =>
      day.every(({ supports }) => supports),
    );
    const latestSupporting = supporting[0];
    if (supporting.length < 2 || !latestSupporting) return [];
    const support = supporting.flat();
    const [first, ...rest] = support.map(({ evidence }) => evidence);
    if (!first) return [];
    const newer = days.slice(0, days.indexOf(latestSupporting));
    const improving =
      newer.length >= 2 &&
      newer.slice(0, 2).every((day) => day.every(({ clear }) => clear));
    const insight: PracticeInsight = {
      id,
      dates: supporting.length,
      shots: support.reduce(
        (total, item) => total + item.evidence.shotIds.length,
        0,
      ),
      improving,
      evidence: [first, ...rest],
    };
    return [
      {
        insight,
        severity:
          quantile(
            support.map((item) => item.severity),
            0.5,
          ) ?? 0,
        latest: first.session,
      },
    ];
  });

  ranked.sort(
    (a, b) =>
      Number(a.insight.improving) - Number(b.insight.improving) ||
      b.insight.dates - a.insight.dates ||
      b.insight.shots - a.insight.shots ||
      b.severity - a.severity ||
      b.latest.date.localeCompare(a.latest.date) ||
      a.insight.id.localeCompare(b.insight.id) ||
      venueKey(a.latest).localeCompare(venueKey(b.latest)),
  );

  const distinct = new Map<string, PracticeInsight>();
  for (const { insight } of ranked) {
    if (!distinct.has(insight.id)) distinct.set(insight.id, insight);
  }
  return [...distinct.values()];
}

export type ClubSuggestion = {
  shotId: string;
  club: string;
  delta: number;
  sampleSize: number;
  source: 'session' | 'all';
};

const MIN_SUGGESTION_SAMPLES = 10;
const MAX_SUGGESTION_DELTA = 15;
const MIN_SUGGESTION_ADVANTAGE = 5;

/** Closest well-sampled club by carry, abstaining when two candidates are too close. */
export function suggestClub(
  shot: Shot,
  data: Dataset,
  basis: Basis,
): ClubSuggestion | null {
  if (
    shot.review.exclusion.kind !== 'included' ||
    !isUnknownClub(effectiveClub(shot))
  )
    return null;
  const carryKey = BASES[basis].carry;
  const carry = shot.measurements[carryKey];
  if (carry === null) return null;

  const sessions = new Map(
    data.sessions.filter((s) => !s.archived).map((s) => [s.id, s]),
  );
  if (!sessions.has(shot.sessionId)) return null;
  const known = data.shots.filter(
    (candidate) =>
      candidate.id !== shot.id &&
      sessions.has(candidate.sessionId) &&
      candidate.review.exclusion.kind === 'included' &&
      !isUnknownClub(effectiveClub(candidate)) &&
      candidate.measurements[carryKey] !== null,
  );

  const propose = (
    candidates: Shot[],
    source: 'session' | 'all',
  ): ClubSuggestion[] => {
    const groups = new Map<string, number[]>();
    for (const candidate of candidates) {
      const value = candidate.measurements[carryKey];
      if (value === null) continue;
      const club = effectiveClub(candidate);
      groups.set(club, [...(groups.get(club) ?? []), value]);
    }
    const ranked: ClubSuggestion[] = [];
    for (const [club, values] of groups) {
      if (values.length < MIN_SUGGESTION_SAMPLES) continue;
      const median = quantile(values, 0.5);
      if (median === null) continue;
      const delta = Math.abs(carry - median);
      ranked.push({
        shotId: shot.id,
        club,
        delta,
        sampleSize: values.length,
        source,
      });
    }
    return ranked.sort((a, b) => a.delta - b.delta);
  };

  const sessionCandidates = propose(
    known.filter((candidate) => candidate.sessionId === shot.sessionId),
    'session',
  );
  const candidates =
    sessionCandidates[0] && sessionCandidates[0].delta <= MAX_SUGGESTION_DELTA
      ? sessionCandidates
      : propose(known, 'all');
  const [best, runnerUp] = candidates;
  if (!best || best.delta > MAX_SUGGESTION_DELTA) return null;
  if (runnerUp && runnerUp.delta - best.delta < MIN_SUGGESTION_ADVANTAGE)
    return null;
  return best;
}
