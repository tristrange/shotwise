import { describe, expect, it } from 'vitest';
import { makeSession, makeShot } from './fixtures';
import {
  BASES,
  emptyDataset,
  shiftDate,
  type Basis,
  type Dataset,
  type Review,
  type Session,
  type Shot,
} from './model';
import {
  compareSessions,
  MIN_TYPICAL_MEASURED,
  type TypicalCarry,
} from './compare';

const reference = makeSession({
  id: 'ref-1',
  date: '2026-11-10',
  time: '10:00',
  venue: 'Range A',
  filename: 'morning.csv',
});
const comparison = makeSession({
  id: 'cmp-1',
  date: '2026-11-16',
  time: '12:00',
  venue: 'Range A',
  filename: 'evening.csv',
});

type ShotOptions = NonNullable<Parameters<typeof makeShot>[0]>;
function series(
  session: Session,
  carries: (number | null)[],
  options: ShotOptions = {},
) {
  return carries.map((carry, i) =>
    makeShot({
      ...options,
      id: `${session.id}-${i}`,
      rowIndex: (options.rowIndex ?? 1) + i,
      sessionId: session.id,
      measurements: { flatCarryPremium: carry, ...options.measurements },
    }),
  );
}

function build(sessions: Session[], shots: Shot[]): Dataset {
  return { ...emptyDataset, sessions, shots };
}

function compare(
  shots: Shot[],
  basis: Basis = 'premium-flat',
  intent: Parameters<typeof compareSessions>[4] = 'all',
  sessions: Session[] = [reference, comparison],
) {
  return compareSessions(
    build(sessions, shots),
    reference.id,
    comparison.id,
    basis,
    intent,
  );
}

