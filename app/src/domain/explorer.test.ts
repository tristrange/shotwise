import { expect, it } from 'vitest';
import {
  EXPLORER_AXES,
  explorerAxis,
  explorerClubs,
  explorerPlot,
  type ExplorerQuery,
} from './explorer';
import { assessUnusualShots } from './unusualShots';
import { BASES, emptyDataset, shiftDate, type Basis } from './model';
import { makeSession, makeShot } from './fixtures';

const baseQuery = {
  club: '7i',
  x: 'speed',
  y: 'carry',
  basis: 'premium-flat',
  scope: 'all',
  intent: 'all',
  contact: 'all',
  today: '2026-11-17',
} satisfies ExplorerQuery;

function datasetWith(
  sessions: ReturnType<typeof makeSession>[],
  shots: ReturnType<typeof makeShot>[],
) {
  return { ...emptyDataset, sessions, shots };
}

it('maps every axis onto the shared basis fields with labels and units', () => {
  const expected = {
    carry: { label: 'Carry', unit: 'm' },
    total: { label: 'Total distance', unit: 'm' },
    speed: { label: 'Ball speed', unit: 'kph' },
    launch: { label: 'Launch angle', unit: '°' },
    apex: { label: 'Apex', unit: 'm' },
  } as const;
  expect(EXPLORER_AXES).toEqual(['carry', 'total', 'speed', 'launch', 'apex']);
  for (const basis of Object.keys(BASES) as Basis[]) {
    for (const axis of EXPLORER_AXES) {
      const info = explorerAxis(axis, basis);
      expect(info.metric).toBe(BASES[basis][axis]);
      expect(info.label).toBe(expected[axis].label);
      expect(info.unit).toBe(expected[axis].unit);
    }
  }
});

it('emits exact paired points including zero and reports per-axis missing counts', () => {
  const session = makeSession();
  const paired = makeShot({
    sessionId: session.id,
    rowIndex: 1,
    measurements: { speedPremium: 130, flatCarryPremium: 100 },
  });
  const zero = makeShot({
    sessionId: session.id,
    rowIndex: 2,
    measurements: { speedPremium: 0, flatCarryPremium: 0 },
  });
  const missingSpeed = makeShot({
    sessionId: session.id,
    rowIndex: 3,
    measurements: { speedPremium: null, flatCarryPremium: 105 },
  });
  const missingCarry = makeShot({
    sessionId: session.id,
    rowIndex: 4,
    measurements: { speedPremium: 108, flatCarryPremium: null },
  });
  const missingBoth = makeShot({
    sessionId: session.id,
    rowIndex: 5,
    measurements: { speedPremium: null, flatCarryPremium: null },
  });
  const data = datasetWith(
    [session],
    [paired, zero, missingSpeed, missingCarry, missingBoth],
  );
  const plot = explorerPlot(data, baseQuery);
  expect(plot.shots.map((s) => s.id)).toEqual([
    paired.id,
    zero.id,
    missingSpeed.id,
    missingCarry.id,
    missingBoth.id,
  ]);
  expect(plot.points.map((p) => ({ id: p.shot.id, x: p.x, y: p.y }))).toEqual([
    { id: paired.id, x: 130, y: 100 },
    { id: zero.id, x: 0, y: 0 },
  ]);
  expect(plot.missingX).toBe(2);
  expect(plot.missingY).toBe(2);
  expect(plot.omitted).toBe(3);
  expect(plot.xAxis.metric).toBe('speedPremium');
  expect(plot.yAxis.metric).toBe('flatCarryPremium');
  expect(plot.basisLabel).toBe(BASES['premium-flat'].label);
});

it('mirrors values and missing counts when the axes are swapped', () => {
  const session = makeSession();
  const shot = makeShot({
    sessionId: session.id,
    measurements: { speedPremium: 130, flatCarryPremium: 100 },
  });
  const missingSpeed = makeShot({
    sessionId: session.id,
    rowIndex: 2,
    measurements: { speedPremium: null, flatCarryPremium: 105 },
  });
  const data = datasetWith([session], [shot, missingSpeed]);
  const swapped = explorerPlot(data, { ...baseQuery, x: 'carry', y: 'speed' });
  expect(swapped.points).toEqual([{ shot, x: 100, y: 130 }]);
  expect(swapped.missingX).toBe(0);
  expect(swapped.missingY).toBe(1);
  expect(swapped.omitted).toBe(1);
  expect(swapped.xAxis.label).toBe('Carry');
  expect(swapped.yAxis.label).toBe('Ball speed');
});

