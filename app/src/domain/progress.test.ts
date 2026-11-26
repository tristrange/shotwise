import { describe, expect, it } from 'vitest';
import {
  chronologyKnown,
  clubProgress,
  firstLatestDelta,
  summarizeClubMetric,
  pointReading,
} from './progress';
import { csvFixture, makeSession, makeShot } from './fixtures';
import { emptyDataset } from './model';
import type { AnalysisQuery } from './analytics';
import { parseCsv } from './csv';

const query = {
  mode: 'all',
  today: '2026-11-17',
  intent: 'all',
  contact: 'all',
} satisfies AnalysisQuery;

it('keeps club and session progress separate, with measured counts and middle-half carry spread', () => {
  const sessions = [
    makeSession({ date: '2026-11-01' }),
    makeSession({ date: '2026-11-17' }),
  ];
  const shots = sessions.flatMap((session, i) => [
    ...[90, 100, 110, 120].map((carry) =>
      makeShot({
        sessionId: session.id,
        measurements: { flatCarryPremium: carry + i * 10 },
      }),
    ),
    makeShot({
      sessionId: session.id,
      measurements: { flatCarryPremium: null },
    }),
    makeShot({
      sessionId: session.id,
      recordedClub: '9i',
      measurements: { flatCarryPremium: 60 },
    }),
  ]);
  const rows = clubProgress(
    { ...emptyDataset, shots, sessions },
    'premium-flat',
    query,
  );
  expect(rows.map((r) => r.club)).toEqual(['7i', '9i']);
  expect(
    rows[0]?.sessions.map((s) => ({
      n: s.n,
      missing: s.missing,
      median: s.median,
      iqr: s.iqr,
    })),
  ).toEqual([
    { n: 4, missing: 1, median: 105, iqr: 15 },
    { n: 4, missing: 1, median: 115, iqr: 15 },
  ]);
  expect(rows[1]?.sessions[0]).toMatchObject({ n: 1, median: 60, iqr: null });
});

it('preserves sparse and missing sessions without falling back to range measurements', async () => {
  const session = makeSession();
  const parsed = await parseCsv(
    new TextEncoder().encode(
      csvFixture([
        {
          'Flat Carry Dist. Premium (m)': '0',
          'Flat Carry Dist. Range (m)': '90',
        },
        {
          'Flat Carry Dist. Premium (m)': 'bad',
          'Flat Carry Dist. Range (m)': '110',
        },
      ]),
    ),
  );
  const data = {
    ...emptyDataset,
    sessions: [session],
    shots: parsed.shots.map((s) => makeShot({ ...s, sessionId: session.id })),
  };
  expect(
    clubProgress(data, 'premium-flat', query)[0]?.sessions[0],
  ).toMatchObject({ n: 1, missing: 1, median: 0, iqr: null });
  expect(clubProgress(data, 'range-flat', query)[0]?.sessions[0]).toMatchObject(
    { n: 2, missing: 0, median: 100, iqr: null },
  );
  const missing = { ...data, shots: data.shots.slice(1) };
  expect(
    clubProgress(missing, 'premium-flat', query)[0]?.sessions[0],
  ).toMatchObject({ n: 0, missing: 1, median: null, iqr: null });
});

it('uses the shared recent, basis and review filters while retaining unreviewed shots by default', () => {
  const old = makeSession({ date: '2026-01-01' });
  const recent = makeSession({ date: '2026-11-16' });
  const archived = makeSession({ archived: true });
  const shots = [old, recent, archived].flatMap((session) => [
    makeShot({
      sessionId: session.id,
      measurements: { flatCarryPremium: 100, flatCarryRange: 110 },
    }),
    makeShot({
      sessionId: session.id,
      measurements: { flatCarryPremium: 120, flatCarryRange: 130 },
      review: { intent: 'full', contact: 'typical' },
    }),
    makeShot({
      sessionId: session.id,
      measurements: { flatCarryPremium: 999 },
      review: { exclusion: { kind: 'excluded', reason: 'test' } },
    }),
  ]);
  const data = { ...emptyDataset, sessions: [old, recent, archived], shots };
  expect(clubProgress(data, 'premium-flat', query)[0]?.sessions).toHaveLength(
    2,
  );
  const rows = clubProgress(data, 'range-flat', { ...query, mode: 'recent' });
  expect(rows[0]?.sessions).toHaveLength(1);
  expect(rows[0]?.sessions[0]).toMatchObject({ n: 2, median: 120 });
  expect(
    clubProgress(data, 'range-flat', {
      ...query,
      mode: 'recent',
      contact: 'typical',
      intent: 'full',
    })[0]?.sessions[0],
  ).toMatchObject({ n: 1, median: 130 });
});

