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
import { compareSessions } from './compare';

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
