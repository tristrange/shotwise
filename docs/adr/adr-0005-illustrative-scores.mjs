// Reproducible calculation fixture for ADR-0005 (proposal v2, 2026-11-25).
//
// This script is the review artifact's evidence generator: it implements the
// PROPOSED v2 normalization functions exactly as written in
// docs/adr/0005-ratings-proposal.md §4 and prints every illustrative table in
// §8 as markdown. It is standalone on purpose — it imports nothing from app/
// and nothing in app/ imports it. If ADR-0005 is accepted, these functions
// move verbatim into app/src/domain/ratings.ts as versioned constants
// `ratings-2`; until then they are documentation only.
//
// Run: node docs/adr/adr-0005-illustrative-scores.mjs
//
// All randomness is seeded, so output is byte-for-byte reproducible.

export const RATINGS_VERSION = 'ratings-2 (proposed)';

// ---------------------------------------------------------------------------
// Core math (quantile matches app/src/domain/statistics.ts exactly)
// ---------------------------------------------------------------------------

export function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const offset = (sorted.length - 1) * p;
  const left = sorted[Math.floor(offset)];
  const right = sorted[Math.ceil(offset)];
  return left === undefined || right === undefined
    ? null
    : left + (right - left) * (offset % 1);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const iqr = (values) => {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return q1 === null || q3 === null ? null : q3 - q1;
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box–Muller normal sample.
function normal(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ---------------------------------------------------------------------------
// Proposed v2 constants (`ratings-2`). Product constants, NOT population
// benchmarks — see ADR-0005 §4 and the sensitivity sweep in §8.
// ---------------------------------------------------------------------------

export const WEIGHTS = { distance: 0.2, consistency: 0.25, direction: 0.3, reliability: 0.25 };

// Consistency: role-specific anchors on relative carry IQR (IQR / median).
// Owner-proposed starting points (2026-11-25 feedback).
export const CONSISTENCY_ANCHORS = {
  'driver-wood': { excellent: 0.05, poor: 0.3 },
  'hybrid-iron': { excellent: 0.04, poor: 0.25 },
  wedge: { excellent: 0.04, poor: 0.25 },
};

// Directional control: anchors on P80 of |lateral finishing error| relative to
// median carry — the upper tail, so poor offline shots count, not just the
// typical shot. Provisional product constants.
export const DIRECTION_ANCHORS = {
  'driver-wood': { good: 0.08, poor: 0.25 },
  'hybrid-iron': { good: 0.05, poor: 0.18 },
  wedge: { good: 0.06, poor: 0.2 },
};

// Fallback when finishing-position data is unavailable: P80 |launch direction|
// in degrees, scored on its own anchors and labelled separately — never mixed
// with finishing-position scores.
export const LAUNCH_ANCHORS = { good: 1.5, poor: 6.0 };

// Corridor half-width as a fraction of median carry, for the corridor success
// aux display (not the scoring metric).
export const CORRIDOR_HALF_WIDTH = { 'driver-wood': 0.08, 'hybrid-iron': 0.05, wedge: 0.1 };

// Previous v1 anchors, kept for the sensitivity comparison only.
const CONSISTENCY_ANCHORS_V1 = {
  'driver-wood': { excellent: 0.035, poor: 0.1 },
  'hybrid-iron': { excellent: 0.025, poor: 0.08 },
  wedge: { excellent: 0.03, poor: 0.1 },
};

export function clubRole(club) {
  const c = club.trim().toUpperCase();
  if (c === 'D' || c === 'DR' || c === 'DRIVER' || /^[1-9]W$/.test(c)) return 'driver-wood';
  if (/^[1-5]H$/.test(c) || c === 'HY' || c === 'HYBRID' || /^[1-9]I$/.test(c)) return 'hybrid-iron';
  return 'wedge'; // PW, GW, AW, SW, LW, 48–60° wedges (full-swing only)
}

// ---------------------------------------------------------------------------
// Proposed v2 scoring functions (ADR-0005 §4)
// ---------------------------------------------------------------------------

/** Distance: capped target attainment. 80% of target scores 80, not 0. */
export function distanceScore(p80, referenceM) {
  if (p80 === null || referenceM === null || referenceM === undefined || referenceM <= 0) return null;
  return Math.min(100, (100 * p80) / referenceM);
}

/** Linear ramp, lower metric = better, clamped to [0, 100]. */
const ramp = (x, good, poor) => 100 * clamp01((poor - x) / (poor - good));

export function consistencyScore(relIqr, role) {
  if (relIqr === null) return null;
  const a = CONSISTENCY_ANCHORS[role];
  return ramp(relIqr, a.excellent, a.poor);
}

export function directionScore(relLatP80, role) {
  if (relLatP80 === null) return null;
  const a = DIRECTION_ANCHORS[role];
  return ramp(relLatP80, a.good, a.poor);
}

export function launchDirectionScore(p80AbsDeg) {
  if (p80AbsDeg === null) return null;
  return ramp(p80AbsDeg, LAUNCH_ANCHORS.good, LAUNCH_ANCHORS.poor);
}

/** Reliability: acceptable-strike percentage. 25% mishits scores 75, not 0. */
export function reliabilityScore(mishitShare) {
  if (mishitShare === null) return null;
  return 100 * clamp01(1 - mishitShare);
}

/**
 * Wilson 95% interval for a binomial proportion. SAMPLING uncertainty only,
 * under its assumptions (i.i.d. assessed shots); it says nothing about
 * classifier uncertainty — that is reported separately as assessed coverage
 * and the missingness sensitivity range.
 */
export function wilsonInterval(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [centre - half, centre + half];
}

/**
 * Composite. All four categories present -> full composite. 2–3 present ->
 * provisional composite renormalized over the present categories, flagged with
 * its coverage and never ranked against composites with a different category
 * set. Fewer than 2 -> no composite.
 */
export function compositeScores(cats) {
  const entries = Object.entries(cats).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length < 2) return { value: null, coverage: entries.length, provisional: entries.length > 0 };
  const weightSum = entries.reduce((s, [k]) => s + WEIGHTS[k], 0);
  const value = entries.reduce((s, [k, v]) => s + WEIGHTS[k] * v, 0) / weightSum;
  return { value, coverage: entries.length, provisional: entries.length < 4 };
}

// ---------------------------------------------------------------------------
// Synthetic club distributions (seeded). A mishit is short AND offline, which
// is what makes the categories correlated in real data.
// ---------------------------------------------------------------------------

function makeClubShots({ seed, n, visits, median, relIqr, mishitEvery, latP80Rel, launchP80Deg, fromCentre = true }) {
  const rand = mulberry32(seed);
  // Normal carry with IQR/median ~= relIqr (normal IQR = 1.349 sigma).
  const sd = (relIqr * median) / 1.349;
  // Half-normal lateral error whose P80/median ~= latP80Rel (P80 of
  // half-normal = 1.2816 sigma).
  const latSd = (latP80Rel * median) / 1.2816;
  const launchSd = launchP80Deg / 1.2816;
  const shots = [];
  for (let i = 0; i < n; i++) {
    const mishit = mishitEvery > 0 && i % mishitEvery === mishitEvery - 1;
    const carry = Math.max(1, median + normal(rand) * sd) * (mishit ? 0.55 : 1);
    const lat = Math.abs(normal(rand) * latSd) * (mishit ? 2.5 : 1) * (fromCentre ? 1 : 0);
    const launch = Math.abs(normal(rand) * launchSd) * (mishit ? 2 : 1);
    shots.push({
      visit: Math.floor((i / n) * visits),
      carry,
      mishit,
      fromCentre: fromCentre ? lat : null,
      launchDirection: launch,
    });
  }
  return shots;
}

function clubStats(shots, club) {
  const role = clubRole(club);
  const carries = shots.map((s) => s.carry);
  const median = quantile(carries, 0.5);
  const spread = iqr(carries);
  const strong = shots.filter((s) => !s.mishit).map((s) => s.carry);
  const p80 = quantile(strong, 0.8);
  const relIqr = median ? spread / median : null;
  const latValues = shots.flatMap((s) => (s.fromCentre === null ? [] : [s.fromCentre]));
  const latP80Rel = median && latValues.length ? quantile(latValues.map(Math.abs), 0.8) / median : null;
  const latMedianRel = median && latValues.length ? quantile(latValues.map(Math.abs), 0.5) / median : null;
  const corridor = CORRIDOR_HALF_WIDTH[role];
  const corridorSuccess =
    median && latValues.length ? latValues.filter((v) => Math.abs(v) <= corridor * median).length / latValues.length : null;
  const launchP80 = quantile(shots.map((s) => Math.abs(s.launchDirection)), 0.8);
  const mishitShare = shots.length ? shots.filter((s) => s.mishit).length / shots.length : null;
  const visits = new Set(shots.map((s) => s.visit)).size;
  return { club, role, n: shots.length, visits, median, p80, relIqr, latP80Rel, latMedianRel, corridorSuccess, launchP80, mishitShare };
}

function rateClub(stats, referenceM) {
  const distance = distanceScore(stats.p80, referenceM);
  const consistency = consistencyScore(stats.relIqr, stats.role);
  const direction = directionScore(stats.latP80Rel, stats.role);
  const launchOnly = launchDirectionScore(stats.launchP80);
  const reliability = reliabilityScore(stats.mishitShare);
  const comp = compositeScores({ distance, consistency, direction, reliability });
  return { ...stats, referenceM, distance, consistency, direction, launchOnly, reliability, ...comp };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const fmt = (x, d = 1) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const pct = (x, d = 0) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(d)}%`);

function scenarioTable(title, rows) {
  console.log(`\n### ${title}\n`);
  console.log('| Club | n (visits) | P80 carry | ref | mishit | rel IQR | lat P80 | corridor | distance | consistency | direction | reliability | composite |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    console.log(
      `| ${r.club} | ${r.n} (${r.visits}) | ${fmt(r.p80)} m | ${r.referenceM ? fmt(r.referenceM, 0) + ' m' : 'none'} | ${pct(r.mishitShare)} | ${fmt(100 * r.relIqr)}% | ${fmt(100 * r.latP80Rel)}% | ${pct(r.corridorSuccess)} | ${fmt(r.distance)} | ${fmt(r.consistency)} | ${fmt(r.direction)} | ${fmt(r.reliability)} | ${r.value === null ? '—' : fmt(r.value) + (r.provisional ? ` (prov. ${r.coverage}/4)` : '')} |`,
    );
  }
}