it('adds per-session strong-strike potential, speed, launch and apex readings', () => {
  const early = makeSession({ date: '2026-11-01' });
  const late = makeSession({ date: '2026-11-17' });
  const shots = [
    // Early session: 10 measured carries 100..109, one missing, plus launch
    // and speed on a subset — enough for a P80 but not for an IQR.
    ...[100, 101, 102, 103, 104, 105, 106, 107, 108, 109].map((carry) =>
      makeShot({
        sessionId: early.id,
        measurements: {
          flatCarryPremium: carry,
          speedPremium: 150,
          launchPremium: 14.5,
          apexPremium: null,
        },
        review: { intent: 'full', contact: 'typical' },
      }),
    ),
    makeShot({
      sessionId: early.id,
      measurements: { flatCarryPremium: null },
      review: { intent: 'full', contact: 'typical' },
    }),
    // Late session: 4 measured carries — no P80 (needs 10), no IQR needs 4 so
    // IQR exists here.
    ...[110, 114, 118, 122].map((carry) =>
      makeShot({
        sessionId: late.id,
        measurements: { flatCarryPremium: carry },
        review: { intent: 'full', contact: 'typical' },
      }),
    ),
  ];
  const data = { ...emptyDataset, sessions: [early, late], shots };
  const [group] = clubProgress(data, 'premium-flat', query);
  expect(group?.sessions).toHaveLength(2);
  const [first, second] = group?.sessions ?? [];
  // P80 of 100..109 at q=0.8: 107 + 0.2 * (108 - 107) = 107.2.
  expect(first?.p80).toEqual({ value: 107.2, n: 10, missing: 1 });
  expect(first?.speed).toEqual({ value: 150, n: 10, missing: 1 });
  expect(first?.launch).toEqual({ value: 14.5, n: 10, missing: 1 });
  // Apex never measured: missing, never zero.
  expect(first?.apex).toEqual({ value: null, n: 0, missing: 11 });
  // Fewer than 10 measured carries: no potential, still honest sample counts.
  expect(second?.p80).toEqual({ value: null, n: 4, missing: 0 });
  expect(second?.iqr).toBe(6);
});

it('keeps per-session potential on the broader population in strong-strike mode', () => {
  const session = makeSession({ date: '2026-11-16' });
  const shots = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 130].map(
    (carry) =>
      makeShot({
        sessionId: session.id,
        measurements: { flatCarryPremium: carry },
        review: { intent: 'full', contact: 'typical' },
      }),
  );
  const data = { ...emptyDataset, sessions: [session], shots };
  const strongQuery = { ...query, contact: 'strong' as const };
  const [group] = clubProgress(data, 'premium-flat', strongQuery);
  // The selected cohort drops below-P80 shots, but the P80 reading still comes
  // from all 11 measured full swings (sorted 100..109,130: offset 8 → 108).
  expect(group?.sessions[0]?.n).toBeLessThan(11);
  expect(group?.sessions[0]?.p80).toEqual({ value: 108, n: 11, missing: 0 });
});

