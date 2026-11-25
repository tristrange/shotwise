import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_MODEL_VERSION,
  BENCHMARK_SOURCES,
  attributionFor,
  benchmarkHygieneProblems,
  benchmarkReferencesForClub,
  compareWithReference,
  normalizeBenchmarkClub,
  referenceBasisCompatible,
  validateUserReferenceValue,
} from './benchmarks';
import {
  userReferenceValueSchema,
  type UserReferenceValueRecord,
} from './model';

describe('normalizeBenchmarkClub', () => {
  it('maps driver aliases to the registry key', () => {
    expect(normalizeBenchmarkClub('D')).toBe('driver');
    expect(normalizeBenchmarkClub('DR')).toBe('driver');
    expect(normalizeBenchmarkClub('1w')).toBe('driver');
    expect(normalizeBenchmarkClub('Driver')).toBe('driver');
  });

  it('normalizes irons, woods, hybrids and wedges', () => {
    expect(normalizeBenchmarkClub('7i')).toBe('7i');
    expect(normalizeBenchmarkClub('7I')).toBe('7i');
    expect(normalizeBenchmarkClub('3-wood')).toBe('3-wood');
    expect(normalizeBenchmarkClub('hybrid')).toBe('hybrid');
    expect(normalizeBenchmarkClub('PW')).toBe('pw');
  });

  it('maps recorded numbered wood and hybrid labels to registry keys', () => {
    expect(normalizeBenchmarkClub('3w')).toBe('3-wood');
    expect(normalizeBenchmarkClub('5W')).toBe('5-wood');
    expect(normalizeBenchmarkClub('4h')).toBe('hybrid');
    expect(normalizeBenchmarkClub('4H')).toBe('hybrid');
    expect(normalizeBenchmarkClub('hy')).toBe('hybrid');
  });
});

describe('benchmark registry hygiene', () => {
  it('has no hygiene problems', () => {
    expect(benchmarkHygieneProblems()).toEqual([]);
  });

  it('keeps every entry link-only — no embedded datasets without a license', () => {
    expect(BENCHMARK_SOURCES.length).toBeGreaterThan(0);
    for (const source of BENCHMARK_SOURCES) {
      expect(source.license).toBe('link-only');
      expect(source.licenseEvidence).toBeUndefined();
    }
  });

  it('flags embedded-with-license entries that lack license evidence', () => {
    const problems = benchmarkHygieneProblems([
      {
        id: 'x',
        name: 'X',
        publisher: 'X',
        url: 'https://example.com/x',
        publicationDate: null,
        license: 'embedded-with-license',
        metric: 'carry',
        venue: 'range',
        audience: 'amateur',
        population: 'n/a',
        clubs: ['driver'],
        retrievedAt: '2026-11-25',
      },
    ]);
    expect(problems).toContain(
      'x: embedded-with-license requires licenseEvidence',
    );
  });

  it('uses https URLs and unique ids', () => {
    const ids = BENCHMARK_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of BENCHMARK_SOURCES) {
      expect(source.url.startsWith('https://')).toBe(true);
    }
  });
});

describe('attributionFor', () => {
  it('includes name, publisher, metric, venue, population and license status', () => {
    const found = BENCHMARK_SOURCES.find((s) => s.id === 'arccos-ddr-2026');
    expect(found).toBeDefined();
    const source = found!;
    const text = attributionFor(source);
    expect(text).toContain(source.name);
    expect(text).toContain(source.publisher);
    expect(text).toContain(source.population);
    expect(text).toContain('link-only');
    expect(text).toContain('total distance');
  });
});

describe('benchmarkReferencesForClub', () => {
  it('returns the amateur on-course driver reference for D/DR/1w', () => {
    for (const label of ['D', 'DR', '1w']) {
      const refs = benchmarkReferencesForClub(label);
      expect(refs.length).toBeGreaterThan(0);
      const arccos = refs.find((r) => r.sourceId === 'arccos-ddr-2026');
      expect(arccos).toBeDefined();
      // On-course totals must carry the comparison caveat, never presented as range carry.
      expect(arccos!.caveat).toContain('total');
      expect(arccos!.audience).toBe('amateur');
    }
  });

  it('flags professional references so the UI can badge them', () => {
    const refs = benchmarkReferencesForClub('driver');
    const pro = refs.filter((r) => r.audience === 'professional');
    expect(pro.length).toBeGreaterThan(0);
    for (const ref of pro) {
      expect(['trackman-tour-averages', 'pgatour-stats-driving']).toContain(
        ref.sourceId,
      );
    }
  });

  it('returns no references for unknown club labels', () => {
    expect(benchmarkReferencesForClub('unknown')).toEqual([]);
  });

  it('never returns references for range-ball bases', () => {
    // No external source measures limited-flight range balls.
    expect(benchmarkReferencesForClub('driver', 'range')).toEqual([]);
    expect(benchmarkReferencesForClub('7i', 'range-flat')).toEqual([]);
    expect(
      benchmarkReferencesForClub('driver', 'premium').length,
    ).toBeGreaterThan(0);
    expect(
      benchmarkReferencesForClub('driver', 'premium-flat').length,
    ).toBeGreaterThan(0);
  });

  it('returns references for iron labels covered by the registry', () => {
    const refs = benchmarkReferencesForClub('7i');
    expect(refs.some((r) => r.sourceId === 'trackman-tour-averages')).toBe(true);
  });

  it('returns references for recorded wood and hybrid labels', () => {
    for (const label of ['3w', '5w']) {
      const refs = benchmarkReferencesForClub(label);
      expect(refs.some((r) => r.sourceId === 'trackman-tour-averages')).toBe(true);
      expect(refs.every((r) => r.club.endsWith('-wood'))).toBe(true);
    }
    const hybridRefs = benchmarkReferencesForClub('4h');
    expect(hybridRefs.some((r) => r.sourceId === 'trackman-tour-averages')).toBe(true);
    expect(hybridRefs.every((r) => r.club === 'hybrid')).toBe(true);
  });
});

