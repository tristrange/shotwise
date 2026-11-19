import { expect, it } from 'vitest';
import { practiceInsights, type AnalysisQuery } from './analytics';
import { makeSession, makeShot } from './fixtures';
import { emptyDataset, type Session } from './model';

const today = '2026-11-16';
const query = {
  mode: 'recent',
  today,
  intent: 'all',
  contact: 'all',
} satisfies AnalysisQuery;
const repeated = (value: number | null) =>
  Array.from({ length: 10 }, () => value);
const alternating = (low: number, high: number) =>
  Array.from({ length: 10 }, (_, i) => (i % 2 ? high : low));
const visit = (date: string, venue = 'Range') => makeSession({ date, venue });
const first = visit('2026-11-12');
const second = visit('2026-11-13', ' range ');

function group(
  session: Session,
  club: string,
  carries: (number | null)[],
  curves: (number | null)[] = [],
) {
  return carries.map((carry, i) =>
    makeShot({
      sessionId: session.id,
      recordedClub: club,
      rowIndex: i + 1,
      measurements: { flatCarryPremium: carry, curve: curves[i] ?? null },
    }),
  );
}

function insights(
  sessions: Session[],
  shots: ReturnType<typeof group>,
  overrides: Partial<AnalysisQuery> = {},
) {
  return practiceInsights(
    { ...emptyDataset, sessions, shots },
    'premium-flat',
    { ...query, ...overrides },
  );
}

it('uses complete visits, counts measured curves independently of carry, and links their exact rows', () => {
  const sessions = [first, second];
  const shots = sessions.flatMap((session) =>
    group(
      session,
      '3w',
      [...Array.from({ length: 60 }, () => null), null],
      [
        ...Array.from({ length: 48 }, () => 2),
        ...Array.from({ length: 12 }, () => 0),
      ],
    ),
  );
  const result = insights(sessions, shots);
  expect(result).toHaveLength(1);
  const [insight] = result;
  expect(insight).toMatchObject({
    dates: 2,
    shots: 120,
    improving: false,
    evidence: [
      { kind: 'direction', side: 'right', count: 48, missing: 1 },
      { kind: 'direction', side: 'right', count: 48, missing: 1 },
    ],
  });
  expect(insight?.evidence[0].shotIds).toEqual(
    shots
      .filter(
        (shot) =>
          shot.sessionId === second.id && shot.measurements.curve !== null,
      )
      .map(({ id }) => id),
  );
});

it('suppresses one-offs, same-day repetitions, opposing directions, and sparse measured curves', () => {
  const sameDay = visit(first.date);
  const sessions = [first, sameDay, second];
  const shots = [
    ...group(first, '3w', repeated(200), repeated(-3)),
    ...group(sameDay, '3w', repeated(200), repeated(-3)),
    ...group(second, '3w', repeated(200), repeated(3)),
    ...group(first, '7i', alternating(70, 130)),
    ...group(second, '7i', repeated(100)),
    ...sessions.flatMap((session) =>
      group(session, '5i', repeated(150), repeated(3).slice(0, 9)),
    ),
  ];
  expect(insights(sessions, shots)).toEqual([]);
});

it('requires both neighbouring clubs to have measured carries at comparable visits on two dates', () => {
  const otherVenue = visit('2026-11-14', 'Different range');
  const sameDayDifferentVisit = visit(second.date);
  const gap = (session: Session) => [
    ...group(session, '5i', repeated(90)),
    ...group(session, '6i', repeated(150)),
  ];
  expect(
    insights(
      [first, second, otherVenue, sameDayDifferentVisit],
      [
        ...gap(first),
        ...group(second, '5i', repeated(90)),
        ...group(sameDayDifferentVisit, '6i', repeated(150)),
        ...gap(otherVenue),
      ],
    ),
  ).toEqual([]);

  const shots = [...gap(first), ...gap(second)];
  const [insight] = insights([first, second], shots);
  expect(insight).toMatchObject({ dates: 2, shots: 40 });
  expect(insight?.evidence[0]).toMatchObject({
    kind: 'gapping',
    gap: -60,
    longer: { club: '5i', median: 90 },
    shorter: { club: '6i', median: 150 },
  });
  expect(insight?.evidence[0].shotIds).toEqual(
    shots.slice(20).map(({ id }) => id),
  );
});

