import { describe, expect, it } from 'vitest';
import { makeSession, makeShot } from './fixtures';
import {
  basisSchema,
  emptyDataset,
  shiftDate,
  type Basis,
  type Session,
  type Shot,
} from './model';
import { clubGaps, type AnalysisQuery } from './analytics';
import { clubProgress } from './progress';
import { sessionRecap } from './recap';
import { clubProfiles } from './clubProfiles';

const current = makeSession({ id: 'current', time: '12:00' });
const before = (days: number, overrides: Partial<Session> = {}) =>
  makeSession({
    id: 'prior-' + days,
    date: shiftDate(current.date, -days),
    ...overrides,
  });
const repeat = (n: number, value: number | null) =>
  Array<number | null>(n).fill(value);
const band = (n: number, width: number) => [
  ...repeat(Math.floor(n / 2), 100),
  ...repeat(Math.ceil(n / 2), 100 + width),
];

type ShotOptions = NonNullable<Parameters<typeof makeShot>[0]>;
function series(
  session: Session,
  carries: (number | null)[],
  options: ShotOptions = {},
) {
  return carries.map((carry, i) =>
    makeShot({
      ...options,
      id: options.id ? options.id + '-' + i : session.id + '-' + i + '-' + crypto.randomUUID().slice(0, 8),
      rowIndex: (options.rowIndex ?? 1) + i,
      sessionId: session.id,
      measurements: { flatCarryPremium: carry, ...options.measurements },
    }),
  );
}

const carryFields = (v: number) => ({
  carryRange: v + 30,
  flatCarryRange: v + 20,
  carryPremium: v + 10,
  flatCarryPremium: v,
});
const basisOffset: Record<Basis, number> = {
  range: 30,
  'range-flat': 20,
  premium: 10,
  'premium-flat': 0,
};

const query = (overrides: Partial<AnalysisQuery> = {}): AnalysisQuery => ({
  mode: 'all',
  today: current.date,
  intent: 'all',
  contact: 'all',
  ...overrides,
});
const profiles = (
  sessions: Session[],
  shots: Shot[],
  basis: Basis = 'premium-flat',
  q: AnalysisQuery = query(),
) => clubProfiles({ ...emptyDataset, sessions, shots }, basis, q);
const profile = (
  sessions: Session[],
  shots: Shot[],
  club: string,
  basis?: Basis,
  q?: AnalysisQuery,
) => {
  const row = profiles(sessions, shots, basis, q).find((p) => p.club === club);
  if (!row) throw new Error(`Expected a profile for ${club}`);
  return row;
};

const fullTypical = { intent: 'full', contact: 'typical' } as const;