it('remaps measurements when the shared basis changes', () => {
  const session = makeSession();
  const shot = makeShot({
    sessionId: session.id,
    measurements: {
      speedPremium: null,
      speedRange: 108,
      flatCarryPremium: 105,
      carryRange: 95,
    },
  });
  const data = datasetWith([session], [shot]);
  const premium = explorerPlot(data, baseQuery);
  expect(premium.points).toEqual([]);
  expect(premium.missingX).toBe(1);
  const range = explorerPlot(data, { ...baseQuery, basis: 'range' });
  expect(range.points).toEqual([{ shot, x: 108, y: 95 }]);
  expect(range.basisLabel).toBe(BASES.range.label);
});

it('applies the shared window, intent, contact, club, exclusion and archive filters', () => {
  const today = makeSession({ date: '2026-11-17' });
  const old = makeSession({ date: shiftDate('2026-11-17', -90) });
  const archived = makeSession({ date: '2026-11-16', archived: true });
  const corrected = makeShot({
    sessionId: today.id,
    recordedClub: '8i',
    review: { club: { kind: 'corrected', club: '7i' } },
    measurements: { speedPremium: 120, flatCarryPremium: 90 },
  });
  const excluded = makeShot({
    sessionId: today.id,
    rowIndex: 2,
    review: { exclusion: { kind: 'excluded', reason: 'test' } },
    measurements: { speedPremium: 121, flatCarryPremium: 91 },
  });
  const mishit = makeShot({
    sessionId: today.id,
    rowIndex: 3,
    review: { intent: 'full', contact: 'mishit' },
    measurements: { speedPremium: 122, flatCarryPremium: 92 },
  });
  const partial = makeShot({
    sessionId: today.id,
    rowIndex: 4,
    review: { intent: 'partial', contact: 'typical' },
    measurements: { speedPremium: 123, flatCarryPremium: 93 },
  });
  const oldShot = makeShot({
    sessionId: old.id,
    measurements: { speedPremium: 100, flatCarryPremium: 70 },
  });
  const archivedShot = makeShot({
    sessionId: archived.id,
    measurements: { speedPremium: 99, flatCarryPremium: 69 },
  });
  const otherClub = makeShot({
    sessionId: today.id,
    rowIndex: 5,
    recordedClub: '9i',
    measurements: { speedPremium: 130, flatCarryPremium: 95 },
  });
  const data = datasetWith(
    [today, old, archived],
    [corrected, excluded, mishit, partial, oldShot, archivedShot, otherClub],
  );

  const all = explorerPlot(data, baseQuery);
  // Corrected club is honoured, exclusions and archived visits are dropped.
  expect(all.shots.map((s) => s.id)).toEqual([
    corrected.id,
    mishit.id,
    partial.id,
    oldShot.id,
  ]);
  expect(all.points.map((p) => p.shot.id)).toEqual([
    corrected.id,
    mishit.id,
    partial.id,
    oldShot.id,
  ]);

  const recent = explorerPlot(data, { ...baseQuery, scope: 'recent' });
  expect(recent.shots.map((s) => s.id)).toEqual([
    corrected.id,
    mishit.id,
    partial.id,
  ]);
  expect(recent.shots.some((s) => s.id === oldShot.id)).toBe(false);

  const named = explorerPlot(data, {
    ...baseQuery,
    scope: { session: old.id },
  });
  expect(named.shots.map((s) => s.id)).toEqual([oldShot.id]);

  const typical = explorerPlot(data, { ...baseQuery, contact: 'typical' });
  expect(typical.shots.map((s) => s.id)).toEqual([partial.id]);

  const full = explorerPlot(data, { ...baseQuery, intent: 'full' });
  expect(full.shots.map((s) => s.id)).toEqual([mishit.id]);

  const other = explorerPlot(data, { ...baseQuery, club: '9i' });
  expect(other.shots.map((s) => s.id)).toEqual([otherClub.id]);
});