describe('session comparison', () => {
  it('reports recorded and included counts with median carry, IQR and signed deltas', () => {
    const result = compare([
      ...series(reference, [100, 102, 104, 106, null]),
      ...series(comparison, [110, 112, 114, 116, 118]),
    ]);
    expect(result.duplicate).toBe(false);
    expect(result.reference).toMatchObject({
      available: true,
      recorded: 5,
      included: 5,
      afterIntent: 5,
    });
    expect(result.comparison).toMatchObject({ recorded: 5, included: 5 });
    expect(result.common).toHaveLength(1);
    const club = result.common[0];
    expect(club?.club).toBe('7i');
    expect(club?.reference.included).toBe(5);
    expect(club?.reference.carry).toMatchObject({
      n: 4,
      missing: 1,
      median: 103,
    });
    expect(club?.reference.carry.iqr).toBe(3);
    expect(club?.comparison.carry.median).toBe(114);
    expect(club?.carryDelta).toBeCloseTo(11);
    expect(club?.iqrDelta).toBeCloseTo(1);
    expect(result.referenceOnly).toEqual([]);
    expect(result.comparisonOnly).toEqual([]);
  });

  it('keeps IQR unavailable below four measured shots and labels sparse data through n', () => {
    const result = compare([
      ...series(reference, [100, 108]),
      ...series(comparison, [110]),
    ]);
    const club = result.common[0];
    expect(club?.reference.carry.n).toBe(2);
    expect(club?.reference.carry.iqr).toBeNull();
    expect(club?.comparison.carry.n).toBe(1);
    expect(club?.comparison.carry.median).toBe(110);
    expect(club?.iqrDelta).toBeNull();
    expect(club?.carryDelta).toBeCloseTo(6);
  });

  it('uses the carry key of every basis on both sides', () => {
    const keys = Object.values(BASES).map((fields) => fields.carry);
    for (const basis of Object.keys(BASES) as Basis[]) {
      const key = BASES[basis].carry;
      expect(keys).toContain(key);
      const result = compare(
        [
          ...series(reference, [90], {
            measurements: Object.fromEntries(
              Object.values(BASES).map((fields) => [fields.carry, 90]),
            ) as ShotOptions['measurements'],
          }),
          ...series(comparison, [120], {
            measurements: Object.fromEntries(
              Object.values(BASES).map((fields) => [fields.carry, 120]),
            ) as ShotOptions['measurements'],
          }),
        ],
        basis,
      );
      const club = result.common[0];
      expect(club?.reference.carry.median).toBe(90);
      expect(club?.comparison.carry.median).toBe(120);
      expect(club?.carryDelta).toBeCloseTo(30);
      expect(result.basis).toBe(basis);
      expect(result.basisLabel).toBe(BASES[basis].label);
    }
  });

  it('distinguishes same-day sessions by exact ID', () => {
    const morning = makeSession({
      id: 'same-am',
      date: '2026-11-16',
      time: '09:00',
      filename: 'am.csv',
    });
    const evening = makeSession({
      id: 'same-pm',
      date: '2026-11-16',
      time: '18:00',
      filename: 'pm.csv',
    });
    const result = compareSessions(
      build(
        [morning, evening],
        [...series(morning, [100, 101]), ...series(evening, [130, 131])],
      ),
      'same-pm',
      'same-am',
      'premium-flat',
      'all',
    );
    expect(result.reference.session?.id).toBe('same-pm');
    expect(result.comparison.session?.id).toBe('same-am');
    expect(result.common[0]?.carryDelta).toBeCloseTo(-30);
  });

  it('applies the intent filter to both sides and keeps mishits by default', () => {
    const full = (): Partial<Review> => ({ intent: 'full' });
    const result = compare(
      [
        ...series(reference, [100, 101], { review: full() }),
        ...series(reference, [90], {
          review: { intent: 'partial', contact: 'mishit' },
        }),
        ...series(comparison, [110, 111], { review: full() }),
        ...series(comparison, [95], { review: { intent: 'partial' } }),
      ],
      'premium-flat',
      'all',
    );
    // All intents: every included shot counts, including the marked mishit.
    expect(result.reference.included).toBe(3);
    expect(result.comparison.included).toBe(3);
    expect(result.common[0]?.reference.included).toBe(3);
    expect(result.common[0]?.comparison.carry.n).toBe(3);

    const fullOnly = compare(
      [
        ...series(reference, [100, 101], { review: full() }),
        ...series(reference, [90], { review: { intent: 'partial' } }),
        ...series(comparison, [110, 111], { review: full() }),
        ...series(comparison, [95], { review: { intent: 'partial' } }),
      ],
      'premium-flat',
      'full',
    );
    expect(fullOnly.common[0]?.reference.included).toBe(2);
    expect(fullOnly.comparison.included).toBe(3);
    expect(fullOnly.comparison.afterIntent).toBe(2);
    expect(fullOnly.reference.afterIntent).toBe(2);
    expect(fullOnly.common[0]?.reference.carry.median).toBe(100.5);

    const partialOnly = compare(
      [
        ...series(reference, [100], { review: full() }),
        ...series(reference, [90, 92], { review: { intent: 'partial' } }),
        ...series(comparison, [110], { review: full() }),
        ...series(comparison, [95], { review: { intent: 'partial' } }),
      ],
      'premium-flat',
      'partial',
    );
    expect(partialOnly.common[0]?.reference.included).toBe(2);
    expect(partialOnly.common[0]?.comparison.included).toBe(1);
    expect(partialOnly.common[0]?.reference.carry.median).toBe(91);

    const unknownOnly = compare(
      [
        ...series(reference, [100], { review: { intent: 'full' } }),
        ...series(reference, [88], {}),
        ...series(comparison, [110], { review: { intent: 'full' } }),
        ...series(comparison, [98], {}),
      ],
      'premium-flat',
      'unknown',
    );
    expect(unknownOnly.common[0]?.reference.included).toBe(1);
    expect(unknownOnly.common[0]?.comparison.included).toBe(1);
  });

  it('groups by corrected club labels and honours explicit exclusions', () => {
    const result = compare([
      ...series(reference, [100, 102], {
        recordedClub: '7i',
        review: { club: { kind: 'corrected', club: '5i' } },
      }),
      ...series(reference, [200], {
        recordedClub: '7i',
        review: {
          exclusion: { kind: 'excluded', reason: 'net interference' },
        },
      }),
      ...series(comparison, [150, 152], { recordedClub: '5i' }),
      ...series(comparison, [210], { recordedClub: '7i' }),
    ]);
    expect(result.reference.recorded).toBe(3);
    expect(result.reference.included).toBe(2);
    expect(result.common.map((c) => c.club)).toEqual(['5i']);
    expect(result.common[0]?.reference.included).toBe(2);
    expect(result.common[0]?.reference.carry.median).toBe(101);
    // The excluded 7i shot never appears in any club list, so reference has
    // no 7i group and comparison's 7i is one-sided.
    expect(result.referenceOnly).toEqual([]);
    expect(result.comparisonOnly).toEqual([{ club: '7i', included: 1 }]);
    expect(result.common[0]?.comparison.carry.median).toBe(151);
  });

  it('lists one-sided clubs and reports no common clubs', () => {
    const overlapping = compare([
      ...series(reference, [100, 101], { recordedClub: '7i' }),
      ...series(reference, [140], { recordedClub: '5i' }),
      ...series(comparison, [110, 111], { recordedClub: '7i' }),
      ...series(comparison, [160], { recordedClub: '3w' }),
    ]);
    expect(overlapping.common.map((c) => c.club)).toEqual(['7i']);
    expect(overlapping.referenceOnly).toEqual([{ club: '5i', included: 1 }]);
    expect(overlapping.comparisonOnly).toEqual([{ club: '3w', included: 1 }]);

    const disjoint = compare([
      ...series(reference, [100], { recordedClub: '7i' }),
      ...series(comparison, [160], { recordedClub: '3w' }),
    ]);
    expect(disjoint.common).toEqual([]);
    expect(disjoint.referenceOnly).toEqual([{ club: '7i', included: 1 }]);
    expect(disjoint.comparisonOnly).toEqual([{ club: '3w', included: 1 }]);
  });

  it('marks archived, missing and duplicate selections as unavailable', () => {
    const archived = makeSession({
      ...comparison,
      id: 'cmp-archived',
      archived: true,
    });
    const archivedResult = compareSessions(
      build(
        [reference, archived],
        [...series(reference, [100]), ...series(archived, [120])],
      ),
      reference.id,
      archived.id,
      'premium-flat',
      'all',
    );
    expect(archivedResult.comparison.available).toBe(false);
    expect(archivedResult.comparison.session?.archived).toBe(true);
    expect(archivedResult.common).toEqual([]);
    expect(archivedResult.reference.available).toBe(true);

    const missingResult = compareSessions(
      build([reference], series(reference, [100])),
      reference.id,
      'does-not-exist',
      'premium-flat',
      'all',
    );
    expect(missingResult.comparison.session).toBeNull();
    expect(missingResult.comparison.available).toBe(false);
    expect(missingResult.comparison.recorded).toBe(0);
    expect(missingResult.common).toEqual([]);

    const duplicateResult = compareSessions(
      build([reference], series(reference, [100])),
      reference.id,
      reference.id,
      'premium-flat',
      'all',
    );
    expect(duplicateResult.duplicate).toBe(true);
    expect(duplicateResult.common).toEqual([]);
  });

  it('uses complete old sessions with large shot counts, independent of Recent', () => {
    const old = makeSession({
      id: 'old-1',
      date: shiftDate(comparison.date, -200),
      filename: 'old-big.csv',
    });
    const bigRef = series(
      reference,
      Array.from({ length: 80 }, (_, i) => 100 + (i % 5)),
    );
    const bigOld = series(
      old,
      Array.from({ length: 80 }, (_, i) => 120 + (i % 5)),
    );
    const result = compareSessions(
      build(
        [reference, old, comparison],
        [...bigRef, ...bigOld, ...series(comparison, [130])],
      ),
      reference.id,
      old.id,
      'premium-flat',
      'all',
    );
    // No 50-shot Recent cap: all 80 included shots of the old session count.
    expect(result.comparison.included).toBe(80);
    expect(result.common[0]?.comparison.included).toBe(80);
    expect(result.common[0]?.comparison.carry.n).toBe(80);
    expect(result.common[0]?.carryDelta).toBeCloseTo(20);
  });

  it('orders clubs by club order and skips unknown club labels in club lists', () => {
    const result = compare([
      ...series(reference, [100], { recordedClub: '9i' }),
      ...series(reference, [200], { recordedClub: 'Driver' }),
      ...series(reference, [50], { recordedClub: '?' }),
      ...series(comparison, [110], { recordedClub: '9i' }),
      ...series(comparison, [210], { recordedClub: 'Driver' }),
      ...series(comparison, [55], { recordedClub: 'unknown' }),
    ]);
    expect(result.common.map((c) => c.club)).toEqual(['Driver', '9i']);
    // Unknown-club shots still count toward session-level included counts.
    expect(result.reference.included).toBe(3);
    expect(result.comparison.included).toBe(3);
  });

  it('computes signed deltas as comparison minus reference', () => {
    const up = compare([
      ...series(reference, [100, 102, 104, 106]),
      ...series(comparison, [90, 92, 94, 96]),
    ]);
    expect(up.common[0]?.carryDelta).toBeCloseTo(-10);
    expect(up.common[0]?.iqrDelta).toBeCloseTo(0);

    const missingMedian = compare([
      ...series(reference, [null, null]),
      ...series(comparison, [100, 102, 104, 106]),
    ]);
    expect(missingMedian.common[0]?.reference.carry.median).toBeNull();
    expect(missingMedian.common[0]?.reference.carry.n).toBe(0);
    expect(missingMedian.common[0]?.reference.carry.missing).toBe(2);
    expect(missingMedian.common[0]?.carryDelta).toBeNull();
  });
});