describe('club profiles', () => {
  it.each(basisSchema.options)(
    'agrees with the session recap for the latest session of each club on %s',
    (basis) => {
      const offset = basisOffset[basis];
      const older = before(3);
      const middle = before(1, { time: '09:00' });
      const archived = before(2, { archived: true });
      const sessions = [current, middle, older, archived];
      const shots = [
        ...series(current, repeat(12, 120), {
          review: { ...fullTypical },
          measurements: carryFields(120),
        }),
        makeShot({
          id: 'corrected',
          sessionId: current.id,
          rowIndex: 20,
          recordedClub: '9i',
          review: {
            ...fullTypical,
            club: { kind: 'corrected', club: '7i' },
          },
          measurements: carryFields(125),
        }),
        ...series(current, repeat(3, 150), {
          recordedClub: '5i',
          review: { ...fullTypical },
          measurements: carryFields(150),
        }),
        ...series(middle, repeat(10, 100), {
          review: { ...fullTypical },
          measurements: carryFields(100),
        }),
        ...series(older, repeat(10, 98), {
          review: { ...fullTypical },
          measurements: carryFields(98),
        }),
        ...series(archived, repeat(10, 999), { measurements: carryFields(999) }),
      ];
      const data = { ...emptyDataset, sessions, shots };
      const rows = clubProfiles(data, basis, query());
      expect(rows.map((r) => r.club)).toEqual(['5i', '7i']);
      for (const row of rows) {
        const recap = sessionRecap(data, row.latest?.session.id ?? '', basis);
        expect(row.latest?.recap).toEqual(
          recap?.clubs.find((item) => item.club === row.club),
        );
      }
      const seven = profile(sessions, shots, '7i', basis);
      expect(seven.latest?.session.id).toBe(current.id);
      const preferred =
        seven.latest!.recap.potential[seven.latest!.recap.potential.preferred];
      expect(preferred.current).toMatchObject({
        measured: 13,
        missing: 0,
        value: 120 + offset,
      });
      expect(seven.latest!.recap.reliability.spread.current).toMatchObject({
        measured: 13,
        value: 0,
      });
      expect(seven.basis).toBe(basis);
      expect(seven.basisLabel).toBe(
        { range: 'Range', 'range-flat': 'Range · flat', premium: 'Premium (estimate)', 'premium-flat': 'Premium · flat (estimate)' }[
          basis
        ],
      );
    },
  );

  it('prefers the reviewed cohort for typical carry when it has enough evidence, otherwise the broader estimate', () => {
    const reviewedEnough = [
      ...series(current, repeat(12, 120), { review: { ...fullTypical } }),
      ...series(current, repeat(8, 140), { id: 'unreviewed' }),
    ];
    const seven = profile([current], reviewedEnough, '7i');
    expect(seven.recent.typical).toEqual({
      cohort: 'reviewed',
      median: 120,
      n: 12,
      missing: 0,
    });
    expect(seven.recent.spread).toMatchObject({ iqr: 20, n: 20 });

    const thinReviewed = [
      ...series(current, repeat(5, 120), { review: { ...fullTypical } }),
      ...series(current, repeat(10, 140), { id: 'unreviewed' }),
    ];
    const broader = profile([current], thinReviewed, '7i');
    expect(broader.recent.typical).toEqual({
      cohort: 'broader',
      median: 140,
      n: 15,
      missing: 0,
    });
  });

  it('keeps confirmed mishits and automatically flagged shots in reliability with the filter on', () => {
    const shots = [
      ...series(current, repeat(20, 120), {
        review: { intent: 'full' },
        measurements: { flatCarryRange: 120, speedRange: 50 },
      }),
      ...series(current, repeat(8, 20), {
        id: 'confirmed-mishits',
        rowIndex: 21,
        review: { intent: 'full', contact: 'mishit' },
      }),
      ...series(current, repeat(8, 20), {
        id: 'low-flight',
        rowIndex: 29,
        review: { intent: 'full' },
        measurements: { flatCarryRange: 20, speedRange: 15 },
      }),
    ];
    const unfiltered = profile([current], shots, '7i');
    const filtered = profile(
      [current],
      shots,
      '7i',
      undefined,
      query({ hideLikelyMishits: true }),
    );

    // Canonical basis reads the range measurements, so shots 11-20 are
    // auto-assessed as typical contact and the reviewed cohort (n=10) wins;
    // the reliability spread below still spans all 36 shots with the filter on.
    expect(unfiltered.recent.typical).toMatchObject({ cohort: 'reviewed', median: 120, n: 10 });
    expect(filtered.recent.typical.n).toBe(10);
    expect(filtered.recent.spread).toEqual({ iqr: 100, n: 36, missing: 0 });
    expect(filtered.recent.lowerTail).toEqual({ p10: 20, n: 36 });
    expect(filtered.recent.contact).toMatchObject({ fullReviewed: 8, mishits: 8 });
    expect(filtered.window.shots).toBe(36);
  });

  it('limits the recent window to 60 days while history stays all-time', () => {
    const old = before(100);
    const mid = before(30);
    const sessions = [current, mid, old];
    const shots = [
      ...series(current, repeat(10, 120)),
      ...series(mid, repeat(10, 110)),
      ...series(old, repeat(10, 70)),
    ];
    const recent = profile(sessions, shots, '7i', undefined, query({ mode: 'recent' }));
    expect(recent.window).toMatchObject({
      mode: 'recent',
      start: shiftDate(current.date, -59),
      end: current.date,
      sessions: 2,
      shots: 20,
      firstDate: mid.date,
      lastDate: current.date,
    });
    expect(recent.recent.typical.median).toBe(115);
    expect(recent.history.map((h) => h.session.id)).toEqual([
      old.id,
      mid.id,
      current.id,
    ]);
    const all = profile(sessions, shots, '7i');
    expect(all.window).toMatchObject({ mode: 'all', start: null, sessions: 3, shots: 30 });
    expect(all.recent.typical.median).toBe(110);
  });

  it.each(basisSchema.options)(
    'keeps missing measurements missing on %s without falling back to another basis',
    (basis) => {
      const session = current;
      const shots = [
        makeShot({
          sessionId: session.id,
          measurements: { flatCarryPremium: null, flatCarryRange: 90 },
        }),
        makeShot({
          id: 'second',
          sessionId: session.id,
          rowIndex: 2,
          measurements: { flatCarryPremium: null, flatCarryRange: 110 },
        }),
      ];
      const row = profile([session], shots, '7i', basis);
      // Only the flat range carry is recorded, so every other basis is missing.
      const measured = basis === 'range-flat';
      expect(row.recent.typical).toEqual(
        measured
          ? { cohort: 'broader', median: 100, n: 2, missing: 0 }
          : { cohort: 'broader', median: null, n: 0, missing: 2 },
      );
      if (measured) {
        expect(row.best).toMatchObject({ value: 110 });
      } else {
        expect(row.best).toBeNull();
      }
      expect(row.history[0]).toMatchObject({
        n: measured ? 2 : 0,
        missing: measured ? 0 : 2,
        median: measured ? 100 : null,
      });
    },
  );

  it('reports spread and lower tail only with enough measured shots', () => {
    const sparse = profile([current], series(current, [100, 105, 110]), '7i');
    expect(sparse.recent.spread).toEqual({ iqr: null, n: 3, missing: 0 });
    expect(sparse.recent.lowerTail).toEqual({ p10: null, n: 3 });
    const wide = profile(
      [current],
      series(current, [...repeat(12, 100), ...repeat(13, 120)]),
      '7i',
    );
    expect(wide.recent.spread).toMatchObject({ iqr: 20, n: 25 });
    expect(wide.recent.lowerTail.p10).not.toBeNull();
    expect(wide.recent.lowerTail.n).toBe(25);
  });

  it('ignores archived sessions, excluded shots and unknown clubs, and uses effective club labels', () => {
    const archived = before(1, { archived: true });
    const sessions = [current, archived];
    const shots = [
      ...series(current, repeat(5, 120)),
      makeShot({
        id: 'excluded',
        sessionId: current.id,
        rowIndex: 10,
        measurements: { flatCarryPremium: 999 },
        review: { exclusion: { kind: 'excluded', reason: 'Warm-up' } },
      }),
      makeShot({
        id: 'unknown',
        sessionId: current.id,
        rowIndex: 11,
        recordedClub: '?',
        measurements: { flatCarryPremium: 130 },
      }),
      makeShot({
        id: 'corrected',
        sessionId: current.id,
        rowIndex: 12,
        recordedClub: '9i',
        review: { club: { kind: 'corrected', club: '5i' } },
        measurements: { flatCarryPremium: 140 },
      }),
      ...series(archived, repeat(5, 999)),
    ];
    const rows = profiles(sessions, shots);
    expect(rows.map((r) => r.club)).toEqual(['5i', '7i']);
    const seven = rows.find((r) => r.club === '7i')!;
    expect(seven.window.shots).toBe(5);
    expect(seven.history).toHaveLength(1);
    expect(seven.best).toMatchObject({ value: 120, session: current });
    const five = rows.find((r) => r.club === '5i')!;
    expect(five.window.shots).toBe(1);
    expect(five.best).toMatchObject({ value: 140 });
  });

  it('qualifies the personal best by session and coverage and ignores deliberate partials', () => {
    const older = before(1);
    const shots = [
      ...series(older, repeat(4, 100), { review: { ...fullTypical } }),
      makeShot({
        id: 'hot-mishit',
        sessionId: current.id,
        measurements: { flatCarryPremium: 110 },
        review: { intent: 'full', contact: 'mishit' },
      }),
      makeShot({
        id: 'normal',
        sessionId: current.id,
        rowIndex: 2,
        measurements: { flatCarryPremium: 105 },
        review: { ...fullTypical },
      }),
      makeShot({
        id: 'partial',
        sessionId: current.id,
        rowIndex: 3,
        measurements: { flatCarryPremium: 200 },
        review: { intent: 'partial' },
      }),
    ];
    const seven = profile([older, current], shots, '7i');
    expect(seven.best).toMatchObject({
      value: 110,
      session: current,
      n: 3,
      missing: 0,
      reviewedShare: 1,
      mishit: true,
    });
    const withoutMishit = profile(
      [older, current],
      shots.filter((s) => s.id !== 'hot-mishit'),
      '7i',
    );
    expect(withoutMishit.best).toMatchObject({ value: 105, mishit: false });
  });

  it('lists history per session like Progress, oldest first, with counts', () => {
    const older = before(2);
    const mid = before(1);
    const sessions = [current, mid, older];
    const shots = [
      ...series(current, band(12, 8)),
      ...series(mid, band(12, 6)),
      ...series(older, [...repeat(4, 90), null]),
    ];
    const data = { ...emptyDataset, sessions, shots };
    const seven = profile(sessions, shots, '7i');
    const progressRow = clubProgress(data, 'premium-flat', query()).find(
      (r) => r.club === '7i',
    );
    expect(seven.history).toEqual(
      progressRow?.sessions.map((p) => ({
        session: p.session,
        n: p.n,
        missing: p.missing,
        median: p.median,
        iqr: p.iqr,
      })),
    );
    expect(seven.history.map((h) => [h.session.id, h.n, h.missing, h.median, h.iqr])).toEqual([
      [older.id, 4, 1, 90, 0],
      [mid.id, 12, 0, 103, 6],
      [current.id, 12, 0, 104, 8],
    ]);
  });

  it('carries the gapping row for the club', () => {
    const sessions = [current];
    const shots = [
      ...series(current, repeat(12, 140), { recordedClub: '5i' }),
      ...series(current, repeat(12, 122), { recordedClub: '7i', id: 'seven' }),
      ...series(current, repeat(12, 120), { recordedClub: '8i', id: 'eight' }),
    ];
    const data = { ...emptyDataset, sessions, shots };
    const seven = profile(sessions, shots, '7i');
    expect(seven.gap).toEqual(
      clubGaps(data, 'premium-flat', query()).find((r) => r.club === '7i'),
    );
    expect(seven.gap).toMatchObject({ gap: 18, flag: null });
    const eight = profile(sessions, shots, '8i');
    expect(eight.gap).toMatchObject({ gap: 2, flag: 'small' });
    const five = profile(sessions, shots, '5i');
    expect(five.gap).toMatchObject({ gap: null, flag: null });
  });

  it('returns no profiles for empty or archived-only data', () => {
    expect(clubProfiles(emptyDataset, 'premium-flat', query())).toEqual([]);
    const archived = before(1, { archived: true });
    expect(
      profiles([archived], series(archived, repeat(5, 100)), 'premium-flat'),
    ).toEqual([]);
    expect(profiles([current], [], 'premium-flat')).toEqual([]);
  });

  it('is invariant to input order', () => {
    const sessions = [current, before(1), before(3)];
    const shots = sessions.flatMap((s, i) =>
      series(s, band(12, 4 + i), { review: { ...fullTypical } }),
    );
    expect(profiles([...sessions].reverse(), [...shots].reverse())).toEqual(
      profiles(sessions, shots),
    );
  });
});