it('retains broader-population sessions that vanish from the strong-strike cohort', () => {
  const early = makeSession({ date: '2026-11-01' });
  const late = makeSession({ date: '2026-11-17' });
  const shots = [
    ...[100, 101, 102, 103, 104, 105, 106, 107, 108, 109].map((carry) =>
      makeShot({
        sessionId: early.id,
        measurements: { flatCarryPremium: carry },
        review: { intent: 'full', contact: 'typical' },
      }),
    ),
    ...[120, 121, 122, 123, 124, 125, 126, 127, 128, 129].map((carry) =>
      makeShot({
        sessionId: late.id,
        measurements: { flatCarryPremium: carry },
        review: { intent: 'full', contact: 'typical' },
      }),
    ),
  ];
  const data = { ...emptyDataset, sessions: [early, late], shots };
  const strongQuery = { ...query, contact: 'strong' as const };
  const [group] = clubProgress(data, 'premium-flat', strongQuery);
  // The club-wide threshold (P80 of all 20 carries = 125.2) leaves the late
  // session in the selected cohort but drops every early shot — yet the early
  // session still happened and keeps its own broader-population P80 (107.2).
  expect(group?.sessions.map((point) => point.session.id)).toEqual([
    early.id,
    late.id,
  ]);
  const [earlyPoint, latePoint] = group?.sessions ?? [];
  expect(earlyPoint?.n).toBe(0);
  expect(earlyPoint?.median).toBeNull();
  expect(earlyPoint?.p80.n).toBe(10);
  expect(earlyPoint?.p80.value).toBeCloseTo(107.2);
  expect(latePoint?.n).toBeGreaterThan(0);
  expect(latePoint?.p80.n).toBe(10);
  expect(latePoint?.p80.value).toBeCloseTo(127.2);
  // The potential series therefore reports a real change, not zero.
  const summaries = summarizeClubMetric([group!], 'p80');
  expect(summaries[0]?.measured).toBe(2);
  expect(summaries[0]?.delta).toBeCloseTo(20);
});

it('requires two measured sessions before reporting a cross-session delta', () => {
  const session = makeSession({ date: '2026-11-16' });
  const shots = [
    makeShot({
      sessionId: session.id,
      recordedClub: '9i',
      measurements: { flatCarryPremium: 120 },
    }),
  ];
  const data = { ...emptyDataset, sessions: [session], shots };
  const groups = clubProgress(data, 'premium-flat', query);
  const [summary] = summarizeClubMetric(groups, 'median');
  // One measured session: first and latest are the same point, so there is no
  // delta to report (a "+0" would read as an unchanged trend).
  expect(summary?.measured).toBe(1);
  expect(summary?.first).toMatchObject({ value: 120 });
  expect(summary?.latest).toMatchObject({ value: 120 });
  expect(summary?.delta).toBeNull();
  expect(summary?.deltaReason).toBe('insufficient');
});

it('withholds the 7i cross-session delta when the first date mixes an untimed and a timed visit', () => {
  // Review A2 end-to-end: 7i medians 100 m (untimed) and 130 m (08:00) on the
  // first date, 150 m the next day. The +50 m claim was ambiguous (+50 or
  // +20), so the delta is withheld while every visit keeps its own measured
  // value and session id (the UUID recap links hang off those ids).
  const untimed = makeSession({ id: '11111111-1111-4111-8111-111111111111', date: '2026-11-10', time: null });
  const morning = makeSession({ id: '22222222-2222-4222-8222-222222222222', date: '2026-11-10', time: '08:00' });
  const nextDay = makeSession({ id: '33333333-3333-4333-8333-333333333333', date: '2026-11-11', time: null });
  const shots = [
    makeShot({ sessionId: untimed.id, measurements: { flatCarryPremium: 100 } }),
    makeShot({ sessionId: morning.id, measurements: { flatCarryPremium: 130 } }),
    makeShot({ sessionId: nextDay.id, measurements: { flatCarryPremium: 150 } }),
  ];
  const data = { ...emptyDataset, sessions: [untimed, morning, nextDay], shots };
  const groups = clubProgress(data, 'premium-flat', query);
  expect(groups).toHaveLength(1);
  const points = groups[0]?.sessions ?? [];
  // Every visit is present, in display order, keyed by its own UUID.
  expect(points.map((p) => p.session.id)).toEqual([untimed.id, morning.id, nextDay.id]);
  expect(points.map((p) => p.median)).toEqual([100, 130, 150]);
  const [summary] = summarizeClubMetric(groups, 'median');
  expect(summary?.measured).toBe(3);
  expect(summary?.first).toMatchObject({ value: 100, session: untimed });
  expect(summary?.latest).toMatchObject({ value: 150, session: nextDay });
  expect(summary?.delta).toBeNull();
  expect(summary?.deltaReason).toBe('ambiguous');
  // Same-day visits with distinct times stay ordered: 08:00 then 17:00 on
  // the first date plus the next day reports the 08:00 → next-day delta.
  const evening = makeSession({ id: '44444444-4444-4444-8444-444444444444', date: '2026-11-10', time: '17:00' });
  const timedData = {
    ...emptyDataset,
    sessions: [morning, evening, nextDay],
    shots: [
      makeShot({ sessionId: morning.id, measurements: { flatCarryPremium: 100 } }),
      makeShot({ sessionId: evening.id, measurements: { flatCarryPremium: 130 } }),
      makeShot({ sessionId: nextDay.id, measurements: { flatCarryPremium: 150 } }),
    ],
  };
  const [timedSummary] = summarizeClubMetric(
    clubProgress(timedData, 'premium-flat', query),
    'median',
  );
  expect(timedSummary?.first).toMatchObject({ value: 100, session: morning });
  expect(timedSummary?.delta).toBe(50);
  expect(timedSummary?.deltaReason).toBeNull();
});

