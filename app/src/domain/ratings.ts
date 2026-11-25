import { metricStats, selectCohort, type AnalysisQuery } from './analytics';
import { isFullSwingResolved, resolveShots, resolvedClub, type ResolvedShot } from './assessment';
import { referenceBasisCompatible } from './benchmarks';
import {
  BASES,
  clubOrder,
  isUnknownClub,
  shiftDate,
  type Basis,
  type Dataset,
  type ReferenceBasis,
  type UserReferenceValueRecord,
} from './model';
import { MIN_POTENTIAL_SAMPLES, potentialCarry } from './potential';
import { filterCohort } from './recap';
import { quantile } from './statistics';

/**
 * Normalized club ratings (ADR-0005 v2, accepted 2026-11-25), versioned as
 * `ratings-2`. This module is the SINGLE calculation source for the rating
 * formulas: the documentation fixture `docs/adr/adr-0005-illustrative-scores.mjs`
 * imports these functions, and `ratings.test.ts` regression-tests the ADR §8
 * illustrative values through them, so app and docs cannot drift apart.
 *
 * Measurement bases (ADR-0005 §2, `rating-basis-1`):
 * - Classification keeps the canonical range-preferred basis (ADR-0001/A7);
 *   this module never reclassifies anything.
 * - All ratings are computed on ONE fixed rating basis, `premium-flat`,
 *   independent of the selected display basis. Premium-flat measurements are
 *   not assumed to exist for every shot: a missing premium-flat measurement
 *   stays missing — there is never a silent range-ball substitution — and
 *   range-ball and premium measurements are never pooled into one
 *   distribution. Changing a display setting therefore cannot change any
 *   rating.
 *
 * Directional policy (owner clarification 2): launch-direction scores are
 * DISPLAY-ONLY and never enter the main composite, even when separately
 * labelled; when finishing-position (`fromCentre`) data is unavailable the
 * directional-control category is withheld from the composite and the launch
 * score is shown separately. Curvature is never treated as landing dispersion.
 */
export const RATINGS_VERSION = 'ratings-2';
export const RATING_BASIS_POLICY_VERSION = 'rating-basis-1';

/** Fixed rating measurement basis — see ADR-0005 §2. */
export const RATING_BASIS: Basis = 'premium-flat';

/** Owner-approved provisional composite weights (ADR-0005 §5). */
export const RATING_WEIGHTS = {
  distancePotential: 0.2,
  consistency: 0.25,
  directionalControl: 0.3,
  reliability: 0.25,
} as const;

export type CategoryId =
  | 'distancePotential'
  | 'consistency'
  | 'directionalControl'
  | 'reliability';

export type ClubRole = 'driver-wood' | 'hybrid-iron' | 'wedge';

/** Club role for anchor selection. Full-swing wedges (incl. PW) are 'wedge'. */
export function clubRole(club: string): ClubRole {
  const c = club.trim().toUpperCase();
  if (c === 'D' || c === 'DR' || c === 'DRIVER' || /^[1-9]W$/.test(c))
    return 'driver-wood';
  if (/^[1-5]H$/.test(c) || c === 'HY' || c === 'HYBRID' || /^[1-9]I$/.test(c))
    return 'hybrid-iron';
  return 'wedge';
}

/**
 * Consistency anchors on relative carry IQR (IQR/median), per club role.
 * Owner-approved PROVISIONAL product constants (2026-11-25) — not population
 * benchmarks; reevaluated after real golfer data. No editable per-club
 * tolerances.
 */
export const CONSISTENCY_ANCHORS: Record<ClubRole, { excellent: number; poor: number }> = {
  'driver-wood': { excellent: 0.05, poor: 0.3 },
  'hybrid-iron': { excellent: 0.04, poor: 0.25 },
  wedge: { excellent: 0.04, poor: 0.25 },
};

/**
 * Directional-control anchors on P80 |lateral finishing error| relative to
 * median carry — the upper tail, so poor offline shots count, not only the
 * typical shot. Provisional product constants.
 */
