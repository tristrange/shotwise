import { expect, it } from 'vitest';
import { clubProgress, summarizeClubMetric, pointReading } from './progress';
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
