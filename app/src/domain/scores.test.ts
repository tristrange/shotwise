import { describe, expect, it } from 'vitest';
import { makeSession, makeShot } from './fixtures';
import {
  emptyDataset,
  shiftDate,
  type Session,
  type Shot,
} from './model';
import type { AnalysisQuery as Query } from './analytics';
import { CATEGORY_SCORES_VERSION, categoryScores } from './scores';

const current = makeSession({ id: 'current', time: '12:00' });
const older = makeSession({
  id: 'older',
  date: shiftDate(current.date, -30),
});

const query = (overrides: Partial<Query> = {}): Query => ({
  mode: 'all',
  today: current.date,
  intent: 'all',
  contact: 'all',
  ...overrides,
});

const fullTypical = { intent: 'full', contact: 'typical' } as const;
const fullMishit = { intent: 'full', contact: 'mishit' } as const;

type ShotOptions = NonNullable<Parameters<typeof makeShot>[0]>;
function series(
  session: Session,
  carries: (number | null)[],
  options: ShotOptions = {},
) {
  return carries.map((carry, i) =>
    makeShot({
      ...options,
      id: `${session.id}-${i}-${crypto.randomUUID().slice(0, 8)}`,
      rowIndex: (options.rowIndex ?? 1) + i,
      sessionId: session.id,
      recordedClub: options.recordedClub ?? '7i',
      measurements: {
        flatCarryPremium: carry,
        flatCarryRange: carry === null ? null : carry + 20,
        ...options.measurements,
      },
      review: options.review ?? { ...fullTypical },
    }),
  );
}

const scores = (sessions: Session[], shots: Shot[], club = '7i') =>
  categoryScores(
    { ...emptyDataset, sessions, shots },
    'premium-flat',
    query(),
    club,
  );