export const DIRECTION_ANCHORS: Record<ClubRole, { good: number; poor: number }> = {
  'driver-wood': { good: 0.08, poor: 0.25 },
  'hybrid-iron': { good: 0.05, poor: 0.18 },
  wedge: { good: 0.06, poor: 0.2 },
};

/**
 * Launch-direction fallback anchors (P80 |launch direction|, degrees).
 * DISPLAY-ONLY: never enters the composite (owner clarification 2).
 */
export const LAUNCH_DIRECTION_ANCHORS = { good: 1.5, poor: 6.0 } as const;

/** Corridor half-width as a fraction of median carry — complementary display only. */
export const CORRIDOR_HALF_WIDTH: Record<ClubRole, number> = {
  'driver-wood': 0.08,
  'hybrid-iron': 0.05,
  wedge: 0.1,
};

/** Minimum samples for a normalized category rating (raw metrics may show earlier). */
export const MIN_RATING_SAMPLES: Record<CategoryId, number> = {
  distancePotential: MIN_POTENTIAL_SAMPLES,
  consistency: 10,
  directionalControl: 10,
  reliability: 10,
};

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Linear ramp, lower metric = better, clamped to [0, 100]. */
export function rampScore(x: number, good: number, poor: number): number {
  return 100 * clamp01((poor - x) / (poor - good));
}

/**
 * Distance: capped target attainment (ADR-0005 §4.1). 80% of target scores 80,
 * not zero; excess above the reference caps at 100.
 */
export function distanceScore(
  p80: number | null,
  referenceM: number | null,
): number | null {
  if (p80 === null || referenceM === null || referenceM <= 0) return null;
  return Math.min(100, (100 * p80) / referenceM);
}

/** Consistency: role-anchored relative carry IQR (ADR-0005 §4.2). */
export function consistencyScore(relIqr: number | null, role: ClubRole): number | null {
  if (relIqr === null) return null;
  const a = CONSISTENCY_ANCHORS[role];
  return rampScore(relIqr, a.excellent, a.poor);
}

/** Directional control: P80 |lateral| / median carry (ADR-0005 §4.3). */
export function directionScore(
  relLatP80: number | null,
  role: ClubRole,
): number | null {
  if (relLatP80 === null) return null;
  const a = DIRECTION_ANCHORS[role];
  return rampScore(relLatP80, a.good, a.poor);
}

/** Launch-direction score — display-only, never part of the composite. */
export function launchDirectionScore(p80AbsDeg: number | null): number | null {
  if (p80AbsDeg === null) return null;
  return rampScore(p80AbsDeg, LAUNCH_DIRECTION_ANCHORS.good, LAUNCH_DIRECTION_ANCHORS.poor);
}

/** Reliability: acceptable-strike percentage (ADR-0005 §4.4). 25% mishits → 75. */
export function reliabilityScore(mishitShare: number | null): number | null {
  if (mishitShare === null) return null;
  return 100 * clamp01(1 - mishitShare);
}

/**
 * Wilson 95% interval for a binomial proportion. SAMPLING uncertainty only,
 * under its i.i.d. assumptions — it does NOT account for classifier
 * uncertainty; that is reported via assessed/unassessed coverage and the
 * full-population missingness sensitivity range.
 */
export function wilsonInterval(
  k: number,
  n: number,
  z = 1.96,
): [number, number] | null {
  if (!n) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [centre - half, centre + half];
}

export type CompositeScore = {
  value: number | null;
  /** How many of the four categories are present. */
  coverage: number;
  /** True when 2–3 categories are present: renormalized, never ranked against a different category set. */
  provisional: boolean;
};

/**
 * Composite (ADR-0005 §5). All four categories → full composite. 2–3 →
 * provisional composite renormalized over the present categories. Fewer than
 * 2 → no composite.
 */
export function compositeScore(
  cats: Record<CategoryId, number | null>,
): CompositeScore {
  const entries = (Object.keys(RATING_WEIGHTS) as CategoryId[]).filter(
    (k) => cats[k] !== null,
  );
  if (entries.length < 2)
    return { value: null, coverage: entries.length, provisional: entries.length > 0 };
  const weightSum = entries.reduce((s, k) => s + RATING_WEIGHTS[k], 0);
  const value =
    entries.reduce((s, k) => s + RATING_WEIGHTS[k] * (cats[k] as number), 0) /
    weightSum;
  return { value, coverage: entries.length, provisional: entries.length < 4 };
}