it('summarizes first, latest, best and delta per club for one metric', () => {
  const sessions = [
    makeSession({ date: '2026-11-01' }),
    makeSession({ date: '2026-11-10' }),
    makeSession({ date: '2026-11-17' }),
  ];
  const carries = [
    [90, 100, 110, 120], // median 105, iqr 15
    [110, 115, 120, 125], // median 117.5, iqr 7.5
    [null, null, null, null], // no carry
  ];
  const shots = sessions.flatMap((session, i) =>
    (carries[i] ?? []).map((carry) =>
      makeShot({
        sessionId: session.id,
        measurements: { flatCarryPremium: carry },
      }),
    ),
  );
  const data = { ...emptyDataset, sessions, shots };
  const groups = clubProgress(data, 'premium-flat', query);
  const summaries = summarizeClubMetric(groups, 'median');
  expect(summaries).toHaveLength(1);
  const [summary] = summaries;
  expect(summary?.sessions).toBe(3);
  expect(summary?.measured).toBe(2);
  expect(summary?.first).toMatchObject({ value: 105 });
  expect(summary?.latest).toMatchObject({ value: 117.5 });
  expect(summary?.best).toMatchObject({ value: 117.5 });
  expect(summary?.delta).toBeCloseTo(12.5);
  // Spread: lower is better, so the best session is the tightest one.
  const spread = summarizeClubMetric(groups, 'iqr', true)[0];
  expect(spread?.first?.value).toBe(15);
  expect(spread?.best).toMatchObject({ value: 7.5 });
  expect(spread?.delta).toBeCloseTo(-7.5);
  // pointReading exposes the same values the chart plots.
  expect(pointReading(groups[0]!.sessions[0]!, 'median').value).toBe(105);
  expect(pointReading(groups[0]!.sessions[2]!, 'median').value).toBeNull();
});