it('keeps carry band overlap descriptive even when it recurs', () => {
  const shots = [first, second].flatMap((session) => [
    ...group(session, '5i', alternating(130, 180)),
    ...group(session, '6i', alternating(105, 155)),
  ]);
  const result = insights([first, second], shots);
  expect(result).toHaveLength(2);
  expect(
    result.every(({ evidence }) => evidence[0].kind === 'inconsistency'),
  ).toBe(true);
});

it('ranks by recurrence and downranks a pattern after two newer well-sampled dates clear it', () => {
  const third = visit('2026-11-14');
  const fourth = visit('2026-11-15');
  const fifth = visit(today);
  const sessions = [first, second, third, fourth, fifth];
  const persistent = [first, second].flatMap((session) =>
    group(session, '6i', alternating(110, 170)),
  );
  const laterImproving = [first, second, third].flatMap((session) =>
    group(session, '7i', alternating(70, 130)),
  );
  const shots = [
    ...persistent,
    ...laterImproving,
    ...group(fourth, '7i', repeated(100)),
  ];
  expect(
    insights(sessions, shots).map(({ id, improving }) => [id, improving]),
  ).toEqual([
    ['["inconsistency","7i"]', false],
    ['["inconsistency","6i"]', false],
  ]);

  shots.push(...group(fifth, '7i', repeated(100)));
  const ranked = insights(sessions, shots);
  expect(ranked.map(({ id, improving }) => [id, improving])).toEqual([
    ['["inconsistency","6i"]', false],
    ['["inconsistency","7i"]', true],
  ]);
  expect(insights([...sessions].reverse(), [...shots].reverse())).toEqual(
    ranked,
  );
});

it('keeps recent recommendations in the 60-day window and omits future or archived visits', () => {
  const old = visit('2026-08-01');
  const future = visit('2026-11-17');
  const archived = makeSession({
    date: '2026-11-15',
    venue: 'Range',
    archived: true,
  });
  const sessions = [first, old, future, archived];
  const shots = sessions.flatMap((session) =>
    group(session, '7i', alternating(70, 130)),
  );
  expect(insights(sessions, shots)).toEqual([]);
  expect(
    insights(sessions, shots, { mode: 'all' })[0]?.evidence.map(
      ({ session }) => session.id,
    ),
  ).toEqual([first.id, old.id]);
});

it('uses stable ordering for equally supported patterns and keeps one action per club and type', () => {
  const otherFirst = visit(first.date, 'Other Range');
  const otherSecond = visit(second.date, 'Other Range');
  const sessions = [first, second, otherFirst, otherSecond];
  const shots = sessions.flatMap((session) => [
    ...group(session, '3w', repeated(180), repeated(2)),
    ...group(session, 'D', repeated(215), repeated(-2)),
  ]);
  const ranked = insights(sessions, shots);
  expect(ranked.map(({ id, dates, shots }) => [id, dates, shots])).toEqual([
    ['["direction","3w"]', 2, 20],
    ['["direction","D"]', 2, 20],
  ]);
  expect(insights([...sessions].reverse(), [...shots].reverse())).toEqual(
    ranked,
  );
});

it('uses effective labels, honours review filters, and requires explicit full intent for wedges', () => {
  const sessions = [first, second];
  const shots = sessions.flatMap((session) =>
    group(session, 'PW', alternating(70, 130)),
  );
  expect(insights(sessions, shots)).toEqual([]);
  const reviewed: ReturnType<typeof group> = shots.map((shot) => ({
    ...shot,
    review: { ...shot.review, club: { kind: 'corrected', club: '9i' } },
  }));
  expect(insights(sessions, reviewed)[0]?.evidence[0]).toMatchObject({
    kind: 'inconsistency',
    carry: { club: '9i' },
  });
  expect(insights(sessions, reviewed, { contact: 'typical' })).toEqual([]);
  reviewed[0] = makeShot({
    sessionId: first.id,
    recordedClub: '9i',
    review: { contact: 'mishit' },
  });
  expect(insights(sessions, reviewed)).toEqual([]);
});
