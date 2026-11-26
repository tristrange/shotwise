import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bandX, DistributionPlot, type DistributionBand } from './DistributionPlot';
import { metricStats } from '../../domain/analytics';
import { makeShot } from '../../domain/fixtures';

// Vitest runs in the node environment, so render the plot to static markup
// with createElement (no JSX in .ts test files) and assert on the SVG output.
const render = (
  band: DistributionBand,
  {
    min = 100,
    max = 140,
    compare = null,
    stretch = false,
  }: { min?: number; max?: number; compare?: number | null; stretch?: boolean } = {},
) =>
  renderToStaticMarkup(
    h(DistributionPlot, { band, min, max, label: 'test band', compare, stretch }),
  );

const attr = (markup: string, tag: string, name: string) => {
  const match = markup.match(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`));
  return match?.[1] ?? null;
};

describe('DistributionPlot renders each band independently (review A3)', () => {
  it('keeps the approved eligibility unchanged: 4 carries give Q1/Q3/IQR but no P10/P90', () => {
    const shots = [120, 124, 128, 132].map((carry) =>
      makeShot({ measurements: { flatCarryPremium: carry } }),
    );
    const stats = metricStats(shots, 'flatCarryPremium');
    expect(stats.n).toBe(4);
    // Q1 = 123, Q3 = 129 → IQR 6; P10/P90 still need 10+ measured shots.
    expect(stats.iqr).toBe(6);
    expect(stats.median).toBe(126);
    expect(stats.p10).toBeNull();
    expect(stats.p90).toBeNull();
    expect(stats.p80).toBeNull();
  });

  it('renders the IQR band and median when only the IQR is eligible (4 carries, no P10–P90)', () => {
    // Review A3: the old outer gate hid the IQR for {120,124,128,132}.
    const markup = render({ p10: null, q1: 123, median: 126, q3: 129, p90: null });
    expect(markup).toMatch(/<rect[^>]*class="band-iqr"/);
    expect(markup).toMatch(/<line[^>]*class="median"/);
    // No outer band and no outer end labels, but the explicit note stays.
    expect(markup).not.toMatch(/class="band-p"/);
    expect(markup).toContain('P10–P90 needs 10+ measured shots');
    // The sr-only summary still names every stat, missing ones as "—".
    expect(markup).toContain('P10 —');
    expect(markup).toContain('first quartile 123m');
    expect(markup).toContain('third quartile 129m');
  });

  it('renders both bands and the P10/P90 labels when the outer band is eligible', () => {
    const markup = render({ p10: 110, q1: 120, median: 126, q3: 132, p90: 136 });
    expect(markup).toMatch(/<rect[^>]*class="band-p"/);
    expect(markup).toMatch(/<rect[^>]*class="band-iqr"/);
    expect(markup).toContain('>110</text>');
    expect(markup).toContain('>136</text>');
    expect(markup).not.toContain('P10–P90 needs 10+ measured shots');
  });

  it('draws coincident marks at the same true-scale coordinate (Q1 = P10, Q3 = P90)', () => {
    const markup = render({ p10: 120, q1: 120, median: 126, q3: 132, p90: 132 });
    const outer = markup.match(/<rect[^>]*class="band-p"[^>]*>/)?.[0] ?? '';
    const inner = markup.match(/<rect[^>]*class="band-iqr"[^>]*>/)?.[0] ?? '';
    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
    // Both bands start at the true scaled x of 120 and span to that of 132 —
    // no minimum pixel width, no shifted endpoint.
    expect(attr(outer, 'rect', 'x')).toBe(String(bandX(120, 100, 140)));
    expect(attr(inner, 'rect', 'x')).toBe(attr(outer, 'rect', 'x'));
    expect(attr(inner, 'rect', 'width')).toBe(attr(outer, 'rect', 'width'));
    expect(attr(outer, 'rect', 'width')).toBe(
      String(bandX(132, 100, 140) - bandX(120, 100, 140)),
    );
  });

  it('renders a zero-width IQR band as a tick at its true coordinate', () => {
    const markup = render({ p10: 120, q1: 126, median: 126, q3: 126, p90: 132 });
    expect(markup).not.toMatch(/<rect[^>]*class="band-iqr"/);
    const tick = markup.match(/<line[^>]*class="band-iqr band-tick"[^>]*>/)?.[0] ?? '';
    expect(tick).toBeTruthy();
    expect(attr(tick, 'line', 'x1')).toBe(String(bandX(126, 100, 140)));
  });

  it('renders the P80 comparison marker independently of the bands', () => {
    const markup = render(
      { p10: null, q1: null, median: 126, q3: null, p90: null },
      { compare: 130 },
    );
    const marker = markup.match(/<line[^>]*class="band-compare"[^>]*>/)?.[0] ?? '';
    expect(marker).toBeTruthy();
    expect(attr(marker, 'line', 'x1')).toBe(String(bandX(130, 100, 140)));
    // No band, but the median still renders — never hidden, never zero.
    expect(markup).toMatch(/<line[^>]*class="median"/);
  });

  it('draws no text at all in stretched rows (gapping chart)', () => {
    const markup = render(
      { p10: null, q1: 123, median: 126, q3: 129, p90: null },
      { stretch: true },
    );
    const svg = markup.match(/<svg[\s\S]*<\/svg>/)?.[0] ?? '';
    // The stretched SVG carries marks only — no distorted text; the
    // "needs 10+ shots" note stays available to screen readers via SrOnly.
    expect(svg).not.toContain('<text');
    expect(markup).toMatch(/<rect[^>]*class="band-iqr"/);
  });
});