describe('firstLatestDelta', () => {
  const s = (id: string, date: string, time: string | null = null) =>
    makeSession({ id, date, time });
  it('withholds the delta for a single measured visit (no meaningless "+0")', () => {
    const session = s('a', '2026-11-10');
    const { first, latest, delta } = firstLatestDelta([
      { session, value: 120 },
    ]);
    expect(first).toBe(latest);
    expect(delta).toBeNull();
  });
  it('withholds the delta when same-day endpoints have missing or equal times', () => {
    const morning = s('m', '2026-11-10', '08:00');
    const untimed = s('u', '2026-11-10', null);
    const again = s('a', '2026-11-10', '08:00');
    expect(chronologyKnown(morning, untimed)).toBe(false);
    expect(chronologyKnown(morning, again)).toBe(false);
    expect(
      firstLatestDelta([
        { session: untimed, value: 100 },
        { session: morning, value: 150 },
      ]).delta,
    ).toBeNull();
    expect(
      firstLatestDelta([
        { session: morning, value: 100 },
        { session: again, value: 150 },
      ]).delta,
    ).toBeNull();
  });
  it('reports the delta for two known start times on the same day', () => {
    const morning = s('m', '2026-11-10', '08:00');
    const evening = s('e', '2026-11-10', '17:00');
    expect(chronologyKnown(morning, evening)).toBe(true);
    const { delta } = firstLatestDelta([
      { session: morning, value: 100 },
      { session: evening, value: 150 },
    ]);
    expect(delta).toBe(50);
  });
  it('reports the delta across different dates regardless of times', () => {
    const early = s('e1', '2026-11-01');
    const late = s('l1', '2026-11-10');
    expect(chronologyKnown(early, late)).toBe(true);
    expect(
      firstLatestDelta([
        { session: early, value: 100 },
        { session: late, value: 90 },
      ]).delta,
    ).toBe(-10);
  });
  it('withholds the delta when the earliest date has another unordered visit, even though the endpoint dates differ', () => {
    // Review A2: first date carries an untimed 100 m visit and an 08:00 130 m
    // visit; the next day is 150 m. "First" could be either same-day value
    // (+50 m or +20 m), so no directional delta is fair.
    const untimed = s('u', '2026-11-10', null);
    const morning = s('m', '2026-11-10', '08:00');
    const nextDay = s('n', '2026-11-11', null);
    const { first, latest, delta, deltaReason } = firstLatestDelta([
      { session: untimed, value: 100 },
      { session: morning, value: 130 },
      { session: nextDay, value: 150 },
    ]);
    // The endpoint values themselves are preserved and identified…
    expect(first).toMatchObject({ value: 100 });
    expect(latest).toMatchObject({ value: 150 });
    // …but the delta is withheld as ambiguous, never claimed as +50 m.
    expect(delta).toBeNull();
    expect(deltaReason).toBe('ambiguous');
  });
  it('withholds the delta when the latest date has another unordered visit', () => {
    const early = s('e', '2026-11-10', '09:00');
    const untimed = s('u', '2026-11-12', null);
    const afternoon = s('a', '2026-11-12', '14:00');
    const { delta, deltaReason, firstAmbiguous, latestAmbiguous } = firstLatestDelta([
      { session: early, value: 100 },
      { session: untimed, value: 120 },
      { session: afternoon, value: 130 },
    ]);
    expect(delta).toBeNull();
    expect(deltaReason).toBe('ambiguous');
    expect(firstAmbiguous).toBe(false);
    expect(latestAmbiguous).toBe(true);
  });
  it('keeps same-day visits with distinct times ordered and reports their delta', () => {
    const morning = s('m', '2026-11-10', '08:00');
    const evening = s('e', '2026-11-10', '17:00');
    const nextDay = s('n', '2026-11-11', null);
    const { first, latest, delta, deltaReason } = firstLatestDelta([
      { session: morning, value: 100 },
      { session: evening, value: 130 },
      { session: nextDay, value: 150 },
    ]);
    expect(first).toMatchObject({ value: 100 });
    expect(latest).toMatchObject({ value: 150 });
    expect(delta).toBe(50);
    expect(deltaReason).toBeNull();
  });
  it('marks a single measured visit as insufficient rather than ambiguous', () => {
    const session = s('a', '2026-11-10');
    const { delta, deltaReason } = firstLatestDelta([{ session, value: 120 }]);
    expect(delta).toBeNull();
    expect(deltaReason).toBe('insufficient');
  });
  it('marks same-day unordered endpoints as ambiguous', () => {
    const morning = s('m', '2026-11-10', '08:00');
    const untimed = s('u', '2026-11-10', null);
    const { delta, deltaReason } = firstLatestDelta([
      { session: untimed, value: 100 },
      { session: morning, value: 150 },
    ]);
    expect(delta).toBeNull();
    expect(deltaReason).toBe('ambiguous');
  });
});

it('keeps a club with only broader-cohort P80 readings under a Typical filter', () => {
  const session = makeSession({ id: 's-p80-only', date: '2026-11-16' });
  // Full swings with uncertain contact: excluded from the Typical cohort but
  // part of the broader population that feeds strong-strike potential.
  const shots = Array.from({ length: 12 }, (_, i) =>
    makeShot({
      sessionId: session.id,
      recordedClub: '7i',
      rowIndex: i + 1,
      measurements: { flatCarryPremium: 120 + i },
      review: { intent: 'full', contact: 'uncertain' },
    }),
  );
  const data = { ...emptyDataset, sessions: [session], shots };
  const typical = { ...query, contact: 'typical' as const };
  const groups = clubProgress(data, 'premium-flat', typical);
  const group = groups.find((g) => g.club === '7i');
  // The club must not disappear: its Potential (P80) reading stays available
  // even though no shot passes the Typical contact filter.
  expect(group).toBeDefined();
  expect(group?.sessions[0]?.median).toBeNull();
  expect(group?.sessions[0]?.n).toBe(0);
  expect(group?.sessions[0]?.p80.n).toBe(12);
  expect(group?.sessions[0]?.p80.value).toBeCloseTo(128.8);
  const [summary] = summarizeClubMetric(groups, 'p80');
  expect(summary?.measured).toBe(1);
  expect(summary?.latest?.value).toBeCloseTo(128.8);
});
