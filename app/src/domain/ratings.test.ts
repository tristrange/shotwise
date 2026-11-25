import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeEquipment, makeSession, makeShot } from './fixtures';
import {
  clubRating,
  clubRatings,
  clubRole,
  compositeScore,
  consistencyScore,
  directionScore,
  distanceScore,
  evidenceLevel,
  historicalPersonalPotential,
  launchDirectionScore,
  RATING_BASIS,
  RATINGS_VERSION,
  ratingReferenceMatch,
  reliabilityScore,
  resolveRatingReference,
  rampScore,
  weakestEvidence,
  wilsonInterval,
  type CategoryId,
} from './ratings';
import { emptyDataset, type Dataset, type UserReferenceValueRecord } from './model';

const TODAY = '2026-11-25';
const query = { mode: 'recent' as const, today: TODAY, intent: 'all' as const, contact: 'all' as const };

function ref(overrides: Partial<UserReferenceValueRecord> = {}): UserReferenceValueRecord {
  return {
    id: 'ref-1',
    club: '7i',
    metric: 'carry',
    valueM: 150,
    note: null,
    basis: 'premium-flat',
    source: 'manual',
    referenceType: 'goal',
    statistic: 'other',
    recordedOn: null,
    equipmentId: null,
    revision: 0,
    ...overrides,
  };
}

/** A dataset with `count` full-swing 7i shots in one session, carries around `base`. */
function clubDataset(opts: {
  sessions?: { date: string; count: number; base: number }[];
  club?: string;
  mishits?: number;
  unassessed?: number;
  partials?: number;
  fromCentre?: number[] | null;
  launchDirection?: number[] | null;
  rangeOnly?: boolean;
  curve?: number[] | null;
}): Dataset {
  const data = structuredClone(emptyDataset);
  const club = opts.club ?? '7i';
  const sessions = opts.sessions ?? [{ date: TODAY, count: 12, base: 140 }];
  let shotNo = 0;
  for (const s of sessions) {
    const session = makeSession({ date: s.date });
    data.sessions.push(session);
    for (let i = 0; i < s.count; i++) {
      shotNo += 1;
      const carry = s.base + ((i * 7) % 11) - 5; // deterministic spread
      const mishit = shotNo <= (opts.mishits ?? 0);
      const partial = !mishit && shotNo <= (opts.mishits ?? 0) + (opts.partials ?? 0);
      const unassessed =
        !mishit && !partial && shotNo <= (opts.mishits ?? 0) + (opts.partials ?? 0) + (opts.unassessed ?? 0);
      const lat =
        opts.fromCentre === null
          ? null
          : (opts.fromCentre?.[i % (opts.fromCentre?.length || 1)] ?? 3);
      data.shots.push(
        makeShot({
          sessionId: session.id,
          rowIndex: i + 1,
          recordedClub: club,
          measurements: {
            flatCarryPremium: opts.rangeOnly ? null : carry,
            flatCarryRange: opts.rangeOnly ? carry : null,
            fromCentre: lat,
            launchDirection:
              opts.launchDirection === null
                ? null
                : (opts.launchDirection?.[i % (opts.launchDirection?.length || 1)] ?? 2),
            curve: opts.curve?.[i % (opts.curve?.length || 1)] ?? null,
          },
          review: {
            intent: partial ? 'partial' : 'full',
            contact: mishit ? 'mishit' : unassessed ? 'uncertain' : 'typical',
          },
        }),
      );
    }
  }
  return data;
}