export type EvidenceLevel =
  | 'none'
  | 'early'
  | 'provisional'
  | 'provisional-high-sample'
  | 'supported';

/**
 * Progressive evidence level (ADR-0005 §6, owner clarification 3): n < 10 no
 * numerical rating; 10–19 early provisional; 20–29 provisional; ≥30 across ≥3
 * visits better-supported ("supported"); ≥30 across only 1–2 visits stays
 * useful as "provisional-high-sample". Never presented as statistical
 * validation.
 */
export function evidenceLevel(n: number, visits: number): EvidenceLevel {
  if (n < 10) return 'none';
  if (n < 20) return 'early';
  if (n < 30) return 'provisional';
  return visits >= 3 ? 'supported' : 'provisional-high-sample';
}

// ---------------------------------------------------------------------------
// References (ADR-0005 §4.5) — the three reference concepts stay distinct
// ---------------------------------------------------------------------------

export type RatingReferenceType =
  | 'personal-goal'
  | 'historical-potential'
  | 'external-benchmark';

export type RatingReference = {
  type: RatingReferenceType;
  valueM: number;
  basis: ReferenceBasis;
  /** 'exact' when the reference basis equals the rating basis, 'family' for a family-level match. */
  match: 'exact' | 'family';
  label: string;
};

/**
 * Basis compatibility of a personal reference against the fixed rating basis.
 * Exact match preferred; a family-level match (e.g. `premium` vs the
 * `premium-flat` rating basis) is allowed but must be labelled. `unknown`
 * legacy rows are never silently compared.
 */
export function ratingReferenceMatch(
  referenceBasis: ReferenceBasis,
): 'exact' | 'family' | null {
  if (!referenceBasisCompatible(referenceBasis, RATING_BASIS)) return null;
  return referenceBasis === RATING_BASIS ? 'exact' : 'family';
}

/** Sessions that belong to the evaluated window (excluded from historical references). */
function evaluatedWindowSessionIds(
  sessions: Dataset['sessions'],
  query: AnalysisQuery,
): Set<string> {
  const included = sessions.filter((s) => !s.archived);
  if (query.mode === 'recent') {
    const start = shiftDate(query.today, -59);
    return new Set(
      included
        .filter((s) => s.date >= start && s.date <= query.today)
        .map((s) => s.id),
    );
  }
  // All-time view: every session is under evaluation, so no independent
  // historical reference remains.
  return new Set(included.map((s) => s.id));
}

/**
 * Automatic historical personal potential (ADR-0005 §4.5): a robust high
 * percentile (P80) of the eligible per-session strong-strike P80 values
 * (n ≥ 10 measured carries each) over the trailing 12 months, EXCLUDING the
 * evaluated window (leave-evaluated-window-out guard, §8.6) so current shots
 * can never set their own reference. Measures attainment of previously
 * demonstrated personal ability — not a comparison with other golfers.
 */
export function historicalPersonalPotential(
  data: Dataset,
  club: string,
  query: AnalysisQuery,
): number | null {
  const excluded = evaluatedWindowSessionIds(data.sessions, query);
  const start = shiftDate(query.today, -365);
  const resolved = resolveShots(data.shots, data.sessions, RATING_BASIS);
  const key = BASES[RATING_BASIS].carry;
  const perVisitP80: number[] = [];
  for (const session of data.sessions) {
    if (session.archived || excluded.has(session.id)) continue;
    if (session.date < start || session.date > query.today) continue;
    const sessionShots = data.shots.filter(
      (s) =>
        s.sessionId === session.id && s.review.exclusion.kind === 'included',
    );
    const broader = filterCohort(sessionShots, resolved, 'broader').filter(
      (s) => resolvedClub(resolved.get(s.id)!) === club,
    );
    const carries = broader.flatMap((s) => {
      const v = s.measurements[key];
      return v !== null && v > 0 ? [v] : [];
    });
    const p80 = potentialCarry(carries);
    if (p80 !== null) perVisitP80.push(p80);
  }
  if (perVisitP80.length < 2) return null;
  return quantile(perVisitP80, 0.8);
}