const REFS = { D: 250, '7i': 150, PW: 120 };

function golfer(seedBase, clubs) {
  return clubs.map((c, i) => {
    const shots = makeClubShots({ seed: seedBase + i * 977, ...c });
    return rateClub(clubStats(shots, c.club), REFS[c.club] ?? null);
  });
}

console.log(`# ADR-0005 v2 illustrative scores — generated by \`adr-0005-illustrative-scores.mjs\` (${RATINGS_VERSION})`);
console.log('\nAll numbers below are computed by the proposed functions in this fixture, not hand-derived.');

// --- §8.1 three golfer scenarios -------------------------------------------------
const beginner = golfer(11, [
  { club: 'D', n: 40, visits: 4, median: 195, relIqr: 0.14, mishitEvery: 6, latP80Rel: 0.2, launchP80Deg: 5.5 },
  { club: '7i', n: 40, visits: 4, median: 108, relIqr: 0.12, mishitEvery: 7, latP80Rel: 0.12, launchP80Deg: 5.0 },
  { club: 'PW', n: 40, visits: 4, median: 82, relIqr: 0.13, mishitEvery: 5, latP80Rel: 0.14, launchP80Deg: 5.5 },
]);
const intermediate = golfer(23, [
  { club: 'D', n: 48, visits: 4, median: 238, relIqr: 0.09, mishitEvery: 16, latP80Rel: 0.11, launchP80Deg: 3.5 },
  { club: '7i', n: 48, visits: 4, median: 143, relIqr: 0.065, mishitEvery: 18, latP80Rel: 0.08, launchP80Deg: 3.0 },
  { club: 'PW', n: 48, visits: 4, median: 114, relIqr: 0.075, mishitEvery: 14, latP80Rel: 0.11, launchP80Deg: 4.0 },
]);
const elite = golfer(37, [
  { club: 'D', n: 60, visits: 6, median: 256, relIqr: 0.05, mishitEvery: 50, latP80Rel: 0.07, launchP80Deg: 2.2 },
  { club: '7i', n: 60, visits: 6, median: 151, relIqr: 0.04, mishitEvery: 100, latP80Rel: 0.05, launchP80Deg: 1.8 },
  { club: 'PW', n: 60, visits: 6, median: 121, relIqr: 0.045, mishitEvery: 50, latP80Rel: 0.07, launchP80Deg: 2.5 },
]);
scenarioTable('§8.1a Beginner (references D 250 / 7i 150 / PW 120 m)', beginner);
scenarioTable('§8.1b Intermediate', intermediate);
scenarioTable('§8.1c Highly consistent', elite);