describe('validateUserReferenceValue', () => {
  it('accepts a valid carry reference', () => {
    expect(
      validateUserReferenceValue({ club: '7i', metric: 'carry', valueM: 142 }),
    ).toBeNull();
  });

  it('rejects unknown clubs, non-positive and implausible values', () => {
    expect(
      validateUserReferenceValue({ club: 'unknown', metric: 'carry', valueM: 100 }),
    ).toBe('Club label is unknown');
    expect(
      validateUserReferenceValue({ club: '7i', metric: 'carry', valueM: 0 }),
    ).toBe('Reference must be a positive distance in metres');
    expect(
      validateUserReferenceValue({ club: '7i', metric: 'total', valueM: 600 }),
    ).toBe('Reference looks implausible (> 500 m)');
  });

  it('rejects unknown metrics', () => {
    expect(
      validateUserReferenceValue({
        club: '7i',
        metric: 'launch' as never,
        valueM: 100,
      }),
    ).toBe('Unknown metric');
  });
});

describe('reference comparisons (C2)', () => {
  const ref = (overrides: Partial<UserReferenceValueRecord>): UserReferenceValueRecord =>
    userReferenceValueSchema.parse({
      id: crypto.randomUUID(),
      club: '7i',
      metric: 'carry',
      valueM: 150,
      note: null,
      revision: 0,
      ...overrides,
    });

  it('compares typical and strong values with delta and percent on a matching basis', () => {
    const c = compareWithReference(
      ref({ basis: 'premium' }),
      { typical: 140, strong: 158 },
      'premium-flat',
    );
    expect(c.compatible).toBe(true);
    expect(c.typical).toEqual({ value: 140, delta: -10, pct: 140 / 150 });
    expect(c.strong).toEqual({ value: 158, delta: 8, pct: 158 / 150 });
  });

  it('matches range references with range bases only', () => {
    expect(referenceBasisCompatible('range', 'range-flat')).toBe(true);
    expect(referenceBasisCompatible('range', 'range')).toBe(true);
    expect(referenceBasisCompatible('range', 'premium-flat')).toBe(false);
    expect(referenceBasisCompatible('premium', 'premium')).toBe(true);
    expect(referenceBasisCompatible('premium', 'range-flat')).toBe(false);
  });

  it('keeps flat and unadjusted bases distinct', () => {
    expect(referenceBasisCompatible('range-flat', 'range-flat')).toBe(true);
    expect(referenceBasisCompatible('range-flat', 'range')).toBe(false);
    expect(referenceBasisCompatible('premium-flat', 'premium-flat')).toBe(true);
    expect(referenceBasisCompatible('premium-flat', 'premium')).toBe(false);
    // Family-level references match either member of their family.
    expect(referenceBasisCompatible('range', 'range-flat')).toBe(true);
    expect(referenceBasisCompatible('premium', 'premium-flat')).toBe(true);
  });

  it('never silently compares an unknown-basis (legacy) reference', () => {
    const c = compareWithReference(
      ref({ basis: 'unknown' }),
      { typical: 140, strong: 158 },
      'premium-flat',
    );
    expect(c.compatible).toBe(false);
    expect(c.reason).toMatch(/unknown/i);
    expect(c.typical.value).toBeNull();
    expect(c.strong.value).toBeNull();
  });

  it('never silently compares a range reference on a premium view', () => {
    const c = compareWithReference(
      ref({ basis: 'range' }),
      { typical: 140, strong: 158 },
      'premium-flat',
    );
    expect(c.compatible).toBe(false);
    expect(c.reason).toMatch(/range/);
  });

  it('handles missing measured values without inventing numbers', () => {
    const c = compareWithReference(
      ref({ basis: 'premium' }),
      { typical: null, strong: null },
      'premium-flat',
    );
    expect(c.compatible).toBe(true);
    expect(c.typical).toEqual({ value: null, delta: null, pct: null });
  });
});

describe('reference value metadata (C1)', () => {
  it('defaults basis/source on legacy rows so they never parse as a guessed basis', () => {
    const legacy = userReferenceValueSchema.parse({
      id: crypto.randomUUID(),
      club: '7i',
      metric: 'carry',
      valueM: 142,
      note: null,
      revision: 0,
    });
    expect(legacy.basis).toBe('unknown');
    expect(legacy.source).toBe('manual');
  });

  it('keeps explicit basis and source', () => {
    const parsed = userReferenceValueSchema.parse({
      id: crypto.randomUUID(),
      club: '7i',
      metric: 'carry',
      valueM: 142,
      note: 'Fitting',
      basis: 'range',
      source: 'fitting',
      revision: 3,
    });
    expect(parsed.basis).toBe('range');
    expect(parsed.source).toBe('fitting');
    // The flat/unadjusted distinction is preserved, not collapsed to a family.
    expect(
      userReferenceValueSchema.parse({
        id: crypto.randomUUID(),
        club: '7i',
        metric: 'carry',
        valueM: 142,
        note: null,
        basis: 'premium-flat',
        source: 'chart',
        revision: 0,
      }).basis,
    ).toBe('premium-flat');
  });
});

describe('model version', () => {
  it('is pinned', () => {
    expect(BENCHMARK_MODEL_VERSION).toBe('benchmark-1');
  });
});