describe('ADR-0005 §4 pure scoring functions (regression fixtures from §8)', () => {
  it('distance: capped target attainment — 80% of target scores 80, excess caps at 100', () => {
    expect(distanceScore(200, 250)).toBe(80);
    expect(distanceScore(260, 250)).toBe(100);
    expect(distanceScore(250, 250)).toBe(100);
    expect(distanceScore(null, 250)).toBeNull();
    expect(distanceScore(200, null)).toBeNull();
  });

  it('consistency: owner’s worked example — 7i median 120, IQR 10 → 79.4 (v1 gave 0)', () => {
    expect(consistencyScore(10 / 120, 'hybrid-iron')).toBeCloseTo(79.4, 1);
    expect(consistencyScore(0.04, 'hybrid-iron')).toBe(100);
    expect(consistencyScore(0.25, 'hybrid-iron')).toBe(0);
    expect(consistencyScore(0.05, 'driver-wood')).toBe(100);
    expect(consistencyScore(0.3, 'driver-wood')).toBe(0);
    expect(consistencyScore(0.2, 'driver-wood')).toBeCloseTo(40, 5);
    expect(consistencyScore(null, 'wedge')).toBeNull();
  });

  it('direction: P80 lateral anchors; launch is a separate display-only score', () => {
    expect(directionScore(0.08, 'driver-wood')).toBe(100);
    expect(directionScore(0.25, 'driver-wood')).toBe(0);
    expect(directionScore(0.05, 'hybrid-iron')).toBe(100);
    expect(launchDirectionScore(1.5)).toBe(100);
    expect(launchDirectionScore(6)).toBe(0);
    expect(directionScore(null, 'wedge')).toBeNull();
  });

  it('reliability: acceptable-strike percentage — 25% mishits score 75, not 0', () => {
    expect(reliabilityScore(0.25)).toBe(75);
    expect(reliabilityScore(0)).toBe(100);
    expect(reliabilityScore(1)).toBe(0);
    expect(reliabilityScore(0.5)).toBe(50);
    expect(reliabilityScore(null)).toBeNull();
  });

  it('wilson interval: sampling uncertainty only (3/48 → [2.2%, 16.6%])', () => {
    const w = wilsonInterval(3, 48)!;
    expect(w[0]).toBeCloseTo(0.0217, 3);
    expect(w[1]).toBeCloseTo(0.1684, 3);
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it('composite: full at 4/4, renormalized provisional at 2–3/4, none below 2', () => {
    const full = compositeScore({ distancePotential: 100, consistency: 80, directionalControl: 60, reliability: 40 });
    expect(full).toEqual({ value: 68, coverage: 4, provisional: false }); // 20+20+18+10
    const prov = compositeScore({ distancePotential: 100, consistency: 80, directionalControl: null, reliability: 40 });
    expect(prov.provisional).toBe(true);
    expect(prov.coverage).toBe(3);
    expect(prov.value).toBeCloseTo((0.2 * 100 + 0.25 * 80 + 0.25 * 40) / 0.7, 10);
    const one = compositeScore({ distancePotential: 100, consistency: null, directionalControl: null, reliability: null });
    expect(one.value).toBeNull();
    expect(one.coverage).toBe(1);
  });

  it('evidence levels: 30+ shots in 1–2 visits stay provisional-high-sample, not outside the scale', () => {
    expect(evidenceLevel(5, 1)).toBe('none');
    expect(evidenceLevel(12, 1)).toBe('early');
    expect(evidenceLevel(25, 2)).toBe('provisional');
    expect(evidenceLevel(35, 2)).toBe('provisional-high-sample');
    expect(evidenceLevel(35, 4)).toBe('supported');
  });

  it('club roles drive anchor selection', () => {
    expect(clubRole('D')).toBe('driver-wood');
    expect(clubRole('3w')).toBe('driver-wood');
    expect(clubRole('4h')).toBe('hybrid-iron');
    expect(clubRole('7i')).toBe('hybrid-iron');
    expect(clubRole('PW')).toBe('wedge');
    expect(clubRole('SW')).toBe('wedge');
    expect(clubRole('54')).toBe('wedge');
  });

  it('rampScore clamps to [0, 100]', () => {
    expect(rampScore(-1, 0.05, 0.3)).toBe(100);
    expect(rampScore(1, 0.05, 0.3)).toBe(0);
  });
});

describe('ADR-0005 fixture consistency (shared calculation source)', () => {
  it('the docs fixture, run against ratings.ts, prints the ADR §8 tables', () => {
    const appRoot = fileURLToPath(new URL('../..', import.meta.url));
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', '../docs/adr/adr-0005-illustrative-scores.mjs'],
      { cwd: appRoot, encoding: 'utf8', timeout: 60000 },
    );
    // ADR §8 anchors: worked example, scenario tables, sensitivity bounds.
    for (const anchor of ['79.4', '47.4', '91.0', '99.6', '84.4', '94.4', '103.7%', '93.6 (prov. 3/4)']) {
      expect(out).toContain(anchor);
    }
    expect(out).toContain(RATINGS_VERSION);
  }, 90000);
});

describe('clubRating on the fixed premium-flat rating basis', () => {
  it('computes all four categories and a full composite from one session', () => {
    const data = clubDataset({ fromCentre: [2, 4, 3, 5], launchDirection: [1, 2, 3] });
    const r = clubRating(data, query, '7i', [ref()])!;
    expect(r.basis).toBe(RATING_BASIS);
    expect(r.ratingsVersion).toBe(RATINGS_VERSION);
    expect(r.distancePotential.reference?.type).toBe('personal-goal');
    expect(r.distancePotential.reference?.match).toBe('exact');
    expect(r.distancePotential.score).not.toBeNull();
    expect(r.consistency.score).not.toBeNull();
    expect(r.directionalControl.score).not.toBeNull();
    expect(r.directionalControl.measurementBasis).toBe('lateral');
    expect(r.reliability.score).toBe(100);
    expect(r.composite.coverage).toBe(4);
    expect(r.composite.provisional).toBe(false);
    // Composite equals the weighted sum of the category scores.
    const cats: Record<CategoryId, number | null> = {
      distancePotential: r.distancePotential.score,
      consistency: r.consistency.score,
      directionalControl: r.directionalControl.score,
      reliability: r.reliability.score,
    };
    expect(r.composite.value).toBeCloseTo(compositeScore(cats).value!, 10);
  });

  it('new club with one session: early provisional evidence, distance withheld without any reference', () => {
    const data = clubDataset({ fromCentre: [3], launchDirection: [2] });
    const r = clubRating(data, query, '7i', [])!;
    expect(r.distancePotential.reference).toBeNull();
    expect(r.distancePotential.score).toBeNull();
    expect(r.distancePotential.p80).not.toBeNull(); // measured potential still reported
    expect(r.distancePotential.evidence).toBe('early');
    expect(r.composite.provisional).toBe(true);
    expect(r.composite.coverage).toBe(3);
    expect(r.composite.value).not.toBeNull();
  });

  it('reference compatibility: exact vs family-level vs unknown legacy rows', () => {
    expect(ratingReferenceMatch('premium-flat')).toBe('exact');
    expect(ratingReferenceMatch('premium')).toBe('family');
    expect(ratingReferenceMatch('unknown')).toBeNull();
    expect(ratingReferenceMatch('range')).toBeNull();
    expect(ratingReferenceMatch('range-flat')).toBeNull();
    const data = clubDataset({});
    const family = clubRating(data, query, '7i', [ref({ basis: 'premium' })]);
    expect(family!.distancePotential.reference?.match).toBe('family');
    // 'unknown' legacy rows are never silently compared — falls through to
    // historical potential (none here) and then null.
    const legacy = clubRating(data, query, '7i', [ref({ basis: 'unknown' })]);
    expect(legacy!.distancePotential.reference).toBeNull();
    expect(legacy!.distancePotential.score).toBeNull();
  });

  it('missing premium-flat measurements stay missing — no silent range-ball substitution', () => {
    const data = clubDataset({ rangeOnly: true, fromCentre: [3], launchDirection: [2] });
    const r = clubRating(data, query, '7i', [ref()])!;
    expect(r.basis).toBe('premium-flat');
    expect(r.distancePotential.p80).toBeNull();
    expect(r.distancePotential.score).toBeNull();
    expect(r.consistency.n).toBe(0);
    expect(r.consistency.score).toBeNull();
    // Ratings never read the display basis: range-only data yields no rating.
    expect(r.composite.coverage).toBeLessThan(4);
  });

  it('severe mishits lower reliability to 75 at a 25% share, with distinct uncertainty layers', () => {
    const data = clubDataset({
      sessions: [{ date: TODAY, count: 12, base: 140 }],
      mishits: 3, // 3/12 assessed mishits
      fromCentre: [3],
      launchDirection: [2],
    });
    const r = clubRating(data, query, '7i', [ref()])!;
    expect(r.reliability.assessed).toBe(12);
    expect(r.reliability.mishitShare).toBeCloseTo(0.25, 10);
    expect(r.reliability.score).toBe(75);
    expect(r.reliability.wilson).not.toBeNull(); // sampling uncertainty only
    expect(r.reliability.sensitivity).toEqual({ allUnassessedMishit: 75, allUnassessedClean: 75 });
  });

  it('unassessed shots widen the missingness sensitivity range over the full population', () => {
    const data = clubDataset({
      sessions: [{ date: TODAY, count: 12, base: 140 }],
      mishits: 1,
      unassessed: 3, // 8 assessed (1 mishit), 4 unassessed of 12 full swings
      fromCentre: [3],
      launchDirection: [2],
    });
    const r = clubRating(data, query, '7i', [ref()])!;
    // assessed < 10 → no normalized score, but the raw rate and bounds exist.
    // (Manual 'uncertain' falls through to the automatic layer, so the exact
    // assessed count is derived, not hardcoded.)
    expect(r.reliability.score).toBeNull();
    expect(r.reliability.assessed).toBeLessThan(10);
    expect(r.reliability.assessed + r.reliability.unassessed).toBe(12);
    expect(r.reliability.mishitShare).toBeCloseTo(1 / r.reliability.assessed, 10);
    const u = r.reliability.unassessed / 12;
    const rate = r.reliability.mishitShare!;
    expect(r.reliability.sensitivity!.allUnassessedMishit).toBeCloseTo(reliabilityScore(u + (1 - u) * rate)!, 10);
    expect(r.reliability.sensitivity!.allUnassessedClean).toBeCloseTo(reliabilityScore((1 - u) * rate)!, 10);
    expect(r.reliability.sensitivity!.allUnassessedMishit!).toBeLessThan(r.reliability.sensitivity!.allUnassessedClean!);
  });

  it('partial PW shots never enter the full-swing rating populations', () => {
    const data = clubDataset({
      club: 'PW',
      sessions: [{ date: TODAY, count: 16, base: 100 }],
      partials: 6, // 6 partials, 10 full
      fromCentre: [3],
      launchDirection: [2],
    });
    const r = clubRating(data, query, 'PW', [ref({ club: 'PW', valueM: 120 })])!;
    expect(r.role).toBe('wedge');
    expect(r.reliability.assessed).toBe(10);
    expect(r.consistency.n).toBe(10);
  });

  it('launch direction is display-only: without fromCentre the direction category is withheld from the composite; curvature never substitutes', () => {
    const withLaunch = clubDataset({ fromCentre: null, launchDirection: [2], curve: [5] });
    const r = clubRating(withLaunch, query, '7i', [ref()])!;
    expect(r.directionalControl.measurementBasis).toBe('launch');
    expect(r.directionalControl.score).toBeNull(); // never silently replaced
    expect(r.directionalControl.launchScore).not.toBeNull(); // shown separately
    expect(r.composite.coverage).toBe(3);
    expect(r.composite.provisional).toBe(true);
    const noDirection = clubDataset({ fromCentre: null, launchDirection: null });
    const r2 = clubRating(noDirection, query, '7i', [ref()])!;
    expect(r2.directionalControl.measurementBasis).toBe('none');
    expect(r2.directionalControl.launchScore).toBeNull();
  });

  it('consistency: raw IQR shows at 4+ measurements, normalized rating needs 10', () => {
    const few = clubDataset({
      sessions: [{ date: TODAY, count: 8, base: 140 }],
      fromCentre: [3],
      launchDirection: [2],
    });
    const r = clubRating(few, query, '7i', [ref()])!;
    expect(r.consistency.iqr).not.toBeNull();
    expect(r.consistency.score).toBeNull();
    expect(r.consistency.note).toContain('10');
  });

  it('historical personal potential excludes the evaluated window; all-time view leaves no independent reference', () => {
    const data = clubDataset({
      sessions: [
        { date: '2026-08-01', count: 12, base: 130 },
        { date: '2026-09-01', count: 12, base: 135 },
        { date: TODAY, count: 12, base: 150 }, // current window — must not set its own reference
      ],
      fromCentre: [3],
      launchDirection: [2],
    });
    const recent = { ...query, mode: 'recent' as const };
    const hist = historicalPersonalPotential(data, '7i', recent);
    expect(hist).not.toBeNull();
    expect(hist!).toBeLessThan(150); // from the two older visits only
    const reference = resolveRatingReference('7i', data, recent, []);
    expect(reference?.type).toBe('historical-potential');
    expect(reference!.valueM).toBe(hist);
    // All-time: every session is under evaluation → no independent historical reference.
    const allTime = { ...query, mode: 'all' as const };
    expect(historicalPersonalPotential(data, '7i', allTime)).toBeNull();
    expect(resolveRatingReference('7i', data, allTime, [])).toBeNull();
  });

  it('historical reference stability: appending a future session does not move the reference', () => {
    const base = clubDataset({
      sessions: [
        { date: '2026-08-01', count: 12, base: 130 },
        { date: '2026-09-01', count: 12, base: 135 },
      ],
    });
    const before = historicalPersonalPotential(base, '7i', query);
    const afterData = clubDataset({
      sessions: [
        { date: '2026-08-01', count: 12, base: 130 },
        { date: '2026-09-01', count: 12, base: 135 },
        { date: TODAY, count: 12, base: 160 },
      ],
    });
    const after = historicalPersonalPotential(afterData, '7i', query);
    expect(after).toBe(before); // the new current-window session is excluded
  });

  it('zero/negative carries are missing measurements, never distances (ADR-0005 §6)', () => {
    // Reviewer case: 9 positive carries + 1 zero placeholder must NOT satisfy
    // the 10-measurement gate.
    const data = clubDataset({
      sessions: [{ date: TODAY, count: 10, base: 140 }],
      fromCentre: [3],
      launchDirection: [2],
    });
    data.shots[3]!.measurements.flatCarryPremium = 0;
    const r = clubRating(data, query, '7i', [ref()])!;
    expect(r.consistency.n).toBe(9);
    expect(r.consistency.score).toBeNull();
    expect(r.distancePotential.n).toBe(9);
    expect(r.distancePotential.p80).toBeNull(); // potentialCarry needs 10 measured
    // ...but the shot still counts in the reliability and lateral populations.
    expect(r.reliability.assessed + r.reliability.unassessed).toBe(10);
    expect(r.directionalControl.n).toBe(10);
  });

  it('zero carries do not distort the median/IQR or the direction denominator', () => {
    const data = clubDataset({
      sessions: [{ date: TODAY, count: 12, base: 140 }],
      fromCentre: [3],
      launchDirection: [2],
    });
    data.shots[0]!.measurements.flatCarryPremium = 0;
    const r = clubRating(data, query, '7i', [ref()])!;
    expect(r.consistency.n).toBe(11);
    expect(r.consistency.median!).toBeGreaterThan(100); // not dragged toward 0
    expect(r.consistency.score).not.toBeNull();
  });

  it('evidence levels use each category’s own contributing visits, not the whole selection', () => {
    // 30 eligible full swings from ONE session, plus partial-only shots in two
    // other recent sessions: categories must stay provisional-high-sample,
    // not "supported".
    const data = structuredClone(emptyDataset);
    const full = makeSession({ date: TODAY });
    const partialA = makeSession({ date: '2026-11-15' });
    const partialB = makeSession({ date: '2026-11-05' });
    data.sessions.push(full, partialA, partialB);
    for (let i = 0; i < 30; i++) {
      data.shots.push(
        makeShot({
          sessionId: full.id,
          rowIndex: i + 1,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 135 + (i % 9), fromCentre: 3, launchDirection: 2 },
          review: { intent: 'full', contact: 'typical' },
        }),
      );
    }
    for (const s of [partialA, partialB]) {
      for (let i = 0; i < 5; i++) {
        data.shots.push(
          makeShot({
            sessionId: s.id,
            rowIndex: i + 1,
            recordedClub: '7i',
            measurements: { flatCarryPremium: 60, fromCentre: 2, launchDirection: 1 },
            review: { intent: 'partial', contact: 'typical' },
          }),
        );
      }
    }
    const r = clubRating(data, query, '7i', [ref()])!;
    expect(r.consistency.n).toBe(30);
    expect(r.consistency.visits).toBe(1);
    expect(r.consistency.evidence).toBe('provisional-high-sample');
    expect(r.reliability.evidence).toBe('provisional-high-sample');
    expect(r.distancePotential.evidence).toBe('provisional-high-sample');
  });

  it('clubRatings covers every club in bag order and never reads a display basis', () => {
    const data = clubDataset({
      sessions: [{ date: TODAY, count: 12, base: 140 }],
      fromCentre: [3],
      launchDirection: [2],
    });
    const extra = makeSession({ date: TODAY });
    data.sessions.push(extra);
    for (let i = 0; i < 12; i++) {
      data.shots.push(
        makeShot({
          sessionId: extra.id,
          rowIndex: i + 1,
          recordedClub: 'D',
          measurements: { flatCarryPremium: 230 + i, fromCentre: 8, launchDirection: 3 },
          review: { intent: 'full', contact: 'typical' },
        }),
      );
    }
    const ratings = clubRatings(data, query, []);
    expect(ratings.map((r) => r.club)).toEqual(['D', '7i']);
    expect(ratings.every((r) => r.basis === 'premium-flat')).toBe(true);
  });

  it('rating cohort follows the time window only — intent/contact/mishit/scope filters never change ratings', () => {
    const data = clubDataset({
      sessions: [
        { date: TODAY, count: 12, base: 140 },
        { date: '2026-11-20', count: 12, base: 138 },
      ],
      mishits: 2,
      partials: 3,
      fromCentre: [3],
      launchDirection: [2],
    });
    const baseline = clubRating(data, query, '7i', [ref()])!;
    const variants = [
      { ...query, intent: 'full' as const },
      { ...query, intent: 'partial' as const },
      { ...query, contact: 'typical' as const },
      { ...query, contact: 'strong' as const },
      { ...query, hideLikelyMishits: true },
      { ...query, scopeSessionId: data.sessions[1]!.id },
    ];
    for (const v of variants) {
      expect(clubRating(data, v, '7i', [ref()])).toEqual(baseline);
    }
    expect(clubRatings(data, variants[0]!, [ref()])).toEqual(clubRatings(data, query, [ref()]));
  });

  it('reference resolution respects referenceType — only goals are personal references', () => {
    const data = clubDataset({ fromCentre: [3], launchDirection: [2] });
    const observed = clubRating(data, query, '7i', [
      ref({ referenceType: 'observed', statistic: 'p80' }),
    ])!;
    // An observed personal best is a distinct concept, never mixed into the
    // goal reference; with no historical potential it yields no reference.
    expect(observed.distancePotential.reference).toBeNull();
    expect(observed.distancePotential.score).toBeNull();
    const historicalRow = clubRating(data, query, '7i', [
      ref({ referenceType: 'historical-potential' }),
    ])!;
    expect(historicalRow.distancePotential.reference).toBeNull();
    const goal = clubRating(data, query, '7i', [
      ref({ referenceType: 'goal', statistic: 'p80', recordedOn: '2026-11-20' }),
    ])!;
    expect(goal.distancePotential.reference?.type).toBe('personal-goal');
    expect(goal.distancePotential.reference?.statistic).toBe('p80');
    expect(goal.distancePotential.reference?.recordedOn).toBe('2026-11-20');
    expect(goal.distancePotential.score).not.toBeNull();
  });

  it('reference resolution respects equipment identity — tagged references apply only to the currently assigned equipment', () => {
    const data = clubDataset({ fromCentre: [3], launchDirection: [2] });
    const equipment = makeEquipment({
      id: 'cccccccc-0000-4000-8000-000000000001',
      inrangeLabel: '7i',
      name: 'Fitted 7i',
    });
    data.equipment.push(equipment);
    // Current assignment on the window's 7i shots.
    for (const shot of data.shots) {
      data.equipmentAssignments.push({
        shotId: shot.id,
        equipmentId: equipment.id,
        clubLabel: '7i',
      });
    }
    const matching = clubRating(data, query, '7i', [
      ref({ equipmentId: equipment.id }),
    ])!;
    expect(matching.distancePotential.reference?.type).toBe('personal-goal');
    // A different physical club was measured — the reference must not apply.
    const mismatched = clubRating(data, query, '7i', [
      ref({ equipmentId: 'dddddddd-0000-4000-8000-000000000002' }),
    ])!;
    expect(mismatched.distancePotential.reference).toBeNull();
    // No assignments at all: an equipment-tagged reference cannot be verified.
    const unassigned = structuredClone(data);
    unassigned.equipmentAssignments = [];
    const unverifiable = clubRating(unassigned, query, '7i', [
      ref({ equipmentId: equipment.id }),
    ])!;
    expect(unverifiable.distancePotential.reference).toBeNull();
    // Untagged references (legacy rows) apply regardless of assignments.
    const untagged = clubRating(unassigned, query, '7i', [ref({ equipmentId: null })])!;
    expect(untagged.distancePotential.reference?.type).toBe('personal-goal');
  });

  it('weakestEvidence ranks evidence levels across rated categories', () => {
    expect(weakestEvidence([])).toBeNull();
    expect(weakestEvidence(['supported', 'early', 'provisional'])).toBe('early');
    expect(
      weakestEvidence(['provisional-high-sample', 'provisional', 'supported']),
    ).toBe('provisional');
    expect(weakestEvidence(['supported'])).toBe('supported');
  });
});
