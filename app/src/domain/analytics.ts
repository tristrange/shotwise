import {
  BASES,
  clubOrder,
  effectiveClub,
  isUnknownClub,
  isWedge,
  shiftDate,
  type Basis,
  type Dataset,
  type MetricKey,
  type Review,
  type Session,
  type Shot,
} from './model';

export type AnalysisQuery = {
  mode: 'recent' | 'progress' | 'all';
  today: string;
  intent: Review['intent'] | 'all';
  contact: 'all' | 'typical';
  club?: string;
};
export const RULE_VERSION = 'club-label-1';
export function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const offset = (sorted.length - 1) * p;
  const left = sorted[Math.floor(offset)];
  const right = sorted[Math.ceil(offset)];
  return left === undefined || right === undefined
    ? null
    : left + (right - left) * (offset % 1);
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
    p90: n >= 10 ? quantile(values, 0.9) : null,
  };
}
export function summarize(shots: Shot[], basis: Basis) {
  const fields = BASES[basis];
  const direction = (key: MetricKey) => {
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
  };
  return {
    n: shots.length,
    sessions: new Set(shots.map((s) => s.sessionId)).size,
    carry: metricStats(shots, fields.carry),
    total: metricStats(shots, fields.total),
    speed: metricStats(shots, fields.speed),
    launch: metricStats(shots, fields.launch),
    apex: metricStats(shots, fields.apex),
    launchDirection: direction('launchDirection'),
    curve: direction('curve'),
    lateral: direction('fromCentre'),
  };
}
export function selectCohort(
  shots: Shot[],
  sessions: Session[],
  query: AnalysisQuery,
): Shot[] {
  const sessionMap = new Map(
    sessions.filter((s) => !s.archived).map((s) => [s.id, s]),
  );
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
    const perClub = new Map<string, Shot[]>();
    for (const shot of selected) {
      const club = effectiveClub(shot);
      const group = perClub.get(club) ?? [];
      group.push(shot);
      perClub.set(club, group);
    }
    selected = [...perClub.values()].flatMap((group) => {
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
  }
  return selected.filter(
    (s) =>
      (!query.club || effectiveClub(s) === query.club) &&
      (query.intent === 'all' || s.review.intent === query.intent) &&
      (query.contact === 'all' || s.review.contact === 'typical'),
  );
}
export function reviewCoverage(shots: Shot[]) {
  const eligible = shots.filter((s) => s.review.exclusion.kind === 'included');
  const reviewed = eligible.filter((s) => s.review.contact !== 'uncertain');
  const full = reviewed.filter((s) => s.review.intent === 'full');
  const mishits = full.filter((s) => s.review.contact === 'mishit').length;
  return {
    total: eligible.length,
    reviewed: reviewed.length,
    fullReviewed: full.length,
    mishits,
    rate: full.length ? mishits / full.length : null,
    unassessed: eligible.filter(
      (s) => s.review.intent === 'full' && s.review.contact === 'uncertain',
    ).length,
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

  const recent = included.filter((s) => s.sessionId === latest.id);
  const earlier = included.filter((s) => {
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
  for (const club of new Set(recent.map(effectiveClub))) {
    if (isUnknownClub(club)) continue;
    const recentValues = values(
      recent.filter((s) => effectiveClub(s) === club),
    );
    const baselineValues = values(
      earlier.filter((s) => effectiveClub(s) === club),
    );
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

export type ClubGap = {
  club: string;
  n: number;
  median: number;
  low: number | null;
  high: number | null;
  reliable: boolean;
  gap: number | null;
  flag: 'large' | 'overlap' | null;
};

const MIN_GAP_SAMPLES = 10;
const LARGE_GAP_M = 30;

/** Carry bands for each club, with the gap and overlap against the next club down. */
export function clubGaps(data: Dataset, basis: Basis): ClubGap[] {
  const sessions = new Set(
    data.sessions.filter((s) => !s.archived).map((s) => s.id),
  );
  const key = BASES[basis].carry;
  const groups = new Map<string, Shot[]>();
  for (const shot of data.shots) {
    if (
      !sessions.has(shot.sessionId) ||
      shot.review.exclusion.kind !== 'included' ||
      shot.review.intent === 'partial' ||
      shot.review.contact === 'mishit' ||
      shot.measurements[key] === null
    )
      continue;
    const club = effectiveClub(shot);
    if (isUnknownClub(club)) continue;
    groups.set(club, [...(groups.get(club) ?? []), shot]);
  }

  const rows: ClubGap[] = [...groups]
    .map(([club, shots]) => {
      const stats = metricStats(shots, key);
      return {
        club,
        n: stats.n,
        median: stats.median ?? 0,
        low: stats.p10,
        high: stats.p90,
        reliable: stats.n >= MIN_GAP_SAMPLES,
        gap: null,
        flag: null,
      };
    })
    .sort((a, b) => clubOrder(a.club) - clubOrder(b.club) || a.club.localeCompare(b.club));

  for (let i = 1; i < rows.length; i++) {
    const upper = rows[i - 1];
    const lower = rows[i];
    if (!upper || !lower) continue;
    const gap = upper.median - lower.median;
    lower.gap = gap;
    if (!upper.reliable || !lower.reliable) continue;
    if (
      upper.low !== null &&
      lower.high !== null &&
      upper.low <= lower.high
    )
      lower.flag = 'overlap';
    else if (gap > LARGE_GAP_M) lower.flag = 'large';
  }
  return rows;
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

/** Closest well-sampled club by carry, preferring the shot's own session. */
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
  ): ClubSuggestion | null => {
    const groups = new Map<string, number[]>();
    for (const candidate of candidates) {
      const value = candidate.measurements[carryKey];
      if (value === null) continue;
      const club = effectiveClub(candidate);
      groups.set(club, [...(groups.get(club) ?? []), value]);
    }
    let best: ClubSuggestion | null = null;
    for (const [club, values] of groups) {
      if (values.length < MIN_SUGGESTION_SAMPLES) continue;
      const median = quantile(values, 0.5);
      if (median === null) continue;
      const delta = Math.abs(carry - median);
      if (delta > MAX_SUGGESTION_DELTA) continue;
      if (!best || delta < best.delta)
        best = {
          shotId: shot.id,
          club,
          delta,
          sampleSize: values.length,
          source,
        };
    }
    return best;
  };

  return (
    propose(
      known.filter((candidate) => candidate.sessionId === shot.sessionId),
      'session',
    ) ?? propose(known, 'all')
  );
}