/**
 * Resolve the distance reference for a club, in priority order (ADR-0005
 * §4.5): (1) basis-compatible personal goal; (2) automatic historical personal
 * potential; (3) external benchmark (link-only today, so usually absent).
 * Reference types are never mixed and ratings based on different reference
 * concepts are never presented as directly equivalent. No reference → null
 * (the distance category is withheld; measured P80 is still reported).
 */
export function resolveRatingReference(
  club: string,
  data: Dataset,
  query: AnalysisQuery,
  references: UserReferenceValueRecord[] = data.userReferenceValues,
): RatingReference | null {
  const personal = references.find(
    (r) => r.club === club && r.metric === 'carry' && ratingReferenceMatch(r.basis) !== null,
  );
  if (personal) {
    const match = ratingReferenceMatch(personal.basis)!;
    return {
      type: 'personal-goal',
      valueM: personal.valueM,
      basis: personal.basis,
      match,
      label:
        match === 'exact'
          ? 'Personal goal'
          : 'Personal goal (family-level basis match)',
    };
  }
  const historical = historicalPersonalPotential(data, club, query);
  if (historical !== null) {
    return {
      type: 'historical-potential',
      valueM: historical,
      basis: RATING_BASIS,
      match: 'exact',
      label: 'Historical personal potential',
    };
  }
  // External numerical benchmarks remain an active objective; all researched
  // sources are link-only (D1), so no numerical external reference exists yet.
  return null;
}

// ---------------------------------------------------------------------------
// Per-club ratings on the fixed rating basis
// ---------------------------------------------------------------------------

export type CategoryRating = {
  score: number | null;
  n: number;
  visits: number;
  evidence: EvidenceLevel;
  note: string | null;
};

export type ClubRating = {
  club: string;
  role: ClubRole;
  /** Always RATING_BASIS — ratings never read the display basis. */
  basis: Basis;
  distancePotential: CategoryRating & {
    p80: number | null;
    reference: RatingReference | null;
  };
  consistency: CategoryRating & {
    iqr: number | null;
    median: number | null;
    relIqr: number | null;
  };
  directionalControl: CategoryRating & {
    /** 'lateral' when scored from finishing position; 'launch' when only launch data exists (score stays null — never in the composite); 'none' when unmeasured. */
    measurementBasis: 'lateral' | 'launch' | 'none';
    relLatP80: number | null;
    latMedianRel: number | null;
    corridorSuccess: number | null;
    launchScore: number | null;
    launchP80Deg: number | null;
  };
  reliability: CategoryRating & {
    mishitShare: number | null;
    assessed: number;
    unassessed: number;
    /** Sampling-uncertainty-only interval on the mishit share. */
    wilson: [number, number] | null;
    /** Full-population missingness sensitivity bounds on the reliability score. */
    sensitivity: { allUnassessedMishit: number | null; allUnassessedClean: number | null } | null;
  };
  composite: CompositeScore;
  ratingsVersion: typeof RATINGS_VERSION;
};

const medianAbs = (values: number[]): number | null => {
  const abs = values.map((v) => Math.abs(v)).sort((a, b) => a - b);
  return abs.length ? quantile(abs, 0.5) : null;
};

/**
 * Ratings for one club on the fixed `premium-flat` rating basis. The query
 * selects the window (Recent is the primary Overview rating); the display
 * basis never enters here. Populations follow ADR-0005 §3: suspected
 * wrong-club rows excluded; mishits included in consistency / direction /
 * reliability, excluded from strong-strike distance potential. Zero or
 * negative carry is missing, never a distance; a missing premium-flat
 * measurement stays missing (no range-ball substitution).
 */
