import { expect, it } from 'vitest';
import { shotShapes } from './shotShapes';
import { csvFixture, makeSession, makeShot } from './fixtures';
import { parseCsv } from './csv';
import { emptyDataset } from './model';
import type { AnalysisQuery } from './analytics';

const query = {
  mode: 'all',
  today: '2026-11-17',
  intent: 'all',
  contact: 'all',
} satisfies AnalysisQuery;

it('plots recorded launch direction against recorded curve, including zero, without needing carry or estimating positions', async () => {
  const session = makeSession();
  const parsed = await parseCsv(
    new TextEncoder().encode(
      csvFixture([
        { 'Launch Direction': '5L', Curve: '3R', 'From Centre (m)': '12R' },
        { 'Launch Direction': '0', Curve: '0', 'Carry Dist. Range (m)': '--' },
        { 'Launch Direction': '--', Curve: '2L', 'From Centre (m)': '8L' },
      ]),
    ),
  );
  const data = {
    ...emptyDataset,
    sessions: [session],
    shots: parsed.shots.map((s) => makeShot({ ...s, sessionId: session.id })),
  };
  const original = structuredClone(data);
  const view = shotShapes(data, query);
  expect(view.shots).toHaveLength(3);
  expect(
    view.points.map(({ launchDirection, curve }) => ({
      launchDirection,
      curve,
    })),
  ).toEqual([
    { launchDirection: -5, curve: 3 },
    { launchDirection: 0, curve: 0 },
  ]);
  expect(data).toEqual(original);
  expect(
    shotShapes({ ...data, shots: [...data.shots].reverse() }, query).shots.map(
      (s) => s.rowIndex,
    ),
  ).toEqual([1, 2, 3]);
});

it('does not replace a missing curve or direction with From Centre or carry', () => {
  const session = makeSession();
  const data = {
    ...emptyDataset,
    sessions: [session],
    shots: [
      makeShot({
        sessionId: session.id,
        measurements: { launchDirection: 5, curve: null, fromCentre: 20 },
      }),
      makeShot({
        sessionId: session.id,
        measurements: { launchDirection: null, curve: -3, fromCentre: -15 },
      }),
    ],
  };
  expect(shotShapes(data, query)).toMatchObject({
    points: [],
    shots: data.shots,
  });
});

it('uses shared window, club and review filters while including unreviewed shots by default', () => {
  const old = makeSession({ date: '2026-01-01' });
  const recent = makeSession({ date: '2026-11-17' });
  const archived = makeSession({ archived: true });
  const data = {
    ...emptyDataset,
    sessions: [old, recent, archived],
    shots: [old, recent, archived].flatMap((session) => [
      makeShot({
        sessionId: session.id,
        measurements: { launchDirection: -2, curve: 3 },
      }),
      makeShot({
        sessionId: session.id,
        measurements: { launchDirection: 2, curve: -3 },
        review: {
          intent: 'full',
          contact: 'typical',
          club: { kind: 'corrected', club: '9i' },
        },
      }),
      makeShot({
        sessionId: session.id,
        measurements: { launchDirection: 0, curve: 0 },
        review: { exclusion: { kind: 'excluded', reason: 'test' } },
      }),
    ]),
  };
  expect(shotShapes(data, query).points).toHaveLength(4);
  expect(shotShapes(data, { ...query, mode: 'recent' }).points).toHaveLength(2);
  expect(
    shotShapes(data, {
      ...query,
      mode: 'recent',
      club: '9i',
      intent: 'full',
      contact: 'typical',
    }).points,
  ).toMatchObject([{ launchDirection: 2, curve: -3 }]);
});