// --- §8.2 owner's worked example: 7i median 120, IQR 10 ---------------------------
{
  const rel = 10 / 120;
  const v1 = ramp(rel, CONSISTENCY_ANCHORS_V1['hybrid-iron'].excellent, CONSISTENCY_ANCHORS_V1['hybrid-iron'].poor);
  const v2 = consistencyScore(rel, 'hybrid-iron');
  console.log('\n### §8.2 Owner’s worked example — 7 iron, median carry 120 m, IQR 10 m (rel IQR 8.33%)\n');
  console.log('| Methodology | consistency score |');
  console.log('| --- | --- |');
  console.log(`| v1 anchors (iron 2.5% / 8%) | ${fmt(v1)} |`);
  console.log(`| v2 anchors (irons 4% / 25%) | ${fmt(v2)} |`);
}

// --- §8.3 change scenarios ---------------------------------------------------------
console.log('\n### §8.3 How scores change (intermediate 7i baseline unless stated)\n');
const base7i = intermediate.find((r) => r.club === '7i');
const rows = [];
const add = (label, r, note = '') => rows.push({ label, r, note });
add('Baseline', base7i);
{
  // Same swings, +15 m carry on every shot: distance improves without any
  // change in swing quality.
  const base = makeClubShots({ seed: 23 + 977, n: 48, visits: 4, club: '7i', median: 143, relIqr: 0.065, mishitEvery: 18, latP80Rel: 0.08, launchP80Deg: 3.0 });
  const boosted = base.map((s) => ({ ...s, carry: s.carry + 15 }));
  add('Distance improves (every carry +15 m)', rateClub(clubStats(boosted, '7i'), 150));
}
{
  const s = clubStats(makeClubShots({ seed: 502, n: 48, visits: 4, club: '7i', median: 143, relIqr: 0.2, mishitEvery: 18, latP80Rel: 0.08, launchP80Deg: 3.0 }), '7i');
  add('Carry variability increases (rel IQR 6.5% → 20%)', rateClub(s, 150));
}
{
  const s = clubStats(makeClubShots({ seed: 503, n: 48, visits: 4, club: 'PW', median: 114, relIqr: 0.075, mishitEvery: 4, latP80Rel: 0.11, launchP80Deg: 4.0 }), 'PW');
  add('Frequent mishits (PW mishit share ~7% → 25%)', rateClub(s, 120));
}
{
  // Correlated categories: same mishit-heavy PW, but consistency/direction
  // recomputed on clean shots only (counterfactual) to quantify the overlap.
  const shots = makeClubShots({ seed: 503, n: 48, visits: 4, club: 'PW', median: 114, relIqr: 0.075, mishitEvery: 4, latP80Rel: 0.11, launchP80Deg: 4.0 });
  const full = clubStats(shots, 'PW');
  const clean = clubStats(shots.filter((s) => !s.mishit), 'PW');
  const withMishits = rateClub(full, 120);
  const cleanOnly = rateClub({ ...clean, mishitShare: full.mishitShare }, 120); // reliability kept, consistency/direction clean
  add('Same PW, mishits excluded from consistency/direction (counterfactual)', cleanOnly, 'shows the correlated-category overlap');
  void withMishits;
}
{
  const s = clubStats(makeClubShots({ seed: 504, n: 48, visits: 4, club: '7i', median: 143, relIqr: 0.065, mishitEvery: 18, latP80Rel: 0.08, launchP80Deg: 3.0, fromCentre: false }), '7i');
  const r = rateClub(s, 150);
  r.direction = null; // finishing-position unavailable -> not scored on lateral
  r.directionNote = 'launch-direction fallback: ' + fmt(r.launchOnly) + ' (deg basis)';
  const comp = compositeScores({ distance: r.distance, consistency: r.consistency, direction: null, reliability: r.reliability });
  add('Directional coverage missing (no fromCentre)', { ...r, ...comp }, 'direction withheld; launch score ' + fmt(r.launchOnly) + ' shown separately; composite provisional 3/4');
}
{
  const s = clubStats(makeClubShots({ seed: 505, n: 12, visits: 1, club: '5i', median: 128, relIqr: 0.09, mishitEvery: 12, latP80Rel: 0.1, launchP80Deg: 4.5 }), '5i');
  add('New club, one session (5i, n = 12, 1 visit, no reference)', rateClub(s, null), 'distance withheld without a reference; evidence level: early provisional');
}
{
  const s = clubStats(makeClubShots({ seed: 506, n: 48, visits: 4, club: '7i', median: 143, relIqr: 0.065, mishitEvery: 18, latP80Rel: 0.08, launchP80Deg: 3.0 }), '7i');
  add('No personal/external benchmark, but historical potential 148 m exists', rateClub(s, 148), 'historical personal potential used as labelled fallback reference');
}
console.log('| Scenario | distance | consistency | direction | reliability | composite |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const { label, r, note } of rows) {
  console.log(`| ${label}${note ? ` — ${note}` : ''} | ${fmt(r.distance)} | ${fmt(r.consistency)} | ${fmt(r.direction)} | ${fmt(r.reliability)} | ${r.value === null ? '—' : fmt(r.value) + (r.provisional ? ` (prov. ${r.coverage}/4)` : '')} |`);
}