export function clubRating(
  data: Dataset,
  query: AnalysisQuery,
  club: string,
  references?: UserReferenceValueRecord[],
): ClubRating | null {
  const resolved = resolveShots(data.shots, data.sessions, RATING_BASIS);
  if (isUnknownClub(club)) return null;
  const role = clubRole(club);
  const selected = selectCohort(
    data.shots,
    data.sessions,
    { ...query, club, contact: 'all', hideLikelyMishits: false },
    RATING_BASIS,
  );
  const reliabilityShots = filterCohort(selected, resolved, 'reliability');
  const broader = filterCohort(selected, resolved, 'broader');
  const key = BASES[RATING_BASIS].carry;
  // Zero or negative carry is a missing measurement, never a distance
  // (ADR-0005 §6): nonpositive carries are excluded from every carry
  // statistic, while the shots stay in the reliability and lateral
  // populations. Each category counts the visits of its OWN contributing
  // population, so partial-only sessions never strengthen another
  // category's evidence.
  const visitsOf = (shots: { sessionId: string }[]) =>
    new Set(shots.map((s) => s.sessionId)).size;

  // Distance potential: strong-strike (broader) population, positive carries only.
  const strongShots = broader.filter((s) => (s.measurements[key] ?? 0) > 0);
  const strongCarries = strongShots.map((s) => s.measurements[key] as number);
  const p80 = potentialCarry(strongCarries);
  const reference = resolveRatingReference(club, data, query, references);
  const distanceVisits = visitsOf(strongShots);
  const distance: ClubRating['distancePotential'] = {
    score: distanceScore(p80, reference?.valueM ?? null),
    p80,
    reference,
    n: strongCarries.length,
    visits: distanceVisits,
    evidence: evidenceLevel(strongCarries.length, distanceVisits),
    note:
      p80 === null
        ? `Needs ${MIN_RATING_SAMPLES.distancePotential} measured carries on the ${BASES[RATING_BASIS].label} rating basis`
        : reference === null
          ? 'No compatible reference — distance rating withheld (measured potential shown)'
          : null,
  };

  // Consistency: full-swing population (mishits included), relative IQR over
  // positive measured carries only.
  const consistencyShots = reliabilityShots.filter(
    (s) => (s.measurements[key] ?? 0) > 0,
  );
  const carryStats = metricStats(consistencyShots, key);
  const relIqr =
    carryStats.iqr !== null && carryStats.median !== null && carryStats.median > 0
      ? carryStats.iqr / carryStats.median
      : null;
  const consistencyN = carryStats.n;
  const consistencyVisits = visitsOf(consistencyShots);
  const consistency: ClubRating['consistency'] = {
    score:
      consistencyN >= MIN_RATING_SAMPLES.consistency ? consistencyScore(relIqr, role) : null,
    iqr: carryStats.iqr,
    median: carryStats.median,
    relIqr,
    n: consistencyN,
    visits: consistencyVisits,
    evidence: evidenceLevel(consistencyN, consistencyVisits),
    note:
      carryStats.iqr === null
        ? 'Needs 4 measured carries for a raw IQR'
        : consistencyN < MIN_RATING_SAMPLES.consistency
          ? `Normalized rating needs ${MIN_RATING_SAMPLES.consistency} measured carries (raw IQR shown)`
          : null,
  };

  // Directional control: P80 |fromCentre| / median carry; launch is display-only.
  // The lateral population keeps shots regardless of carry (a zero-carry
  // placeholder is missing distance, not missing direction).
  const latShots = reliabilityShots.filter((s) => s.measurements.fromCentre !== null);
  const latValues = latShots.map((s) => s.measurements.fromCentre as number);
  const launchValues = reliabilityShots.flatMap((s) =>
    s.measurements.launchDirection === null ? [] : [s.measurements.launchDirection],
  );
  const medianCarry = carryStats.median;
  const latP80 = quantile(latValues.map(Math.abs), 0.8);
  const latP80Rel =
    latValues.length && medianCarry && latP80 !== null ? latP80 / medianCarry : null;
  const latMedianRel =
    latValues.length && medianCarry ? (medianAbs(latValues) ?? 0) / medianCarry : null;
  const corridorHalf = CORRIDOR_HALF_WIDTH[role];
  const corridorSuccess =
    latValues.length && medianCarry
      ? latValues.filter((v) => Math.abs(v) <= corridorHalf * medianCarry).length /
        latValues.length
      : null;
  const launchP80 = quantile(launchValues.map(Math.abs), 0.8);
  const directionN = latValues.length;
  const directionVisits = visitsOf(latShots);
  const directionalControl: ClubRating['directionalControl'] = {
    score:
      directionN >= MIN_RATING_SAMPLES.directionalControl
        ? directionScore(latP80Rel, role)
        : null,
    measurementBasis: latValues.length ? 'lateral' : launchValues.length ? 'launch' : 'none',
    relLatP80: latValues.length ? latP80Rel : null,
    latMedianRel: latValues.length ? latMedianRel : null,
    corridorSuccess,
    // Display-only: never part of the composite (owner clarification 2).
    launchScore: launchP80 === null ? null : launchDirectionScore(launchP80),
    launchP80Deg: launchP80,
    n: directionN,
    visits: directionVisits,
    evidence: evidenceLevel(directionN, directionVisits),
    note: latValues.length
      ? null
      : launchValues.length
        ? 'Finishing position not measured — launch-direction score shown separately, not in the composite'
        : 'Direction not measured in this data',
  };

  // Reliability: assessed full swings; sampling + missingness uncertainty kept distinct.
  let assessed = 0;
  let mishits = 0;
  const assessedShots: typeof reliabilityShots = [];
  for (const shot of reliabilityShots) {
    const contact = resolved.get(shot.id)?.contact;
    if (contact === undefined || contact === 'uncertain') continue;
    assessed += 1;
    assessedShots.push(shot);
    if (contact === 'mishit') mishits += 1;
  }
  const unassessed = reliabilityShots.length - assessed;
  const reliabilityVisits = visitsOf(assessedShots);
  const rate = assessed ? mishits / assessed : null;
  const wilson = assessed ? wilsonInterval(mishits, assessed) : null;
  // Missingness sensitivity over the FULL-swing population: the assessed
  // count is only the assessed share; the unassessed remainder belongs to the
  // denominator (ADR-0005 §8.4).
  const u = reliabilityShots.length ? unassessed / reliabilityShots.length : 0;
  const sensitivity =
    rate !== null && reliabilityShots.length
      ? {
          allUnassessedMishit: reliabilityScore(u + (1 - u) * rate),
          allUnassessedClean: reliabilityScore((1 - u) * rate),
        }
      : null;
  const reliability: ClubRating['reliability'] = {
    score:
      assessed >= MIN_RATING_SAMPLES.reliability ? reliabilityScore(rate) : null,
    mishitShare: rate,
    assessed,
    unassessed,
    wilson,
    sensitivity,
    n: assessed,
    visits: reliabilityVisits,
    evidence: evidenceLevel(assessed, reliabilityVisits),
    note:
      assessed < MIN_RATING_SAMPLES.reliability
        ? `Needs ${MIN_RATING_SAMPLES.reliability} assessed full swings`
        : unassessed > 0
          ? `${unassessed} of ${reliabilityShots.length} full swings still unassessed`
          : null,
  };

  const composite = compositeScore({
    distancePotential: distance.score,
    consistency: consistency.score,
    directionalControl: directionalControl.score,
    reliability: reliability.score,
  });

  return {
    club,
    role,
    basis: RATING_BASIS,
    distancePotential: distance,
    consistency,
    directionalControl,
    reliability,
    composite,
    ratingsVersion: RATINGS_VERSION,
  };
}

/** Ratings for every club present in the selected window, in bag order. */
export function clubRatings(
  data: Dataset,
  query: AnalysisQuery,
  references?: UserReferenceValueRecord[],
): ClubRating[] {
  const resolved = resolveShots(data.shots, data.sessions, RATING_BASIS);
  const selected = selectCohort(
    data.shots,
    data.sessions,
    { ...query, contact: 'all', hideLikelyMishits: false },
    RATING_BASIS,
  );
  const clubs = new Set(
    selected
      .map((s) => resolved.get(s.id))
      .filter((r): r is ResolvedShot => r !== undefined && isFullSwingResolved(r))
      .map((r) => resolvedClub(r)),
  );
  return [...clubs]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b))
    .map((club) => clubRating(data, query, club, references)!)
    .filter((r) => r !== null);
}
