import { describe, expect, it } from 'vitest';
import { gapPairs, gappingView } from './gappingData';
import { emptyDataset, type Dataset, type Shot } from '../domain/model';
import { makeSession, makeShot } from '../domain/fixtures';
import type { AnalysisQuery } from '../domain/analytics';

const query: AnalysisQuery = {
  mode: 'all',
  today: '2026-11-16',
  intent: 'all',
  contact: 'all',
};

function dataset(): Dataset {
  const session = makeSession({ id: 'session-1', date: '2026-11-16' });
  const shots: Shot[] = [];
  // 6i: 12 shots at 135..146, 7i: 12 shots at 120..131, 9i: 1 shot at 60.
  for (let i = 0; i < 12; i++) {
    shots.push(
      makeShot({
        sessionId: session.id,
        recordedClub: '6i',
        rowIndex: i + 1,
        measurements: { flatCarryPremium: 135 + i },
        review: { intent: 'full', contact: 'typical' },
      }),
    );
    shots.push(
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: 20 + i,
        measurements: { flatCarryPremium: 120 + i },
        review: { intent: 'full', contact: 'typical' },
      }),
    );
  }
  shots.push(
    makeShot({
      sessionId: session.id,
      recordedClub: '9i',
      rowIndex: 99,
      measurements: { flatCarryPremium: 60 },
      review: { intent: 'full', contact: 'typical' },
    }),
  );
  return { ...emptyDataset, sessions: [session], shots };
}

describe('gappingView', () => {
  it('maps clubGaps rows to shared-scale distribution bands', () => {
    const { rows } = gappingView(dataset(), 'premium-flat', query);
    expect(rows.map((r) => r.club)).toEqual(['6i', '7i', '9i']);
    const six = rows[0]!;
    expect(six.band.median).toBe(140.5);
    expect(six.band.p10).toBe(136.1);
    expect(six.band.p90).toBe(144.9);
    expect(six.band.q1).toBe(137.75);
    expect(six.band.q3).toBe(143.25);
    expect(six.potential).toBe(143.8); // P80 of the 12 carries
    expect(six.reliable).toBe(true);
    expect(six.n).toBe(12);
    // The longest club has no gap; others carry the median difference.
    expect(rows[0]!.gap).toBeNull();
    expect(rows[1]!.gap).toBeCloseTo(140.5 - 125.5);
    // 9i has a single shot: band stats stay null, never zero.
    const nine = rows[2]!;
    expect(nine.reliable).toBe(false);
    expect(nine.band.p10).toBeNull();
    expect(nine.band.q1).toBeNull();
    expect(nine.band.p90).toBeNull();
    expect(nine.band.median).toBe(60);
    expect(nine.potential).toBeNull();
  });

  it('pads the shared scale outward over every band value and potential', () => {
    const { rows, scale } = gappingView(dataset(), 'premium-flat', query);
    const values = rows.flatMap((r) => [
      r.band.p10,
      r.band.q1,
      r.band.median,
      r.band.q3,
      r.band.p90,
      r.potential,
    ]);
    for (const v of values) {
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(scale.min);
      expect(v).toBeLessThanOrEqual(scale.max);
    }
    // Scale steps are whole 10s, shared by every row.
    expect(scale.min % 10).toBe(0);
    expect(scale.max % 10).toBe(0);
    expect(scale).toEqual({ min: 40, max: 160 });
  });

  it('returns an empty view when no shots are eligible', () => {
    const { rows, scale } = gappingView(emptyDataset, 'premium-flat', query);
    expect(rows).toEqual([]);
    expect(scale).toEqual({ min: 0, max: 1 });
  });
});

describe('gapPairs', () => {
  it('pairs each club with the one above and keeps the approved flags', () => {
    const { rows } = gappingView(dataset(), 'premium-flat', query);
    const pairs = gapPairs(rows);
    expect(pairs.map((p) => `${p.upper}->${p.lower}`)).toEqual([
      '6i->7i',
      '7i->9i',
    ]);
    expect(pairs[0]!.gap).toBeCloseTo(15);
    expect(pairs[0]!.bothReliable).toBe(true);
    expect(pairs[0]!.flag).toBeNull(); // 15 m is between the small and large thresholds
    // 9i is sample-limited, so no flag is derived even though the gap is large.
    expect(pairs[1]!.bothReliable).toBe(false);
    expect(pairs[1]!.flag).toBeNull();
  });

  it('flags small gaps with the domain thresholds, not new ones', () => {
    const session = makeSession({ id: 's', date: '2026-11-16' });
    const shots: Shot[] = [];
    for (let i = 0; i < 10; i++) {
      shots.push(
        makeShot({
          sessionId: session.id,
          recordedClub: '6i',
          rowIndex: i + 1,
          measurements: { flatCarryPremium: 130 + i },
          review: { intent: 'full', contact: 'typical' },
        }),
        makeShot({
          sessionId: session.id,
          recordedClub: '7i',
          rowIndex: 20 + i,
          measurements: { flatCarryPremium: 125 + i },
          review: { intent: 'full', contact: 'typical' },
        }),
      );
    }
    const { rows } = gappingView(
      { ...emptyDataset, sessions: [session], shots },
      'premium-flat',
      query,
    );
    const [pair] = gapPairs(rows);
    expect(pair!.gap).toBeCloseTo(5); // <= 10 m
    expect(pair!.flag).toBe('small');
  });
});
