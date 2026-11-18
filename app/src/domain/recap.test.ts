import { describe, expect, it } from 'vitest';
import { makeSession, makeShot } from './fixtures';
import {
  BASES,
  basisSchema,
  emptyDataset,
  shiftDate,
  type Basis,
  type Session,
  type Shot,
} from './model';
import { sessionRecap } from './recap';
import { assessUnusualShots } from './unusualShots';

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
      id: options.id ? options.id + '-' + i : session.id + '-' + i,
      rowIndex: (options.rowIndex ?? 1) + i,
      sessionId: session.id,
      measurements: { flatCarryPremium: carry, ...options.measurements },
    }),
  );
}

function recap(
  sessions: Session[],
  shots: Shot[],
  basis: Basis = 'premium-flat',
) {
  return sessionRecap({ ...emptyDataset, sessions, shots }, current.id, basis);
}

function club(sessions: Session[], shots: Shot[], basis?: Basis) {
  const row = recap(sessions, shots, basis)?.clubs[0];
  if (!row) throw new Error('Expected a club in the recap');
  return row;
}

describe('session recap', () => {
  it('returns sparse observations and missing counts with no matching history', () => {
    const prior = before(1);
    const result = recap(
      [prior, current],
      [
        ...series(prior, repeat(30, 80), { recordedClub: '5i' }),
        ...series(current, [90, null, 110, 100]),
      ],
    );
    expect(result).toMatchObject({
      recorded: 4,
      included: 4,
      clubs: [
        {
          club: '7i',
          potential: {
            preferred: 'broader',
            broader: {
              current: { value: 100, measured: 3, missing: 1 },
              baseline: { value: null, measured: 0, sessions: [] },
              finding: {
                kind: 'withheld',
                reasons: expect.arrayContaining([
                  'small-current-sample',
                  'no-matching-history',
                ]),
              },
            },
          },
          reliability: {
            p10: { current: { value: null } },
            contact: {
              full: 0,
              reviewed: 0,
              mishits: 0,
              rate: null,
              reviewedShare: null,
            },
          },
        },
      ],
      highlights: [],
    });
    expect(recap([], [])).toBeNull();
    expect(recap([current], [])).toMatchObject({
      recorded: 0,
      included: 0,
      clubs: [],
    });
    expect(
      recap([{ ...current, archived: true }], series(current, [100])),
    ).toBeNull();
  });

  it('requires five prior measurements per session and returns the latest thin comparison as context', () => {
    const thin = before(1);
    const older = before(2);
    const earlier = before(3);
    const result = club(
      [thin, older, earlier, current],
      [
        ...series(thin, [...repeat(4, 90), ...repeat(30, null)]),
        ...series(older, repeat(9, 100)),
        ...series(earlier, repeat(10, 102)),
        ...series(current, repeat(10, 120)),
      ],
    ).potential.broader;
    expect(result.baseline).toMatchObject({ value: 101, measured: 19 });
    expect(result.baseline.sessions.map(({ session }) => session.id)).toEqual([
      older.id,
      earlier.id,
    ]);
    expect(result.previous).toMatchObject([
      { session: thin, value: 90, measured: 4, missing: 30 },
    ]);
    expect(result.finding).toEqual({
      kind: 'withheld',
      reasons: ['small-prior-sample'],
    });
  });

  it('requires two separate dates and ignores archived or out-of-window sessions', () => {
    const yesterday = before(1, { time: '12:00' });
    const sameDay = { ...yesterday, id: 'second-prior', time: '13:00' };
    const archived = before(2, { archived: true });
    const stale = before(60);
    const boundary = before(59);
    const shots = [
      ...series(current, repeat(12, 120)),
      ...[yesterday, sameDay, archived, stale].flatMap((session) =>
        series(session, repeat(12, 100)),
      ),
    ];
    const result = club([current, yesterday, sameDay, archived, stale], shots);
    expect(result.potential.broader.finding).toEqual({
      kind: 'withheld',
      reasons: ['too-few-prior-dates'],
    });
    expect(result.reliability.spread.finding).toEqual({
      kind: 'withheld',
      reasons: ['too-few-prior-dates'],
    });
    const withBoundary = club(
      [current, boundary, yesterday, sameDay, archived, stale],
      [...shots, ...series(boundary, repeat(12, 100))],
    ).potential.broader;
    expect(withBoundary.baseline.dates).toEqual([
      yesterday.date,
      boundary.date,
    ]);
    expect(withBoundary.finding).toEqual({ kind: 'higher' });
  });

  it('admits strictly earlier same-day times and withholds when matching same-day evidence is unresolved', () => {
    const morning = before(0, { id: 'morning', time: '09:00' });
    const equal = before(0, { id: 'equal', time: current.time });
    const untimed = before(0, { id: 'untimed' });
    const yesterday = before(1);
    const shots = [
      ...series(current, repeat(10, 120)),
      ...[morning, equal, untimed, yesterday].flatMap((session) =>
        series(session, repeat(10, 100)),
      ),
    ];
    const timedSessions = [current, morning, equal, untimed, yesterday];
    const result = club(timedSessions, shots).potential.broader;
    expect(result.baseline.sessions.map(({ session }) => session.id)).toEqual([
      morning.id,
      yesterday.id,
    ]);
    expect(result.unresolved.map(({ session }) => session.id)).toEqual([
      equal.id,
      untimed.id,
    ]);
    expect(result.finding).toEqual({
      kind: 'withheld',
      reasons: ['unresolved-chronology'],
    });

    const withoutTime = club(
      [{ ...current, time: null }, ...timedSessions.slice(1)],
      shots,
    ).potential.broader;
    expect(
      withoutTime.baseline.sessions.map(({ session }) => session.id),
    ).toEqual([yesterday.id]);
    expect(withoutTime.unresolved.map(({ session }) => session.id)).toContain(
      morning.id,
    );
  });

  it.each([
    { times: ['10:00', '10:00', '09:00'], retained: 4 },
    { times: ['10:00', '09:00', null], retained: 5 },
    { times: ['10:00', '09:00', '08:00'], retained: 3 },
  ])(
    'handles a three-session cutoff with prior-day times $times',
    ({ times, retained }) => {
      const priors = [
        before(1),
        before(2),
        ...times.map((time, i) => before(3, { id: 'on-cutoff-' + i, time })),
      ];
      const result = club(
        [...priors, current],
        [
          ...series(current, repeat(10, 120)),
          ...priors.flatMap((s) => series(s, repeat(10, 100))),
        ],
      ).potential.broader;
      expect(result.baseline.sessions).toHaveLength(retained);
      expect(result.baseline.measured).toBe(retained * 10);
      expect(result.finding).toEqual({ kind: 'higher' });
    },
  );

  it('keeps the full recap invariant to input order and later sessions', () => {
    const sessions = [current, before(1), before(3)];
    const shots = sessions.flatMap((s) =>
      series(s, repeat(12, s === current ? 120 : 100)),
    );
    const later = [before(-1), before(0, { id: 'afternoon', time: '15:00' })];
    expect(
      recap(
        [...sessions, ...later].reverse(),
        [
          ...shots,
          ...later.flatMap((s) => series(s, repeat(25, 300))),
        ].reverse(),
      ),
    ).toEqual(recap(sessions, shots));
  });

  it('gives recent sessions equal weight during rapid improvement', () => {
    const sessions = [before(4), before(3), before(2), before(1)];
    const shots = [
      ...series(before(4), repeat(40, 70)),
      ...series(before(3), repeat(10, 128)),
      ...series(before(2), repeat(10, 140)),
      ...series(before(1), repeat(100, 144)),
    ];
    expect(
      club(
        [current, ...sessions],
        [...shots, ...series(current, repeat(10, 145))],
      ).potential.broader,
    ).toMatchObject({
      baseline: {
        value: 140,
        measured: 120,
        dates: sessions
          .slice(1)
          .reverse()
          .map((s) => s.date),
      },
      delta: 5,
      finding: { kind: 'not-noteworthy', reason: 'below-threshold' },
    });
  });

  it.each([
    { prior: [100, 100, 100], now: 105, finding: { kind: 'higher' } },
    { prior: [100, 100, 100], now: 95, finding: { kind: 'lower' } },
    {
      prior: [200, 200, 200],
      now: 206,
      finding: { kind: 'not-noteworthy', reason: 'below-threshold' },
    },
    {
      prior: [50, 50, 50],
      now: 54,
      finding: { kind: 'not-noteworthy', reason: 'below-threshold' },
    },
    {
      prior: [80, 100, 110],
      now: 110,
      finding: { kind: 'not-noteworthy', reason: 'within-prior-range' },
    },
  ])(
    'applies both carry thresholds and the prior range for $prior → $now',
    ({ prior, now, finding }) => {
      const sessions = prior.map((_, i) => before(i + 1));
      expect(
        club(
          [current, ...sessions],
          [
            ...series(current, repeat(10, now)),
            ...prior.flatMap((value, i) =>
              series(before(i + 1), repeat(10, value)),
            ),
          ],
        ).potential.broader.finding,
      ).toEqual(finding);
    },
  );

  it.each([
    { prior: [10, 10], now: 7, finding: { kind: 'lower' } },
    {
      prior: [20, 20],
      now: 17,
      finding: { kind: 'not-noteworthy', reason: 'below-threshold' },
    },
    {
      prior: [10, 10],
      now: 7.5,
      finding: { kind: 'not-noteworthy', reason: 'below-threshold' },
    },
    {
      prior: [4, 14, 16],
      now: 6,
      finding: { kind: 'not-noteworthy', reason: 'within-prior-range' },
    },
  ])(
    'applies both spread thresholds and the prior range for $prior → $now',
    ({ prior, now, finding }) => {
      const sessions = prior.map((_, i) => before(i + 1));
      expect(
        club(
          [current, ...sessions],
          [
            ...series(current, band(12, now)),
            ...prior.flatMap((value, i) =>
              series(before(i + 1), band(12, value)),
            ),
          ],
        ).reliability.spread.finding,
      ).toEqual(finding);
    },
  );

  it('requires 12 current and 24 prior carries for a spread finding', () => {
    const prior = [before(1), before(2)];
    const result = club(
      [current, ...prior],
      [
        ...series(current, band(11, 5)),
        ...series(before(1), band(11, 20)),
        ...series(before(2), band(12, 20)),
      ],
    ).reliability.spread;
    expect(result.current.value).toBe(5);
    expect(result.baseline.measured).toBe(23);
    expect(result.finding).toEqual({
      kind: 'withheld',
      reasons: ['small-current-sample', 'small-prior-sample'],
    });
  });

  it('uses effective labels and keeps corrections, exclusions, partials and contact decisions independent', () => {
    const full = { intent: 'full', contact: 'typical' } satisfies Partial<
      Shot['review']
    >;
    const recent = series(current, repeat(10, 115), {
      recordedClub: '8i',
      review: { ...full, club: { kind: 'corrected', club: '7i' } },
    });
    const extras = [
      makeShot({
        id: 'partial',
        sessionId: current.id,
        review: { intent: 'partial', contact: 'mishit' },
      }),
      makeShot({
        id: 'excluded',
        sessionId: current.id,
        review: { ...full, exclusion: { kind: 'excluded', reason: 'Warm-up' } },
      }),
      makeShot({ id: 'unreviewed', sessionId: current.id }),
      makeShot({
        id: 'unknown-club',
        sessionId: current.id,
        recordedClub: '?',
      }),
    ];
    const priors = [before(1), before(2)];
    const shots = [
      ...recent,
      ...extras,
      ...priors.flatMap((s) => [
        ...series(s, repeat(10, 100), {
          recordedClub: '?',
          review: { ...full, club: { kind: 'corrected', club: '7i' } },
        }),
        makeShot({
          id: s.id + '-excluded',
          sessionId: s.id,
          review: { exclusion: { kind: 'excluded', reason: 'Warm-up' } },
        }),
      ]),
    ];
    const original = structuredClone(shots);
    expect(recap([current, ...priors], shots)).toMatchObject({
      recorded: 14,
      included: 13,
      clubs: [
        {
          club: '7i',
          included: 12,
          potential: {
            preferred: 'reviewed',
            reviewed: {
              current: { measured: 10, shotIds: recent.map((shot) => shot.id) },
              baseline: { measured: 20, value: 100 },
              finding: { kind: 'higher' },
            },
            broader: { current: { measured: 11, unknownIntentShare: 1 / 11 } },
          },
          reliability: {
            spread: { current: { measured: 11 } },
            contact: {
              full: 10,
              reviewed: 10,
              reviewedShare: 1,
              mishits: 0,
              rate: 0,
            },
          },
        },
      ],
    });
    expect(shots).toEqual(original);
  });

  it('retains severe mishits and advisory flags in reliability and reports a tighter spread with a worse lower tail', () => {
    const prior = [before(1), before(2)];
    const low = series(current, [3, 3, 3], {
      review: { intent: 'full', contact: 'mishit' },
      measurements: { flatCarryRange: 3, speedRange: 20 },
    });
    const flagged = makeShot({
      id: 'advisory-flag',
      sessionId: current.id,
      rowIndex: 4,
      review: { intent: 'full' },
      measurements: { flatCarryPremium: 4, flatCarryRange: 4, speedRange: 20 },
    });
    const shots = [
      ...low,
      flagged,
      ...series(current, [...repeat(17, 110), ...repeat(3, 112)], {
        id: 'normal',
        rowIndex: 5,
        review: { intent: 'full', contact: 'typical' },
      }),
      ...prior.flatMap((s) =>
        series(s, band(24, 20), {
          review: { intent: 'full' },
          measurements: { flatCarryRange: 110, speedRange: 150 },
        }),
      ),
    ];
    expect(
      assessUnusualShots(shots, [current, ...prior]).get(flagged.id),
    ).toMatchObject({
      kind: 'assessed',
      unusual: true,
    });
    const result = club([current, ...prior], shots);
    expect(result.potential.broader.current).toMatchObject({
      measured: 21,
      value: 110,
    });
    expect(result.potential.broader.current.shotIds).toContain(flagged.id);
    expect(result.reliability).toMatchObject({
      spread: {
        current: { measured: 24, value: 0 },
        baseline: { value: 20 },
        finding: { kind: 'mixed' },
      },
      p10: {
        current: { value: expect.closeTo(3.3) },
        baseline: { value: 100 },
      },
      contact: {
        full: 24,
        reviewed: 23,
        reviewedShare: 23 / 24,
        mishits: 3,
        rate: 3 / 23,
      },
    });
    expect(recap([current, ...prior], shots)?.highlights).toContainEqual({
      club: '7i',
      metric: 'spread',
      kind: 'mixed',
      delta: -20,
    });
  });

  it('requires 20 carries for a lower-tail observation and explicit full intent for wedges', () => {
    const fullWedges = series(current, repeat(19, 85), {
      recordedClub: 'SW',
      review: { intent: 'full' },
    });
    const practice = makeShot({
      id: 'targeted-30m-wedge',
      sessionId: current.id,
      recordedClub: '7i',
      review: { club: { kind: 'corrected', club: 'SW' } },
      measurements: { target: 30, flatCarryPremium: 30 },
    });
    expect(club([current], [...fullWedges, practice])).toMatchObject({
      club: 'SW',
      included: 20,
      potential: {
        broader: {
          current: { measured: 19, unknownIntentShare: 0, value: 85 },
        },
      },
      reliability: {
        p10: { current: { measured: 19, value: null } },
        contact: { full: 19, reviewed: 0, reviewedShare: 0, rate: null },
      },
    });
    const explicitlyFull = {
      ...practice,
      review: { ...practice.review, intent: 'full' },
    } satisfies Shot;
    expect(
      club([current], [...fullWedges, explicitlyFull]).reliability.p10.current,
    ).toMatchObject({
      measured: 20,
      value: 85,
    });
  });

  it('withholds findings for substantial changes in venue, mix or measurement coverage', () => {
    const priors = [
      before(1, { venue: 'North' }),
      before(2, { venue: ' north ' }),
    ];
    const selected = { ...current, venue: 'North' };
    const history = priors.flatMap((s) =>
      series(s, repeat(12, 100), { review: { intent: 'full' } }),
    );
    const shots = series(current, [...repeat(12, 125), ...repeat(12, null)], {
      measurements: { target: 130 },
    });
    const result = club([selected, ...priors], [...shots, ...history]).potential
      .broader;
    expect(result.current).toMatchObject({
      measured: 12,
      missing: 12,
      value: 125,
    });
    expect(result.baseline).toMatchObject({ measured: 24, value: 100 });
    expect(result.finding).toEqual({
      kind: 'withheld',
      reasons: ['different-shot-mix', 'different-measurement-coverage'],
    });
    expect(
      club([{ ...selected, venue: 'South' }, ...priors], [...shots, ...history])
        .potential.broader,
    ).toMatchObject({
      baseline: { sessions: [] },
      differentVenue: [{ session: priors[0] }, { session: priors[1] }],
      finding: {
        kind: 'withheld',
        reasons: expect.arrayContaining(['different-venue']),
      },
    });
  });

  it('withholds when prior sessions used different known venues and the current venue is unknown', () => {
    const priors = [
      before(1, { venue: 'North' }),
      before(2, { venue: 'South' }),
    ];
    const shots = [
      ...series(current, repeat(12, 120)),
      ...priors.flatMap((s) => series(s, repeat(12, 100))),
    ];
    expect(club([current, ...priors], shots).potential.broader.finding).toEqual(
      {
        kind: 'withheld',
        reasons: ['different-venue'],
      },
    );
  });

  it.each(basisSchema.options)(
    'uses only the %s basis and keeps direction as recorded',
    (basis) => {
      const fields = BASES[basis];
      const priors = [before(1), before(2)];
      const measured = {
        carryRange: 100,
        flatCarryRange: 120,
        carryPremium: 140,
        flatCarryPremium: 160,
        speedRange: 150,
        speedPremium: 155,
        launchRange: 15,
        launchPremium: 16,
        apexRange: 20,
        apexPremium: 21,
      };
      const base = {
        range: 100,
        'range-flat': 120,
        premium: 140,
        'premium-flat': 160,
      }[basis];
      const shots = [
        ...priors.flatMap((s) =>
          series(s, repeat(12, 0), { measurements: measured }),
        ),
        ...series(current, repeat(12, 0), {
          measurements: { ...measured, [fields.carry]: base + 10 },
        }),
        makeShot({
          id: 'missing',
          sessionId: current.id,
          measurements: {
            ...measured,
            [fields.carry]: null,
            [fields.speed]: null,
            [fields.apex]: null,
          },
        }),
        makeShot({
          id: 'direction-left',
          sessionId: current.id,
          review: { intent: 'full' },
          measurements: {
            flatCarryPremium: null,
            launchDirection: -1,
            curve: 0,
            fromCentre: 4,
          },
        }),
        makeShot({
          id: 'direction-right',
          sessionId: current.id,
          measurements: {
            flatCarryPremium: null,
            launchDirection: 2,
            curve: -5,
          },
        }),
      ];
      expect(club([current, ...priors], shots, basis)).toMatchObject({
        potential: {
          broader: {
            key: fields.carry,
            current: { measured: 12, missing: 3, value: base + 10 },
            baseline: { measured: 24, value: base },
            finding: { kind: 'higher' },
          },
        },
        flight: {
          speed: { key: fields.speed, current: { measured: 12, missing: 3 } },
          launch: { key: fields.launch, current: { measured: 13, missing: 2 } },
          apex: { key: fields.apex, current: { measured: 12, missing: 3 } },
          launchDirection: {
            current: {
              measured: 2,
              missing: 13,
              value: { left: 0.5, straight: 0, right: 0.5 },
            },
          },
          curve: {
            current: {
              measured: 2,
              value: { left: 0.5, straight: 0.5, right: 0 },
            },
          },
          lateral: {
            current: { measured: 1, value: { left: 0, straight: 0, right: 1 } },
          },
        },
      });
      expect(recap([current, ...priors], shots, basis)).toMatchObject({
        basis,
        basisLabel: fields.label,
      });
    },
  );

  it('selects different baselines per metric and gives each session equal weight in direction shares', () => {
    const carried = before(1);
    const flights = [before(2), before(3), before(4)];
    const shots = [
      ...series(current, repeat(12, 115), { measurements: { curve: 0 } }),
      ...series(carried, repeat(12, 100)),
      ...series(before(2), repeat(10, null), {
        measurements: { speedPremium: 130, curve: 4 },
      }),
      ...series(before(3), repeat(5, null), {
        measurements: { speedPremium: 150, curve: -4 },
      }),
      ...series(before(4), repeat(2, null), {
        measurements: { speedPremium: 170, curve: 0 },
      }),
    ];
    const result = club([current, carried, ...flights], shots);
    expect(result.potential.broader.baseline.dates).toEqual([carried.date]);
    expect(result.flight.speed.baseline).toMatchObject({
      value: 150,
      measured: 17,
      dates: flights.map((s) => s.date),
    });
    expect(result.flight.curve.baseline.value).toEqual({
      left: 1 / 3,
      straight: 1 / 3,
      right: 1 / 3,
    });
  });

  it('returns up to three findings with room for gains and areas to investigate', () => {
    const priors = [before(1), before(2)];
    const shots = Object.entries({
      '5i': 140,
      '6i': 130,
      '7i': 120,
      '8i': 90,
    }).flatMap(([recordedClub, carry]) => {
      const options = { id: recordedClub, recordedClub };
      return [
        ...series(current, repeat(12, carry), options),
        ...priors.flatMap((s) =>
          series(s, repeat(12, 100), { ...options, id: s.id + recordedClub }),
        ),
      ];
    });
    expect(recap([current, ...priors], shots)?.highlights).toEqual([
      { club: '5i', metric: 'carry', kind: 'higher', delta: 40 },
      { club: '6i', metric: 'carry', kind: 'higher', delta: 30 },
      { club: '8i', metric: 'carry', kind: 'lower', delta: -10 },
    ]);
  });
});