describe('comparison details', () => {
  const typicalReview = (): Partial<Review> => ({
    intent: 'full',
    contact: 'typical',
  });
  const fullReview = (): Partial<Review> => ({ intent: 'full' });

  type DetailRow = {
    carry: number | null;
    speed?: number | null;
    launch?: number | null;
    apex?: number | null;
    dir?: number | null;
    curve?: number | null;
    lateral?: number | null;
    review?: Partial<Review>;
  };
  function detailSeries(session: Session, rows: DetailRow[]) {
    return rows.map((row, i) =>
      makeShot({
        id: `${session.id}-d${i}`,
        rowIndex: i + 1,
        sessionId: session.id,
        measurements: {
          flatCarryPremium: row.carry,
          speedPremium: row.speed ?? null,
          launchPremium: row.launch ?? null,
          apexPremium: row.apex ?? null,
          launchDirection: row.dir ?? null,
          curve: row.curve ?? null,
          fromCentre: row.lateral ?? null,
        },
        review: row.review,
      }),
    );
  }

  it('uses the reviewed typical cohort only when both sides have at least 10 measured carries in it', () => {
    const result = compare([
      ...detailSeries(
        reference,
        Array.from({ length: MIN_TYPICAL_MEASURED + 2 }, (_, i) => ({
          carry: 100 + i * 2,
          review: typicalReview(),
        })),
      ),
      // Unknown-intent shots stay out of the reviewed cohort.
      ...detailSeries(reference, [{ carry: 999 }]),
      ...detailSeries(
        comparison,
        Array.from({ length: MIN_TYPICAL_MEASURED + 2 }, (_, i) => ({
          carry: 110 + i * 2,
          review: typicalReview(),
        })),
      ),
    ]);
    const club = result.common[0];
    const typical = club?.typical as Extract<
      TypicalCarry,
      { kind: 'reviewed' | 'broader' }
    >;
    expect(typical.kind).toBe('reviewed');
    expect(typical.label).toContain('reviewed full swings');
    expect(typical.reference.n).toBe(MIN_TYPICAL_MEASURED + 2);
    expect(typical.comparison.n).toBe(MIN_TYPICAL_MEASURED + 2);
    expect(typical.reference.median).toBe(111);
    expect(typical.comparison.median).toBe(121);
    expect(typical.delta).toBeCloseTo(10);
    expect(typical.pctDelta).toBeCloseTo(10 / 111);
  });

  it('falls back to the same labelled broader cohort when one side is below the reviewed threshold', () => {
    const result = compare([
      ...detailSeries(
        reference,
        Array.from({ length: 12 }, (_, i) => ({
          carry: 100 + i * 2,
          review: typicalReview(),
        })),
      ),
      ...detailSeries(comparison, [
        ...Array.from({ length: MIN_TYPICAL_MEASURED - 1 }, (_, i) => ({
          carry: 110 + i * 2,
          review: typicalReview(),
        })),
        // Unknown intent with unassessed contact still counts in the broader cohort.
        ...Array.from({ length: 3 }, (_, i) => ({ carry: 130 + i })),
      ]),
    ]);
    const typical = result.common[0]?.typical as Extract<
      TypicalCarry,
      { kind: 'reviewed' | 'broader' }
    >;
    expect(typical.kind).toBe('broader');
    expect(typical.label).toContain('broader recap cohort');
    expect(typical.reference.n).toBe(12);
    expect(typical.comparison.n).toBe(12);
    expect(typical.comparison.median).toBe(121);
    expect(typical.delta).toBeCloseTo(10);
  });

  it('withholds the typical carry in a partial-only view', () => {
    const result = compare(
      [
        ...detailSeries(reference, [
          { carry: 100, review: { intent: 'partial' } },
          { carry: 102, review: { intent: 'partial' } },
        ]),
        ...detailSeries(comparison, [
          { carry: 110, review: { intent: 'partial' } },
        ]),
      ],
      'premium-flat',
      'partial',
    );
    const typical = result.common[0]?.typical;
    expect(typical?.kind).toBe('unavailable');
    expect(result.common[0]?.review.reference.thin).toBe(false);
    expect(result.common[0]?.review.comparison.thin).toBe(false);
    if (typical?.kind === 'unavailable') {
      expect(typical.reason).toContain('partial-only');
    }
  });

  it('shows flight medians with per-metric counts, missing and neutral native deltas', () => {
    const result = compare([
      ...detailSeries(reference, [
        { carry: 100, speed: 150, launch: 12, apex: 28, dir: -1 },
        { carry: 102, speed: 152, launch: 13, apex: 29, dir: -1 },
        { carry: 104, speed: null, launch: 14, apex: 30, dir: 0 },
        { carry: 106, speed: 156, launch: 15, apex: 31, dir: 1 },
        { carry: 108, speed: 158, launch: 16, apex: 32, dir: 1 },
      ]),
      ...detailSeries(comparison, [
        { carry: 110, speed: 160, launch: 14, apex: 30 },
        { carry: 112, speed: 162, launch: 15, apex: 31 },
        { carry: 114, speed: 164, launch: 16, apex: 32 },
        { carry: 116, speed: 166, launch: 17, apex: 33 },
        { carry: 118, speed: 168, launch: 18, apex: 34 },
      ]),
    ]);
    const { flight } = result.common[0]!;
    expect(flight.speed.reference).toMatchObject({
      n: 4,
      missing: 1,
      median: 154,
    });
    expect(flight.speed.comparison.median).toBe(164);
    expect(flight.speed.delta).toBeCloseTo(10);
    expect(flight.speed.pctDelta).toBeCloseTo(10 / 154);
    expect(flight.launch.reference).toMatchObject({
      n: 5,
      missing: 0,
      median: 14,
    });
    expect(flight.launch.delta).toBeCloseTo(2);
    expect(flight.launch.pctDelta).toBeNull();
    expect(flight.apex.reference.median).toBe(30);
    expect(flight.apex.comparison.median).toBe(32);
    expect(flight.apex.delta).toBeCloseTo(2);
  });

  it('shows relative carry change only with a positive reference and sufficient coverage', () => {
    const positive = compare([
      ...series(reference, [100, 102, 104, 106]),
      ...series(comparison, [110, 112, 114, 116]),
    ]);
    expect(positive.common[0]?.carryDelta).toBeCloseTo(10);
    expect(positive.common[0]?.carryPctDelta).toBeCloseTo(10 / 103);

    const zeroReference = compare([
      ...series(reference, [0, 0, 0, 0]),
      ...series(comparison, [10, 12, 14, 16]),
    ]);
    expect(zeroReference.common[0]?.carryDelta).toBeCloseTo(13);
    expect(zeroReference.common[0]?.carryPctDelta).toBeNull();

    const sparse = compare([
      ...series(reference, [100, 108]),
      ...series(comparison, [110, 118]),
    ]);
    expect(sparse.common[0]?.carryPctDelta).toBeNull();
    expect(sparse.common[0]?.sparse).toBe(true);
  });

  it('reports direction shares per side and percentage-point deltas', () => {
    const result = compare([
      ...detailSeries(reference, [
        { carry: 100, dir: -1, curve: -2, lateral: 3 },
        { carry: 102, dir: -1, curve: 0, lateral: 1 },
        { carry: 104, dir: 0, curve: 0, lateral: -1 },
        { carry: 106, dir: 1, curve: 2, lateral: -3 },
      ]),
      ...detailSeries(comparison, [
        { carry: 110, dir: -1 },
        { carry: 112, dir: 0 },
        { carry: 114, dir: 1 },
        { carry: 116, dir: 1 },
      ]),
    ]);
    const { direction } = result.common[0]!;
    expect(direction.launchDirection.reference).toMatchObject({
      n: 4,
      missing: 0,
      left: 2,
      straight: 1,
      right: 1,
    });
    expect(direction.launchDirection.reference.shares).toEqual({
      left: 0.5,
      straight: 0.25,
      right: 0.25,
    });
    expect(direction.launchDirection.comparison.shares).toEqual({
      left: 0.25,
      straight: 0.25,
      right: 0.5,
    });
    expect(direction.launchDirection.deltaPp).toEqual({
      left: -25,
      straight: 0,
      right: 25,
    });
    // Curve and lateral were only measured on the reference side.
    expect(direction.curve.comparison.n).toBe(0);
    expect(direction.curve.comparison.shares).toBeNull();
    expect(direction.curve.deltaPp).toBeNull();
    expect(direction.lateral.reference.n).toBe(4);
    expect(direction.lateral.comparison.missing).toBe(4);
  });

  it('reports confirmed mishits over reviewed full swings and review coverage', () => {
    const result = compare([
      ...detailSeries(reference, [
        { carry: 100, review: { ...fullReview(), contact: 'typical' } },
        { carry: 102, review: { ...fullReview(), contact: 'typical' } },
        { carry: 104, review: { ...fullReview(), contact: 'typical' } },
        { carry: 106, review: { ...fullReview(), contact: 'typical' } },
        { carry: 108, review: { ...fullReview(), contact: 'mishit' } },
        { carry: 110, review: { ...fullReview(), contact: 'uncertain' } },
        { carry: 112, review: { intent: 'partial', contact: 'typical' } },
      ]),
      ...detailSeries(comparison, [
        { carry: 120, review: { ...fullReview(), contact: 'typical' } },
        { carry: 122, review: { ...fullReview(), contact: 'mishit' } },
        { carry: 124, review: { ...fullReview(), contact: 'uncertain' } },
        { carry: 126, review: { ...fullReview(), contact: 'uncertain' } },
        { carry: 128, review: { ...fullReview(), contact: 'uncertain' } },
      ]),
    ]);
    const { review } = result.common[0]!;
    expect(review.reference).toMatchObject({
      fullSwings: 6,
      reviewed: 5,
      unassessed: 1,
      mishits: 1,
      thin: false,
    });
    expect(review.reference.rate).toBeCloseTo(1 / 5);
    expect(review.reference.reviewedShare).toBeCloseTo(5 / 6);
    // The partial swing is not a full swing, so it is outside the review basis.
    expect(review.comparison.fullSwings).toBe(5);
    expect(review.comparison.thin).toBe(true);
    expect(review.comparison.rate).toBeCloseTo(1 / 2);
    expect(review.rateDeltaPp).toBeCloseTo((0.5 - 0.2) * 100);
    expect(review.reviewedShareDeltaPp).toBeCloseTo((2 / 5 - 5 / 6) * 100);
  });

  it('flags differing venue, shot mix and measurement coverage between the visits', () => {
    const otherVenue = makeSession({
      ...comparison,
      id: 'cmp-venue',
      venue: 'Range B',
    });
    const result = compareSessions(
      build(
        [reference, otherVenue],
        [
          // Reference: every measured carry has unknown intent, all measured.
          ...series(reference, [100, 102, 104, 106, 108, 110, 112, 114], {}),
          // Comparison: full intent everywhere and half the carries missing.
          ...series(otherVenue, [120, null, 122, null, 124, null], {
            review: fullReview(),
          }),
        ],
      ),
      reference.id,
      otherVenue.id,
      'premium-flat',
      'all',
    );
    expect(result.venueDiffers).toBe(true);
    expect(result.shotMixDiffers).toBe(true);
    expect(result.coverageDiffers).toBe(true);
    expect(result.reference.mix.coverageShare).toBe(1);
    expect(result.comparison.mix.coverageShare).toBe(0.5);
    expect(result.reference.intents).toEqual({
      full: 0,
      partial: 0,
      unknown: 8,
    });
    expect(result.comparison.carryMeasured).toBe(3);
    expect(result.comparison.carryMissing).toBe(3);

    const sameVenue = compare([
      ...series(reference, [100, 102, 104, 106]),
      ...series(comparison, [110, 112, 114, 116]),
    ]);
    expect(sameVenue.venueDiffers).toBe(false);
    expect(sameVenue.shotMixDiffers).toBe(false);
    expect(sameVenue.coverageDiffers).toBe(false);
  });
});
