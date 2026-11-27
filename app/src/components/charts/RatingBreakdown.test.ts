import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RatingBreakdown } from './RatingBreakdown';
import { ScoreBar } from './ScoreBar';
import { ScoreRing } from './ScoreRing';
import { scoreBand } from './scoreBand';
import { clubRating } from '../../domain/ratings';
import { makeSession, makeShot } from '../../domain/fixtures';
import { emptyDataset, type Dataset } from '../../domain/model';

// Vitest runs in the node environment, so render components to static markup
// with createElement (no JSX in .ts test files).
const renderBreakdown = (rating: Parameters<typeof RatingBreakdown>[0]['rating'], referenceHref?: string) =>
  renderToStaticMarkup(h(RatingBreakdown, { rating, referenceHref }));

const TODAY = '2026-11-25';
const query = {
  mode: 'recent' as const,
  today: TODAY,
  intent: 'all' as const,
  contact: 'all' as const,
};

/** `count` full-swing 7i shots in one session with carries around `base`. */
function clubDataset(count: number, opts: { fromCentre?: number[] | null; launchOnly?: boolean } = {}): Dataset {
  const data = structuredClone(emptyDataset);
  const session = makeSession({ date: TODAY });
  data.sessions.push(session);
  for (let i = 0; i < count; i++) {
    const carry = 140 + ((i * 7) % 11) - 5;
    const lat = opts.fromCentre === null ? null : (opts.fromCentre?.[i % (opts.fromCentre?.length || 1)] ?? 3);
    data.shots.push(
      makeShot({
        sessionId: session.id,
        rowIndex: i + 1,
        recordedClub: '7i',
        measurements: {
          flatCarryPremium: carry,
          flatCarryRange: null,
          // launchOnly: no lateral data but launch direction exists;
          // fromCentre === null (without launchOnly): no direction data at all.
          fromCentre: opts.launchOnly === true || opts.fromCentre === null ? null : lat,
          launchDirection: opts.fromCentre === null && opts.launchOnly !== true ? null : 2,
          curve: null,
        },
        review: { intent: 'full', contact: 'typical' },
      }),
    );
  }
  return data;
}

