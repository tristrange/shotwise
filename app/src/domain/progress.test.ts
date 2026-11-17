import { expect, it } from 'vitest';
import { clubProgress } from './progress';
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