describe('category score definitions (PR 18)', () => {
  it('pins the model version', () => {
    expect(CATEGORY_SCORES_VERSION).toBe('category-scores-1');
  });

  it('reports distance potential from the strong-strike P80 when the sample is sufficient', () => {
    const shots = series(current, [120, 121, 119, 120, 122, 121, 120, 123, 119, 120, 121, 124]);
    const result = scores([current], shots);
    expect(result.distancePotential.sufficient).toBe(true);
    expect(result.distancePotential.unit).toBe('m');
    expect(result.distancePotential.betterDirection).toBe('higher');
    // P80 of 12 values around 120–124 lands in that band, never the max-only.
    expect(result.distancePotential.value).toBeGreaterThanOrEqual(120);
    expect(result.distancePotential.value).toBeLessThanOrEqual(124);
    expect(result.distancePotential.n).toBe(12);
  });

  it('returns no potential below the minimum sample instead of guessing', () => {
    const shots = series(current, [120, 130, 140]);
    const result = scores([current], shots);
    expect(result.distancePotential.value).toBeNull();
    expect(result.distancePotential.sufficient).toBe(false);
    expect(result.distancePotential.note).toContain('Needs 10');
  });

  it('computes consistency from the broader population, mishits included', () => {
    // 12 clean shots plus 2 severe mishits: the reliability cohort counts all
    // 14 (so the IQR sees the mishits), while potential is computed from the
    // 12 non-mishit full swings only (ADR-0002, roadmap §8.2).
    const clean = series(current, Array.from({ length: 12 }, (_, i) => 120 + (i % 3)));
    const withMishits = [
      ...clean,
      ...series(current, [80, 82], { review: { ...fullMishit } }),
    ];
    const result = scores([current], withMishits);
    expect(result.consistency.sufficient).toBe(true);
    expect(result.consistency.n).toBe(14);
    expect(result.consistency.betterDirection).toBe('lower');
    expect(result.consistency.aux?.[0]?.label).toBe('Lower carry tail (P10)');
    expect(result.distancePotential.n).toBe(12);
  });

  it('never lets mishits inflate distance potential', () => {
    const clean = series(current, Array.from({ length: 12 }, (_, i) => 120 + (i % 3)));
    const withMishits = [
      ...clean,
      ...series(current, [60, 62], { review: { ...fullMishit } }),
    ];
    const a = scores([current], clean).distancePotential;
    const b = scores([current], withMishits).distancePotential;
    expect(b.value).toBe(a.value);
  });

  it('marks consistency insufficient below 4 measured carries', () => {
    const shots = series(current, [120, 121, null]);
    const result = scores([current], shots);
    expect(result.consistency.value).toBeNull();
    expect(result.consistency.sufficient).toBe(false);
    expect(result.consistency.note).toContain('Needs 4');
  });

  it('reports a smaller independent sample size for the from-centre aux', () => {
    // 8 launch-direction readings but only 2 from-centre readings: the aux
    // must carry n = 2, not the row's n = 8.
    const shots = [
      ...series(current, Array.from({ length: 6 }, () => 120), {
        measurements: { launchDirection: 2 },
      }),
      ...series(current, [120, 121], {
        measurements: { launchDirection: 2, fromCentre: 5 },
      }),
    ];
    const result = scores([current], shots);
    expect(result.directionalControl.n).toBe(8);
    expect(result.directionalControl.aux?.[0]?.value).toBe(5);
    expect(result.directionalControl.aux?.[0]?.n).toBe(2);
  });

  it('scores directional control from launch direction, not from curvature alone', () => {
    const shots = series(current, Array.from({ length: 8 }, () => 120), {
      measurements: { launchDirection: 2, fromCentre: 5, curve: 8 },
    });
    const result = scores([current], shots);
    expect(result.directionalControl.sufficient).toBe(true);
    expect(result.directionalControl.value).toBe(2);
    expect(result.directionalControl.unit).toBe('deg');
    expect(result.directionalControl.aux?.[0]?.value).toBe(5);
    // The aux measurement carries its own independent sample size.
    expect(result.directionalControl.aux?.[0]?.n).toBe(8);

    // Curve present but no launch direction: not sufficient, never inferred.
    const curveOnly = series(current, Array.from({ length: 8 }, () => 120), {
      measurements: { launchDirection: null, curve: 8 },
    });
    const noDirection = scores([current], curveOnly);
    expect(noDirection.directionalControl.sufficient).toBe(false);
    expect(noDirection.directionalControl.value).toBeNull();
    expect(noDirection.directionalControl.note).toContain('Not measured');
  });

  it('computes reliability from manual and automatic contact assessments and reports the unassessed count', () => {
    // 10 manually reviewed full swings, 2 mishits; plus 4 unassessed.
    const shots = [
      ...series(current, Array.from({ length: 8 }, () => 120)),
      ...series(current, [70, 72], { review: { ...fullMishit } }),
      ...series(current, Array.from({ length: 4 }, () => 119), {
        review: { intent: 'full', contact: 'uncertain' },
      }),
    ];
    const result = scores([current], shots);
    expect(result.reliability.sufficient).toBe(true);
    expect(result.reliability.value).toBeCloseTo(2 / 10);
    expect(result.reliability.unit).toBe('share');
    expect(result.reliability.n).toBe(10);
    expect(result.reliability.note).toContain('4 of 14');
  });

  it('withholds the reliability value below the minimum assessed sample', () => {
    // Three perfect swings must not surface as a numerical 0 (perfect) rate.
    const shots = series(current, [120, 121, 122]);
    const result = scores([current], shots);
    expect(result.reliability.value).toBeNull();
    expect(result.reliability.sufficient).toBe(false);
    expect(result.reliability.note).toContain('Needs 10');
  });

  it('withholds the directional value below the minimum sample', () => {
    const shots = series(current, [120, 121, 122], {
      measurements: { launchDirection: 1 },
    });
    const result = scores([current], shots);
    expect(result.directionalControl.value).toBeNull();
    expect(result.directionalControl.sufficient).toBe(false);
    expect(result.directionalControl.note).toContain('Needs 4');
  });

  it('follows the analysis window like the profiles do', () => {
    const oldShots = series(older, Array.from({ length: 12 }, () => 100));
    const newShots = series(current, Array.from({ length: 12 }, () => 130));
    const all = scores([older, current], [...oldShots, ...newShots]);
    expect(all.distancePotential.value).toBeGreaterThanOrEqual(100);
    const recent = categoryScores(
      { ...emptyDataset, sessions: [older, current], shots: [...oldShots, ...newShots] },
      'premium-flat',
      query({ mode: 'recent', today: current.date }),
      '7i',
    );
    expect(recent.distancePotential.value).toBeGreaterThanOrEqual(130);
  });
});
