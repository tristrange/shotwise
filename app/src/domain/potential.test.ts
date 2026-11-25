import { describe, expect, it } from 'vitest';
import {
  clubGaps,
  selectCohort,
  type AnalysisQuery,
} from './analytics';
import {
  clubStrongStrike,
  potentialCarry,
  strongStrikePopulation,
  MIN_POTENTIAL_SAMPLES,
} from './potential';
import { clubProfiles } from './clubProfiles';
import { makeSession, makeShot } from './fixtures';
import { emptyDataset, type Dataset, type Session, type Shot } from './model';
import { quantile } from './statistics';

const TODAY = '2026-11-16';
const query = {
  mode: 'all',
  today: TODAY,
  intent: 'all',
  contact: 'all',
} satisfies AnalysisQuery;

function dataset(sessions: Session[], shots: Shot[]): Dataset {
  return { ...emptyDataset, sessions, shots };
}

function run(
  session: Session,
  startRow: number,
  specs: {
    id: string;
    club?: string;
    carry?: number | null;
    speed?: number | null;
    review?: Partial<Shot['review']>;
  }[],
): Shot[] {
  return specs.map((spec, i) =>
    makeShot({
      id: spec.id,
      sessionId: session.id,
      rowIndex: startRow + i,
      recordedClub: spec.club ?? '7i',
      measurements: {
        flatCarryPremium: spec.carry ?? 150,
        speedPremium: spec.speed ?? 200,
      },
      review: spec.review,
    }),
  );
}

