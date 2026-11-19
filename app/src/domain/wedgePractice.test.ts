import { expect, it } from 'vitest';
import { clubGaps, type AnalysisQuery } from './analytics';
import { makeSession, makeShot } from './fixtures';
import { emptyDataset } from './model';
import { sessionRecap } from './recap';
import { wedgePractice } from './wedgePractice';

const today = '2026-11-16';
const session = makeSession({ date: today });
const query = {
  mode: 'all',
  today,
  intent: 'all',
  contact: 'all',
} satisfies AnalysisQuery;
function shot(overrides: Parameters<typeof makeShot>[0] = {}) {
  return makeShot({ sessionId: session.id, recordedClub: 'SW', ...overrides });
}

it('keeps exact targets and mixed intent together, with per-basis carry and aim-line coverage', () => {
  const target = 30;
  const shots = [
    shot({
      rowIndex: 1,
      measurements: {
        target,
        flatCarryPremium: 26,
        flatCarryRange: 20,
        launchDirection: -2,
        proximity: 4,
      },
    }),
    shot({
      rowIndex: 2,
      measurements: {
        target,
        flatCarryPremium: 30,
        flatCarryRange: 22,
        launchDirection: 0,
        proximity: 2,
      },
      review: { intent: 'partial', contact: 'mishit' },
    }),
    shot({
      rowIndex: 3,
      measurements: {
        target,
        flatCarryPremium: 32,
        flatCarryRange: 26,
        launchDirection: 3,
        proximity: 0,
      },
      review: { intent: 'full' },
    }),
    shot({
      rowIndex: 4,
      measurements: {
        target,
        flatCarryPremium: 34,
        flatCarryRange: 28,
        launchDirection: 5,
      },
      recordedClub: '7i',
      review: { club: { kind: 'corrected', club: 'SW' } },
    }),
    shot({
      rowIndex: 5,
      measurements: { target, flatCarryPremium: null, proximity: 6 },
    }),
    shot({
      rowIndex: 6,
      measurements: { target: 30.04, flatCarryPremium: 31 },
    }),
  ];
  const data = {
    ...emptyDataset,
    sessions: [session],
    shots: [...shots].reverse(),
  };
  const premium = wedgePractice(data, 'premium-flat', query);
  expect(premium).toMatchObject({
    total: 6,
    targeted: 6,
    missingTarget: 0,
    zeroTarget: 0,
  });
  expect(
    premium.groups.map((group) => group.kind === 'target' && group.target),
  ).toEqual([30, 30.04]);
  expect(premium.groups[0]).toMatchObject({
    carry: { median: 31, iqr: 3.5, n: 4, missing: 1 },
    intentCounts: { full: 1, partial: 1, unknown: 3 },
    aimed: 4,
    direction: { launch: { n: 3, left: 1, straight: 1, right: 1, missing: 1 } },
  });
  expect(premium.groups[0]?.shots.map(({ id }) => id)).toEqual(
    shots.slice(0, 5).map(({ id }) => id),
  );
  expect(premium.groups[1]?.carry).toMatchObject({
    n: 1,
    median: 31,
    iqr: null,
  });
  expect(
    wedgePractice(data, 'range-flat', query).groups[0]?.carry,
  ).toMatchObject({ median: 24, n: 4, missing: 1 });
  expect(
    wedgePractice(data, 'range-flat', query).groups[1]?.carry,
  ).toMatchObject({ median: null, n: 0, missing: 1 });
});

it('groups missing and zero targets by saved intent and respects archive, review and club corrections', () => {
  const archived = makeSession({ archived: true });
  const data = {
    ...emptyDataset,
    sessions: [session, archived],
    shots: [
      shot({ review: { intent: 'full' } }),
      shot({ measurements: { target: 0 }, review: { intent: 'partial' } }),
      shot({ review: { intent: 'partial' } }),
      shot({
        measurements: { target: 0, launchDirection: 8, proximity: 3 },
        review: { contact: 'mishit' },
      }),
      shot({ sessionId: archived.id, measurements: { target: 45 } }),
      shot({
        review: { exclusion: { kind: 'excluded', reason: 'Off camera' } },
      }),
      shot({ review: { club: { kind: 'corrected', club: '7i' } } }),
    ],
  };
  const result = wedgePractice(data, 'premium-flat', query);
  expect(result).toMatchObject({
    total: 4,
    targeted: 0,
    missingTarget: 2,
    zeroTarget: 2,
  });
  expect(
    result.groups.map(
      (group) =>
        group.kind === 'intent' && [
          group.intent,
          group.shots.length,
          group.aimed,
        ],
    ),
  ).toEqual([
    ['full', 1, 0],
    ['partial', 2, 0],
    ['unknown', 1, 0],
  ]);
  expect(
    wedgePractice(data, 'premium-flat', { ...query, hideLikelyMishits: true })
      .total,
  ).toBe(3);
  expect(
    wedgePractice(data, 'premium-flat', { ...query, intent: 'partial' }).total,
  ).toBe(2);
});

it('keeps a 30 m sand wedge in practice and out of full-swing benchmarks until marked full', () => {
  const targeted = shot({ measurements: { target: 30, flatCarryPremium: 29 } });
  const data = { ...emptyDataset, sessions: [session], shots: [targeted] };
  expect(wedgePractice(data, 'premium-flat', query).groups[0]).toMatchObject({
    club: 'SW',
    target: 30,
  });
  expect(clubGaps(data, 'premium-flat', query)).toEqual([]);
  expect(
    sessionRecap(data, session.id, 'premium-flat')?.clubs[0]?.reliability.spread
      .current.measured,
  ).toBe(0);

  const full = {
    ...data,
    shots: [
      { ...targeted, review: { ...targeted.review, intent: 'full' as const } },
    ],
  };
  expect(clubGaps(full, 'premium-flat', query)[0]).toMatchObject({
    club: 'SW',
    n: 1,
    median: 29,
  });
  expect(
    sessionRecap(full, session.id, 'premium-flat')?.clubs[0]?.reliability.spread
      .current.measured,
  ).toBe(1);
  expect(
    wedgePractice(full, 'premium-flat', query).groups[0]?.shots[0]?.id,
  ).toBe(targeted.id);
});