// --- §8.4 reliability uncertainty --------------------------------------------------
{
  const s = intermediate.find((r) => r.club === 'PW');
  const assessed = s.n;
  const mishits = Math.round(s.mishitShare * assessed);
  const w = wilsonInterval(mishits, assessed);
  // Missingness sensitivity over the FULL-swing population: `assessed` is only
  // the assessed share; the unassessed remainder belongs to the denominator.
  const u = 0.1; // unassessed share of all full swings
  const shareIfAllUnassessedMishits = u + (1 - u) * (mishits / assessed);
  const shareIfAllUnassessedClean = (1 - u) * (mishits / assessed);
  console.log('\n### §8.4 Reliability uncertainty (intermediate PW)\n');
  console.log(`- mishit share ${pct(s.mishitShare)} of n=${assessed} assessed → reliability ${fmt(s.reliability)}`);
  console.log(`- Wilson 95% interval (sampling uncertainty only): [${pct(w[0])}, ${pct(w[1])}] → reliability range [${fmt(reliabilityScore(w[1]))}, ${fmt(reliabilityScore(w[0]))}]`);
  console.log(`- missingness sensitivity over the full-swing population (${pct(1 - u)} assessed, ${pct(u)} unassessed): if all unassessed were mishits, full-population share ${pct(shareIfAllUnassessedMishits)} → reliability ${fmt(reliabilityScore(shareIfAllUnassessedMishits))}; if all clean, share ${pct(shareIfAllUnassessedClean)} → reliability ${fmt(reliabilityScore(shareIfAllUnassessedClean))}. Classifier uncertainty is reported via assessed coverage and these bounds, not the Wilson interval.`);
}