describe('strong-strike population (ADR-0002)', () => {
  const early = makeSession({ id: 'early', date: '2026-11-01' });
  const late = makeSession({ id: 'late', date: TODAY });
  const archived = makeSession({ id: 'arch', date: '2026-11-02', archived: true });

  const shots = [
    ...run(
      early,
      1,
      Array.from({ length: 12 }, (_, i) => ({ id: `h-${i}` })),
    ),
    ...run(early, 20, [
      { id: 'sw-8i-0', club: '8i', carry: 140, speed: 190 },
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `sw-8i-${i + 1}`,
        club: '8i',
        carry: 140,
        speed: 190,
      })),
      { id: 'sw-9i-0', club: '9i', carry: 120, speed: 170 },
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `sw-9i-${i + 1}`,
        club: '9i',
        carry: 120,
        speed: 170,
      })),
    ]),
    ...run(late, 1, [
      { id: 'normal', carry: 150, speed: 200 },
      { id: 'manual-mishit', carry: 50, speed: 80, review: { contact: 'mishit' } },
      { id: 'auto-mishit', carry: 50, speed: 80 },
      { id: 'manual-partial', carry: 60, speed: 200, review: { intent: 'partial' } },
      { id: 'excluded', carry: 150, speed: 200, review: { exclusion: { kind: 'excluded', reason: 'net' } } },
      // 9i-labelled but measuring like 8i: suspected wrong club.
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `wrong-${i}`,
        club: '9i',
        carry: 140,
        speed: 190,
      })),
      { id: 'unknown', club: '?', carry: 999, speed: 250 },
    ]),
    ...run(archived, 1, [{ id: 'archived-shot', carry: 150, speed: 200 }]),
  ];
  const data = dataset([early, late, archived], shots);

  it('keeps only resolved full swings with non-mishit contact under known, non-suspected clubs', () => {
    const population = strongStrikePopulation(data, 'premium-flat', query);
    const ids = population.map((s) => s.id);
    expect(ids).toContain('normal');
    expect(ids).toContain('h-0');
    expect(ids).not.toContain('manual-mishit');
    expect(ids).not.toContain('auto-mishit'); // automatic layer excludes it too
    expect(ids).not.toContain('manual-partial');
    expect(ids).not.toContain('excluded');
    expect(ids).not.toContain('archived-shot');
    expect(ids).not.toContain('wrong-3'); // suspected wrong club
    expect(ids).not.toContain('unknown'); // no inference possible, unknown club
    // 12 7i history + 12 8i + 12 9i profile shots + the normal late shot.
    expect(population).toHaveLength(37);
  });

  it('computes P80 per club with sample-size marking and contributing shot ids', () => {
    const rows = clubStrongStrike(data, 'premium-flat', query);
    const byClub = new Map(rows.map((r) => [r.club, r]));
    const seven = byClub.get('7i')!;
    expect(seven.n).toBe(13);
    expect(seven.median).toBe(150);
    // All 13 values are 150 -> P80 is 150.
    expect(seven.potential).toBe(150);
    expect(seven.reliable).toBe(true);
    expect(seven.shotIds).toHaveLength(13);
    expect(seven.ruleVersion).toBe('strong-strike-1');
    // The 8i profile shots are all 140 -> potential 140.
    expect(byClub.get('8i')?.potential).toBe(140);
    // The suspected 9i run never contributes a 9i potential.
    expect(byClub.get('9i')?.potential).toBe(120);
    expect(byClub.get('9i')?.shotIds).not.toContain('wrong-3');
  });

  it('returns null potential below the minimum sample size', () => {
    expect(potentialCarry([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    expect(potentialCarry(Array.from({ length: MIN_POTENTIAL_SAMPLES }, () => 100))).toBe(100);
  });

  it('shares the exact same P80 with the gapping view', () => {
    const gaps = new Map(clubGaps(data, 'premium-flat', query).map((r) => [r.club, r]));
    for (const row of clubStrongStrike(data, 'premium-flat', query)) {
      expect(gaps.get(row.club)?.potential).toBe(row.potential);
    }
  });

  it('keeps gapping P80 invariant across performance modes', () => {
    const session = makeSession({ date: TODAY });
    // 50 eligible carries 101..150 m: full-cohort P80 is ~140.2 m; P80 of the
    // strong-filtered subset would be higher (~148 m) and must not be reported.
    const shots = run(
      session,
      1,
      Array.from({ length: 50 }, (_, i) => ({
        id: `s${i}`,
        carry: 101 + i,
        speed: 200,
      })),
    );
    const ds = dataset([session], shots);
    const expected = quantile(
      Array.from({ length: 50 }, (_, i) => 101 + i),
      0.8,
    );
    for (const contact of ['all', 'typical', 'strong'] as const) {
      const row = clubGaps(ds, 'premium-flat', { ...query, contact }).find(
        (r) => r.club === '7i',
      );
      expect(row?.potential).toBeCloseTo(expected!, 5);
    }
  });
});

describe('strong-strike estimator investigation (roadmap §6.2)', () => {
  // Three deterministic sessions of the same club: a consistent 150 m club
  // with normal variation, plus one wild 999 m reading in the last session.
  const sessions = ['2026-11-01', '2026-11-08', '2026-11-16'].map((date, i) =>
    makeSession({ id: `s-${i}`, date }),
  );
  const base = [142, 145, 147, 148, 149, 150, 151, 152, 153, 155, 157, 160];
  const shots: Shot[] = sessions.flatMap((session, i) =>
    run(
      session,
      1,
      base.map((carry, j) => ({
        id: `${session.id}-${j}`,
        club: '7i',
        carry: i === 2 && j === 11 ? 999 : carry,
        speed: 200,
      })),
    ),
  );
  const data = dataset(sessions, shots);

  const estimators = {
    max: (values: number[]) => Math.max(...values),
    p75: (values: number[]) => quantile(values, 0.75)!,
    p80: (values: number[]) => quantile(values, 0.8)!,
    upperQuartileMean: (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const top = sorted.slice(Math.ceil(sorted.length * 0.75));
      return top.reduce((a, b) => a + b, 0) / top.length;
    },
  } as const;
  type EstimateName = keyof typeof estimators;
  type Estimates = Record<EstimateName, number>;

  function perSessionEstimates(withOutlier: boolean): Estimates[] {
    return sessions.map((session) => {
      const values = shots
        .filter((s) => s.sessionId === session.id)
        .flatMap((s) =>
          withOutlier || s.measurements.flatCarryPremium !== 999
            ? [s.measurements.flatCarryPremium ?? 0]
            : [],
        );
      return {
        max: estimators.max(values),
        p75: estimators.p75(values),
        p80: estimators.p80(values),
        upperQuartileMean: estimators.upperQuartileMean(values),
      };
    });
  }

  it('P80 is far more stable than the maximum and is not dominated by one outlier', () => {
    const clean = perSessionEstimates(false);
    const withOutlier = perSessionEstimates(true);
    const names = Object.keys(estimators) as EstimateName[];
    const spread = (estimates: Estimates[]): Estimates =>
      Object.fromEntries(
        names.map((name) => [
          name,
          Math.max(...estimates.map((e) => e[name])) -
            Math.min(...estimates.map((e) => e[name])),
        ]),
      ) as Estimates;
    const cleanSpread = spread(clean);
    const outlierShift = Object.fromEntries(
      names.map((name) => [name, withOutlier[2]![name] - clean[2]![name]]),
    ) as Estimates;
    // Across sessions the estimates barely move for every robust estimator.
    expect(cleanSpread.p80).toBeLessThanOrEqual(2);
    expect(cleanSpread.p75).toBeLessThanOrEqual(2);
    // A single wild reading devastates the maximum but barely moves P80.
    expect(outlierShift.max).toBeGreaterThan(800);
    expect(outlierShift.p80).toBeLessThanOrEqual(8);
    expect(outlierShift.p80).toBeLessThan(outlierShift.upperQuartileMean);
    // P80 sits above the median and below the max on clean data.
    const pooled = shots.flatMap((s) => [s.measurements.flatCarryPremium ?? 0]);
    const p80 = quantile(pooled, 0.8)!;
    expect(p80).toBeGreaterThan(quantile(pooled, 0.5)!);
    expect(p80).toBeLessThan(Math.max(...pooled));
  });

  it('clubStrongStrike uses P80 over the pooled cohort, not a session maximum', () => {
    const rows = clubStrongStrike(data, 'premium-flat', query);
    const seven = rows.find((r) => r.club === '7i')!;
    const values = shots.flatMap((s) => [s.measurements.flatCarryPremium ?? 0]);
    expect(seven.potential).toBe(quantile(values, 0.8));
    expect(seven.potential).toBeLessThan(999);
    expect(seven.n).toBe(36);
  });
});

describe('strong performance mode in selectCohort (roadmap §6.1)', () => {
  const session = makeSession({ id: 's', date: TODAY });
  // 20 shots of 7i with carries 100..119, plus an automatic mishit and a
  // small 8i group below the minimum sample.
  const shots: Shot[] = [
    ...Array.from({ length: 20 }, (_, i) =>
      makeShot({
        id: `s-7i-${i}`,
        sessionId: session.id,
        rowIndex: i + 1,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 100 + i, speedPremium: 200 },
      }),
    ),
    makeShot({
      id: 's-mishit',
      sessionId: session.id,
      rowIndex: 21,
      recordedClub: '7i',
      measurements: { flatCarryPremium: 40, speedPremium: 70 },
    }),
    ...Array.from({ length: 5 }, (_, i) =>
      makeShot({
        id: `s-8i-${i}`,
        sessionId: session.id,
        rowIndex: 30 + i,
        recordedClub: '8i',
        measurements: { flatCarryPremium: 140, speedPremium: 190 },
      }),
    ),
  ];
  const data = dataset([session], shots);
  const base = { mode: 'all', today: TODAY, intent: 'all' } as const;

  it('keeps only shots at or above the club P80, excludes mishits and thin clubs', () => {
    const all = selectCohort(shots, [session], { ...base, contact: 'all' });
    expect(all).toHaveLength(26);
    const typical = selectCohort(shots, [session], { ...base, contact: 'typical' });
    expect(typical.map((s) => s.id)).not.toContain('s-mishit');
    // Only shots the automatic layer could assess (>= 10 earlier 7i shots)
    // resolve to typical; the rest stay uncertain and out of Typical mode.
    expect(typical).toHaveLength(10);
    const strong = selectCohort(shots, [session], { ...base, contact: 'strong' });
    // P80 of the 20 typical carries (100..119) is 115.2 -> carries 116..119.
    expect(strong.map((s) => s.id).sort()).toEqual([
      's-7i-16',
      's-7i-17',
      's-7i-18',
      's-7i-19',
    ]);
    // The 8i group has no P80 threshold (n < 10) and drops out.
    expect(strong.every((s) => s.recordedClub === '7i')).toBe(true);
  });

  it('matches the strong-strike population used for distance potential', () => {
    const strong = selectCohort(shots, [session], { ...base, contact: 'strong' });
    const population = strongStrikePopulation(data, 'premium-flat', {
      ...base,
      contact: 'all',
    });
    const threshold = potentialCarry(
      population
        .filter((s) => s.recordedClub === '7i')
        .map((s) => s.measurements.flatCarryPremium ?? 0),
    );
    expect(threshold).toBe(115.2);
    expect(strong).toHaveLength(4);
  });

  it('computes strong-strike thresholds within a scoped visit, not across all history', () => {
    const older = makeSession({ id: 'older', date: '2026-11-01' });
    // An older visit with much longer carries must not raise the threshold
    // for the scoped visit.
    const olderShots = Array.from({ length: 20 }, (_, i) =>
      makeShot({
        id: `old-${i}`,
        sessionId: older.id,
        rowIndex: i + 1,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 190 + i, speedPremium: 230 },
      }),
    );
    const scoped = selectCohort([...olderShots, ...shots], [older, session], {
      ...base,
      contact: 'strong',
      scopeSessionId: session.id,
    });
    // Threshold is P80 of the scoped visit (100..119 -> 115.2), not ~206.
    expect(scoped.map((s) => s.id).sort()).toEqual([
      's-7i-16',
      's-7i-17',
      's-7i-18',
      's-7i-19',
    ]);
    // Without the scope, the same query is dominated by the older visit.
    const unscoped = selectCohort([...olderShots, ...shots], [older, session], {
      ...base,
      contact: 'strong',
    });
    expect(unscoped.every((s) => s.sessionId === 'older')).toBe(true);
  });

  it('keeps club-profile reliability on the broader cohort in strong mode', () => {
    const profiles = clubProfiles(data, 'premium-flat', {
      ...base,
      contact: 'strong',
    });
    const seven = profiles.find((p) => p.club === '7i')!;
    // Spread/lower tail/coverage use the full population including the
    // mishit (21 measured carries), not the 4 strong strikes.
    expect(seven.recent.spread.n).toBe(21);
    expect(seven.recent.lowerTail.n).toBe(21);
    expect(seven.recent.contact.total).toBe(21);
    // The typical (performance) metric follows the strong filter.
    expect(seven.recent.typical.n).toBeLessThanOrEqual(4);
    // Distance potential stays on the broader population: P80 of 100..119.
    expect(seven.recent.potential.value).toBe(115.2);
    expect(seven.recent.potential.n).toBe(20);
    expect(seven.recent.potential.reliable).toBe(true);
  });

  it('treats a zero carry as missing in every P80 consumer, not just the profile', () => {
    // Nine positive reviewed full/typical carries plus one zero carry: the
    // club must read as 9 measured everywhere — potential withheld, strong
    // mode disabled — instead of some screens counting the zero as a distance.
    const shots: Shot[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeShot({
          id: `ok-${i}`,
          sessionId: session.id,
          rowIndex: i + 1,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 120 + i, speedPremium: 200 },
          review: { intent: 'full', contact: 'typical' },
        }),
      ),
      makeShot({
        id: 'zero',
        sessionId: session.id,
        rowIndex: 20,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 0, speedPremium: 200 },
        review: { intent: 'full', contact: 'typical' },
      }),
    ];
    const data2 = dataset([session], shots);
    const strong = selectCohort(shots, [session], { ...base, contact: 'strong' });
    expect(strong).toHaveLength(0); // below the 10-measured minimum
    const gap = clubGaps(data2, 'premium-flat', { ...base, contact: 'all' }).find(
      (r) => r.club === '7i',
    )!;
    expect(gap.n).toBe(9);
    expect(gap.reliable).toBe(false);
    expect(gap.potential).toBeNull();
  });

  it('counts missing and zero carries over the pre-filter strong-strike population', () => {
    const shots: Shot[] = [
      ...Array.from({ length: 12 }, (_, i) =>
        makeShot({
          id: `ok-${i}`,
          sessionId: session.id,
          rowIndex: i + 1,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 120, speedPremium: 200 },
        }),
      ),
      // Full swings with failed/placeholder carry: missing, not distances.
      makeShot({
        id: 'null-carry',
        sessionId: session.id,
        rowIndex: 20,
        recordedClub: '7i',
        measurements: { flatCarryPremium: null, speedPremium: 200 },
      }),
      makeShot({
        id: 'zero-carry',
        sessionId: session.id,
        rowIndex: 21,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 0, speedPremium: 200 },
      }),
    ];
    const rows = clubStrongStrike(
      dataset([session], shots),
      'premium-flat',
      { ...base, contact: 'all' },
    );
    const seven = rows.find((r) => r.club === '7i')!;
    expect(seven.n).toBe(12);
    expect(seven.missing).toBe(2);
    // The zero carry must not leak into the P80 either.
    expect(seven.potential).toBe(120);
  });
});
