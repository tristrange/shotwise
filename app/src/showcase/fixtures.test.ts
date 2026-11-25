import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { clubRatings, weakestEvidence } from '../domain/ratings';
import { localToday } from '../domain/model';
import { syntheticDataset } from './fixtures';

const query = {
  mode: 'all' as const,
  intent: 'all' as const,
  contact: 'all' as const,
  hideLikelyMishits: false,
  today: localToday(),
};

describe('showcase synthetic fixtures', () => {
  const data = syntheticDataset();
  const ratings = () => new Map(clubRatings(data, query, data.userReferenceValues).map((r) => [r.club, r]));

  it('is deterministic across runs', () => {
    expect(clubRatings(syntheticDataset(), query, data.userReferenceValues)).toEqual(
      clubRatings(syntheticDataset(), query, data.userReferenceValues),
    );
  });

  it('covers full, early, provisional and missing rating states', () => {
    const byClub = ratings();
    // D / 7i: full 4/4 composite on well-supported evidence.
    for (const club of ['D', '7i']) {
      const r = byClub.get(club)!;
      expect(r.composite.value, club).not.toBeNull();
      expect(r.composite.provisional, club).toBe(false);
      expect(r.consistency.evidence, club).toBe('supported');
    }
    // 7i has seeded mishits, so reliability must be below 100.
    expect(byClub.get('7i')!.reliability.mishitShare).toBeGreaterThan(0);
    // 5i: 20 shots over 2 visits — full composite, weakest evidence early.
    const fiveIron = byClub.get('5i')!;
    expect(fiveIron.composite.value).not.toBeNull();
    expect(fiveIron.composite.provisional).toBe(false);
    expect(
      weakestEvidence(
        [fiveIron.distancePotential, fiveIron.consistency, fiveIron.directionalControl, fiveIron.reliability].map(
          (c) => c.evidence,
        ),
      ),
    ).toBe('early');
    // PW: no finishing-position data — direction withheld, provisional 3/4.
    const pw = byClub.get('PW')!;
    expect(pw.directionalControl.measurementBasis).toBe('launch');
    expect(pw.directionalControl.score).toBeNull();
    expect(pw.composite.provisional).toBe(true);
    expect(pw.composite.coverage).toBe(3);
    // 9i: 6 shots in one visit — no composite at all.
    const nineIron = byClub.get('9i')!;
    expect(nineIron.composite.value).toBeNull();
  });

  it('keeps the showcase route behind a build-time DEV guard in App.tsx', async () => {
    const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
    // The lazy showcase import must only exist when import.meta.env.DEV, so a
    // production build drops the module and its chunk entirely.
    expect(appSource).toMatch(/import\.meta\.env\.DEV\s*\?\s*lazy\(/);
    expect(appSource).toMatch(/import\.meta\.env\.DEV\s*&&\s*window\.location\.hash/);
  });
});