describe('RatingBreakdown withheld reasons (coverage audit)', () => {
  it('names the actual reason each category is withheld', () => {
    // 3 shots: every category under-sampled; no lateral data at all.
    const data = clubDataset(3, { fromCentre: null });
    const r = clubRating(data, query, '7i', [])!;
    expect(r.distancePotential.score).toBeNull();
    expect(r.consistency.score).toBeNull();
    expect(r.directionalControl.score).toBeNull();
    expect(r.reliability.score).toBeNull();
    const html = renderBreakdown(r, '#clubs/7i');
    expect(html).toContain('insufficient eligible carry measurements');
    expect(html).toContain('no direction measurements');
    expect(html).toContain('insufficient assessed full swings');
  });

  it('reports insufficient lateral measurements when lateral data is under-sampled or launch-only', () => {
    const few = clubRating(clubDataset(3, { fromCentre: [3, 4] }), query, '7i', [])!;
    expect(few.directionalControl.measurementBasis).toBe('lateral');
    expect(few.directionalControl.score).toBeNull();
    expect(renderBreakdown(few)).toContain('insufficient lateral finishing-position measurements');
    const launchOnly = clubRating(clubDataset(12, { launchOnly: true }), query, '7i', [])!;
    expect(launchOnly.directionalControl.measurementBasis).toBe('launch');
    expect(launchOnly.directionalControl.score).toBeNull();
    expect(renderBreakdown(launchOnly)).toContain('insufficient lateral finishing-position measurements');
  });

  it('attributes a withheld direction score to missing carries when lateral samples suffice', () => {
    // Range-only import: lateral finishing positions measured on 12 shots,
    // but no positive premium-flat carries to normalize them with.
    const data = structuredClone(emptyDataset);
    const session = makeSession({ date: TODAY });
    data.sessions.push(session);
    for (let i = 0; i < 12; i++) {
      data.shots.push(
        makeShot({
          sessionId: session.id,
          rowIndex: i + 1,
          recordedClub: '7i',
          measurements: {
            flatCarryPremium: null,
            flatCarryRange: 140 + i,
            fromCentre: 3,
            launchDirection: null,
            curve: null,
          },
          review: { intent: 'full', contact: 'typical' },
        }),
      );
    }
    const r = clubRating(data, query, '7i', [])!;
    expect(r.directionalControl.measurementBasis).toBe('lateral');
    expect(r.directionalControl.n).toBe(12);
    expect(r.directionalControl.score).toBeNull();
    const html = renderBreakdown(r);
    const dirRow =
      html.match(/rating-label">Direction<\/span>[\s\S]*?rating-sub">([\s\S]*?)<\/span>/)?.[1] ?? '';
    // The blocker is the carry denominator, not the lateral sample count.
    expect(dirRow).toContain('insufficient eligible carry measurements');
    expect(dirRow).not.toContain('insufficient lateral finishing-position measurements');
  });

  it('offers the personal-reference configuration when no compatible distance reference exists', () => {
    const r = clubRating(clubDataset(12), query, '7i', [])!;
    expect(r.distancePotential.p80).not.toBeNull();
    expect(r.distancePotential.reference).toBeNull();
    expect(r.distancePotential.score).toBeNull();
    const html = renderBreakdown(r, '#clubs/7i');
    expect(html).toContain('no compatible distance reference');
    expect(html).toContain('set a personal reference');
    expect(html).toContain('href="#clubs/7i"');
    // Without the href prop no link is rendered (e.g. contexts without routing).
    expect(renderBreakdown(r)).not.toContain('set a personal reference');
  });

  it('keeps rows to short reason labels; exact counts stay behind the contextual help', () => {
    const r = clubRating(clubDataset(3, { fromCentre: null }), query, '7i', [])!;
    const html = renderBreakdown(r);
    // Rows carry only the short reason labels — no sample-count prose.
    expect(html).not.toContain('of 10 needed');
    expect(html).not.toContain('3 shots');
    // The contextual help trigger that holds counts/evidence is present.
    expect(html).toContain('Sample sizes, evidence and uncertainty behind these scores');
  });
});

describe('score-band attributes on rating indicators', () => {
  it('tags the overall score and each bar with the shared band', () => {
    const r = clubRating(clubDataset(12), query, '7i', [])!;
    const html = renderBreakdown(r);
    const overall = html.match(/<p class="rating-overall" data-band="([^"]*)"/)?.[1];
    expect(overall).toBe(scoreBand(r.composite.value));
    const bars = [...html.matchAll(/class="ds-score-bar rating-row[^"]*" data-band="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(bars).toHaveLength(4);
    expect(bars[0]).toBe(scoreBand(r.distancePotential.score)); // withheld → none
    expect(bars[0]).toBe('none');
    expect(bars[1]).toBe(scoreBand(r.consistency.score));
  });

  it('a genuine zero is banded critical while a withheld score is none', () => {
    const zero = renderToStaticMarkup(h(ScoreBar, { label: 'Reliability', score: 0 }));
    expect(zero).toContain('data-band="critical"');
    expect(zero).toContain('>0</span>');
    const withheld = renderToStaticMarkup(h(ScoreBar, { label: 'Reliability', score: null }));
    expect(withheld).toContain('data-band="none"');
    expect(withheld).toContain('withheld');
    expect(withheld).toContain('>—</span>');
    const ringZero = renderToStaticMarkup(h(ScoreRing, { value: 0 }));
    expect(ringZero).toContain('data-band="critical"');
    expect(ringZero).toContain('>0</text>');
    const ringNone = renderToStaticMarkup(h(ScoreRing, { value: null }));
    expect(ringNone).toContain('data-band="none"');
    expect(ringNone).toContain('>—</text>');
  });

  it('keeps provisional/early outlines independent of the band attribute', () => {
    const html = renderToStaticMarkup(h(ScoreRing, { value: 72, provisional: true, early: true }));
    expect(html).toContain('data-band="mid"');
    expect(html).toContain('provisional');
    expect(html).toContain('early');
    expect(html).toContain('ring-outline early');
  });
});