it('uses the complete eligible population of one named session, without the Recent window', () => {
  const today = makeSession({ date: '2026-11-17' });
  const old = makeSession({ date: shiftDate('2026-11-17', -90) });
  const oldShots = Array.from({ length: 60 }, (_, i) =>
    makeShot({
      sessionId: old.id,
      rowIndex: i + 1,
      measurements: { speedPremium: 100 + i, flatCarryPremium: 70 + i },
    }),
  );
  const todayShot = makeShot({
    sessionId: today.id,
    measurements: { speedPremium: 140, flatCarryPremium: 110 },
  });
  const data = datasetWith([today, old], [...oldShots, todayShot]);
  const named = explorerPlot(data, {
    ...baseQuery,
    scope: { session: old.id },
  });
  expect(named.shots).toHaveLength(60);
  expect(named.points).toHaveLength(60);
  const recent = explorerPlot(data, { ...baseQuery, scope: 'recent' });
  expect(recent.shots.map((s) => s.id)).toEqual([todayShot.id]);
});

it('orders cohort shots by session date descending, then source row', () => {
  const newer = makeSession({ date: '2026-11-17' });
  const older = makeSession({ date: '2026-11-10' });
  const shots = [
    makeShot({
      sessionId: older.id,
      rowIndex: 2,
      measurements: { speedPremium: 101, flatCarryPremium: 71 },
    }),
    makeShot({
      sessionId: newer.id,
      rowIndex: 1,
      measurements: { speedPremium: 140, flatCarryPremium: 110 },
    }),
    makeShot({
      sessionId: older.id,
      rowIndex: 1,
      measurements: { speedPremium: 100, flatCarryPremium: 70 },
    }),
  ];
  const plot = explorerPlot(datasetWith([newer, older], shots), baseQuery);
  expect(plot.points.map((p) => [p.shot.rowIndex, p.x, p.y])).toEqual([
    [1, 140, 110],
    [1, 100, 70],
    [2, 101, 71],
  ]);
});

it('never applies automatic unusual-shot flags: an assessed unusual shot stays plotted under All contact', () => {
  const today = makeSession({ date: '2026-11-17' });
  const earlier = makeSession({ date: '2026-11-07' });
  const baseline = Array.from({ length: 20 }, (_, i) =>
    makeShot({
      sessionId: earlier.id,
      rowIndex: i + 1,
      review: { intent: 'full', contact: 'typical' },
      measurements: { flatCarryRange: 200, speedRange: 250 },
    }),
  );
  const target = makeShot({
    sessionId: today.id,
    measurements: { flatCarryRange: 100, speedRange: 150 },
  });
  const data = datasetWith([today, earlier], [...baseline, target]);

  const assessment = assessUnusualShots(data.shots, data.sessions).get(
    target.id,
  );
  expect(assessment).toMatchObject({ kind: 'assessed', unusual: true });

  const allContact = explorerPlot(data, {
    ...baseQuery,
    basis: 'range-flat',
    x: 'speed',
    y: 'carry',
  });
  expect(allContact.shots.map((s) => s.id)).toContain(target.id);
  expect(allContact.points.map((p) => p.shot.id)).toContain(target.id);

  const typical = explorerPlot(data, {
    ...baseQuery,
    basis: 'range-flat',
    contact: 'typical',
  });
  // The target is contact-uncertain, so only the explicit Reviewed typical
  // cohort removes it — not an automatic flag.
  expect(typical.shots.map((s) => s.id)).not.toContain(target.id);
});

it('lists effective clubs in club order for the club selector', () => {
  const session = makeSession();
  const data = datasetWith(
    [session],
    [
      makeShot({ sessionId: session.id, recordedClub: '9i' }),
      makeShot({
        sessionId: session.id,
        rowIndex: 2,
        recordedClub: 'PW',
        review: { club: { kind: 'corrected', club: '7i' } },
      }),
      makeShot({ sessionId: session.id, rowIndex: 3, recordedClub: '5i' }),
      makeShot({ sessionId: session.id, rowIndex: 4, recordedClub: '9i' }),
    ],
  );
  expect(explorerClubs(data, '2026-11-17')).toEqual(['5i', '7i', '9i']);
});
