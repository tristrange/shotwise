import { describe, expect, it } from 'vitest';
import { clubProfileViews } from './clubProfileData';
import { emptyDataset, type Dataset, type Shot } from '../domain/model';
import { makeSession, makeShot } from '../domain/fixtures';

function dataset(): Dataset {
  const session = makeSession({ id: 'session-1', date: '2026-11-16' });
  const shots: Shot[] = [];
  // 12 typical full swings around 150–152 m.
  for (let i = 0; i < 12; i++) {
    shots.push(
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: i + 1,
        measurements: { flatCarryPremium: 150 + (i % 3) },
        review: { intent: 'full', contact: 'typical' },
      }),
    );
  }
  // 8 confirmed mishits at 90 m.
  for (let i = 0; i < 8; i++) {
    shots.push(
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: 13 + i,
        measurements: { flatCarryPremium: 90 },
        review: { intent: 'full', contact: 'mishit' },
      }),
    );
  }
  return { ...emptyDataset, sessions: [session], shots };
}

describe('clubProfileViews measurement coverage', () => {
  it('counts measured carries within the selected cohort, never a broader one', () => {
    const data = dataset();
    const base = {
      mode: 'all',
      intent: 'all',
      contact: 'all',
      hideLikelyMishits: false,
    } as const;
    const of = (views: ReturnType<typeof clubProfileViews>) =>
      views.find((v) => v.profile.club === '7i')!;

    const all = of(clubProfileViews(data, 'premium-flat', base));
    expect(all.total).toBe(20);
    expect(all.carryMeasured).toEqual({ n: 20, missing: 0 });

    // Strong-strike mode narrows the selected cohort below the P80 threshold:
    // the coverage numerator must shrink with it, never exceed the denominator.
    const strong = of(
      clubProfileViews(data, 'premium-flat', { ...base, contact: 'strong' }),
    );
    expect(strong.total).toBeLessThan(all.total);
    expect(strong.carryMeasured.n).toBeLessThanOrEqual(strong.total);
    expect(strong.carryMeasured.missing).toBe(strong.total - strong.carryMeasured.n);

    // Same invariant with the likely-mishit filter on.
    const hidden = of(
      clubProfileViews(data, 'premium-flat', { ...base, hideLikelyMishits: true }),
    );
    expect(hidden.total).toBeLessThan(all.total);
    expect(hidden.carryMeasured.n).toBeLessThanOrEqual(hidden.total);
    expect(hidden.carryMeasured.missing).toBe(hidden.total - hidden.carryMeasured.n);

    // The distribution band still comes from the broader reliability cohort,
    // so it is unaffected by the selected-cohort narrowing.
    expect(strong.band.median).not.toBeNull();
    expect(strong.band.median).toBe(all.band.median);
  });
});
