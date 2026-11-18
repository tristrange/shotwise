import { expect, it } from 'vitest';
import { assessUnusualShots } from './unusualShots';
import { makeSession, makeShot } from './fixtures';
import {
  clubGaps,
  practiceInsights,
  selectCohort,
  type AnalysisQuery,
} from './analytics';
import { emptyDataset } from './model';

it('detects a joint low driver shot against an earlier upper-quartile reference despite a wide baseline', () => {
  const session = makeSession();
  const history = Array.from({ length: 20 }, (_, i) =>
    makeShot({
      sessionId: session.id,
      recordedClub: 'D',
      rowIndex: i + 1,
      measurements: { flatCarryRange: 50 + i * 8, speedRange: 150 + i * 5 },
    }),
  );
  const shot = makeShot({
    sessionId: session.id,
    recordedClub: 'D',
    rowIndex: 21,
    measurements: { flatCarryRange: 40, speedRange: 100 },
  });
  expect(
    assessUnusualShots([...history, shot], [session]).get(shot.id),
  ).toMatchObject({
    kind: 'assessed',
    unusual: true,
    baselineCount: 20,
    carryReference: 164,
    speedReference: 221.25,
    speedThreshold: 177,
  });
  const assessment = assessUnusualShots([...history, shot], [session]).get(
    shot.id,
  );
  expect(
    assessment?.kind === 'assessed' && assessment.carryThreshold,
  ).toBeCloseTo(106.6);
});

it('recommends the longer iron from its median gap, not from overlapping carry bands', () => {
  const session = makeSession();
  const shots = [
    ...Array.from({ length: 10 }, () =>
      makeShot({
        sessionId: session.id,
        recordedClub: '5i',
        measurements: { flatCarryPremium: 111 },
      }),
    ),
    ...Array.from({ length: 10 }, () =>
      makeShot({
        sessionId: session.id,
        recordedClub: '6i',
        measurements: { flatCarryPremium: 109 },
      }),
    ),
  ];
  const data = { ...emptyDataset, sessions: [session], shots };
  const query = {
    mode: 'all',
    today: '2026-11-17',
    contact: 'all',
    intent: 'all',
  } satisfies AnalysisQuery;
  expect(clubGaps(data, 'premium-flat', query)[1]).toMatchObject({
    gap: 2,
    flag: 'small',
  });
  const advice = practiceInsights(data, 'premium-flat', query).find(
    (i) => i.kind === 'gapping',
  );
  expect(advice?.text).toContain('Work on 5i');
  expect(advice?.text).toContain('111 m');
  expect(advice?.text).toContain('109 m');
});

it('lets the user hide automatic and reviewed mishits while preserving typical, unassessed and original shots', () => {
  const session = makeSession();
  const history = Array.from({ length: 20 }, (_, i) =>
    makeShot({
      sessionId: session.id,
      recordedClub: 'PW',
      rowIndex: i + 1,
      review: { intent: 'full' },
      measurements: {
        flatCarryRange: 100 + (i % 5),
        speedRange: 140 + (i % 5),
      },
    }),
  );
  const low = makeShot({
    sessionId: session.id,
    recordedClub: 'PW',
    rowIndex: 21,
    review: { intent: 'full' },
    measurements: { flatCarryRange: 40, speedRange: 90 },
  });
  const typical = {
    ...low,
    id: crypto.randomUUID(),
    rowIndex: 22,
    review: { ...low.review, contact: 'typical' as const },
  };
  const known = {
    ...low,
    id: crypto.randomUUID(),
    rowIndex: 23,
    review: { ...low.review, contact: 'mishit' as const },
  };
  const missing = {
    ...low,
    id: crypto.randomUUID(),
    rowIndex: 24,
    measurements: { ...low.measurements, speedRange: null },
  };
  const shots = [...history, low, typical, known, missing];
  const original = structuredClone(shots);
  const query = {
    mode: 'all',
    today: '2026-11-17',
    contact: 'all',
    intent: 'all',
  } satisfies AnalysisQuery;
  expect(selectCohort(shots, [session], query)).toHaveLength(24);
  expect(
    selectCohort(shots, [session], { ...query, hideLikelyMishits: true }).map(
      (s) => s.id,
    ),
  ).toEqual([...history, typical, missing].map((s) => s.id));
  expect(shots).toEqual(original);
});

it('does not backfill Recent with old shots after hiding likely mishits', () => {
  const old = makeSession({ date: '2026-10-01' });
  const recent = makeSession({ date: '2026-11-16' });
  const shots = [
    ...Array.from({ length: 50 }, (_, i) =>
      makeShot({
        sessionId: old.id,
        recordedClub: 'D',
        rowIndex: i + 1,
        measurements: { flatCarryRange: 150, speedRange: 200 },
      }),
    ),
    ...Array.from({ length: 60 }, (_, i) =>
      makeShot({
        sessionId: recent.id,
        recordedClub: 'D',
        rowIndex: i + 1,
        measurements: {
          flatCarryRange: i < 20 ? 150 : 30,
          speedRange: i < 20 ? 200 : 80,
        },
      }),
    ),
  ];
  const query = {
    mode: 'recent',
    today: '2026-11-17',
    contact: 'all',
    intent: 'all',
  } satisfies AnalysisQuery;
  expect(selectCohort(shots, [old, recent], query)).toHaveLength(60);
  const filtered = selectCohort(shots, [old, recent], {
    ...query,
    hideLikelyMishits: true,
  });
  expect(filtered.length).toBeLessThan(60);
  expect(filtered.every((s) => s.sessionId === recent.id)).toBe(true);
});