// --- §8.5 consistency anchor sensitivity sweep --------------------------------------
console.log('\n### §8.5 Consistency anchor sensitivity (score vs relative carry IQR)\n');
console.log('| rel IQR | driver-wood v1 (3.5/10%) | driver-wood v2 (5/30%) | iron v1 (2.5/8%) | iron v2 (4/25%) | wedge v1 (3/10%) | wedge v2 (4/25%) |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (let rel = 0.02; rel <= 0.351; rel += 0.03) {
  const r = (x, a) => ramp(x, a.excellent ?? a.good, a.poor);
  console.log(
    `| ${(100 * rel).toFixed(0)}% | ${fmt(r(rel, CONSISTENCY_ANCHORS_V1['driver-wood']))} | ${fmt(consistencyScore(rel, 'driver-wood'))} | ${fmt(r(rel, CONSISTENCY_ANCHORS_V1['hybrid-iron']))} | ${fmt(consistencyScore(rel, 'hybrid-iron'))} | ${fmt(r(rel, CONSISTENCY_ANCHORS_V1.wedge))} | ${fmt(consistencyScore(rel, 'wedge'))} |`,
  );
}

// --- §8.6 historical personal potential self-reference guard ------------------------
{
  console.log('\n### §8.6 Historical personal potential — leave-current-window-out guard\n');
  // Five visits; the current (5th) window is the golfer's best. Naive historical
  // potential includes it; the guarded version excludes the evaluated window.
  const visits = [140, 142, 145, 147, 156].map((median, i) => {
    const shots = makeClubShots({ seed: 700 + i, n: 12, visits: 1, club: '7i', median, relIqr: 0.06, mishitEvery: 0, latP80Rel: 0.08, launchP80Deg: 3 });
    return quantile(shots.filter((s) => !s.mishit).map((s) => s.carry), 0.8);
  });
  const naive = Math.max(...visits);
  const guarded = Math.max(...visits.slice(0, -1));
  const currentP80 = visits[visits.length - 1];
  console.log('| per-visit P80 (m) | ' + visits.map((v) => fmt(v)).join(' | ') + ' |');
  console.log(`\n- current window P80: ${fmt(currentP80)} m`);
  console.log(`- naive historical potential (includes current window): ${fmt(naive)} m → raw ratio ${(100 * currentP80 / naive).toFixed(1)}% → distance score ${fmt(distanceScore(currentP80, naive))} (circular: the evaluated shots set their own reference, so the ratio is 100% by construction)`);
  console.log(`- guarded historical potential (excludes evaluated window): ${fmt(guarded)} m → raw ratio ${(100 * currentP80 / guarded).toFixed(1)}% → distance score ${fmt(distanceScore(currentP80, guarded))} (attainment vs previously demonstrated ability; the 100 cap still applies)`);
}
