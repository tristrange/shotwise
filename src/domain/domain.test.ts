import { describe, expect, it } from 'vitest';
import { parseCsv, suggestDate, toBase64, fromBase64 } from './csv';
import { summarize, quantile, selectCohort, clubFlags, reviewCoverage } from './analytics';
import { makeShot, makeSession, csvFixture } from './fixtures';

describe('lossless CSV boundary', () => {
  it('preserves bytes, extra cells, row order, duplicate source numbers, zero and signed metrics', async () => {
    const text = '\ufeff' + csvFixture([
      { 'Shot #': '7', Club: 'PW', 'Launch Direction': '5°L', Curve: '3R', 'Apex (m)': '0', Comment: 'a, b' },
      { 'Shot #': '7', Club: '?', 'Launch Direction': '--', 'Ball Speed (kph)': 'bad' },
    ]).replaceAll('\n', '\r\n');
    const bytes = new TextEncoder().encode(text);
    const parsed = await parseCsv(bytes);
    expect(fromBase64(parsed.originalBase64)).toEqual(bytes);
    expect(parsed.shots.map(s => s.rowIndex)).toEqual([1, 2]);
    expect(parsed.shots.map(s => s.sourceNumber)).toEqual(['7', '7']);
    expect(parsed.shots[0]?.raw.Comment).toBe('a, b');
    expect(parsed.shots[0]?.measurements).toMatchObject({ launchDirection: -5, curve: 3, apexRange: 0 });
    expect(parsed.shots[1]?.measurements.speedRange).toBeNull();
    expect(parsed.warnings.some(w => w.field === 'Ball Speed (kph)')).toBe(true);
  });
  it('deduplicates content despite BOM, line endings, column order and filename', async () => {
    const a = await parseCsv(new TextEncoder().encode(csvFixture([{}])));
    const b = await parseCsv(new TextEncoder().encode('\ufeff' + csvFixture([{}]).replaceAll('\n', '\r\n')));
    expect(a.fileHash).not.toBe(b.fileHash);
    expect(a.contentHash).toBe(b.contentHash);
    expect(toBase64(fromBase64(a.originalBase64))).toBe(a.originalBase64);
  });
  it('rejects structural errors, missing headers, non-UTF8 and oversized files', async () => {
    await expect(parseCsv(new TextEncoder().encode('Club,Value\nPW,20'))).rejects.toThrow('headers');
    await expect(parseCsv(new TextEncoder().encode('Shot #,Club,Carry Dist. Range (m)\n1,PW,10,extra'))).rejects.toThrow('columns');
    await expect(parseCsv(new Uint8Array([255]))).rejects.toThrow('UTF-8');
    await expect(parseCsv(new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow('5 MB');
  });
  it('only suggests valid filename dates and rejects impossible numeric cells', async () => {
    expect(suggestDate('shot_data_5nov26.csv')).toBe('2026-11-05');
    expect(suggestDate('session_2026-02-31.csv')).toBe('');
    const p = await parseCsv(new TextEncoder().encode(csvFixture([{ 'Carry Dist. Range (m)': 'Infinity', Curve: 'NaN', 'Launch Angle (deg)': '17junk' }])));
    expect(p.shots[0]?.measurements).toMatchObject({ carryRange: null, curve: null, launchRange: null });
  });
});

describe('statistics and reproducible cohorts', () => {
  it('uses R7 quantiles, sample SD and explicit sparse/missing values without basis fallback', () => {
    expect(quantile([0, 10, 20, 30], 0.25)).toBe(7.5);
    const summary = summarize([makeShot({ measurements: { flatCarryPremium: 0 } }), makeShot({ measurements: { flatCarryPremium: null, flatCarryRange: 100 } })], 'premium-flat');
    expect(summary.carry).toMatchObject({ n: 1, missing: 1, median: 0, sd: null, iqr: null });
    expect(summarize([], 'premium-flat').carry.median).toBeNull();
  });
  it('keeps the full cutoff date, filters after recency selection and never backfills old data', () => {
    const sessions = [makeSession({ date: '2026-11-16' }), makeSession({ date: '2026-11-10' }), makeSession({ date: '2026-01-01' })];
    const shots = sessions.flatMap((s, i) => Array.from({ length: i === 0 ? 30 : 40 }, (_, j) => makeShot({ sessionId: s.id, rowIndex: j + 1, review: { intent: i === 0 ? 'partial' : 'full' } })));
    const recent = selectCohort(shots, sessions, { mode: 'recent', today: '2026-11-16', intent: 'full', contact: 'all' });
    expect(recent).toHaveLength(40);
    expect(selectCohort(shots, sessions, { mode: 'recent', today: '2027-05-01', intent: 'all', contact: 'all' })).toHaveLength(0);
  });
  it('uses effective clubs, exclusions, archived sessions and only reviewed typical shots', () => {
    const session = makeSession();
    const shots = [makeShot({ sessionId: session.id, review: { club: { kind: 'corrected', club: 'D' }, contact: 'typical' } }), makeShot({ sessionId: session.id }), makeShot({ sessionId: session.id, review: { exclusion: { kind: 'excluded', reason: 'tracking error' } } })];
    expect(selectCohort(shots, [session], { mode: 'all', today: session.date, intent: 'all', contact: 'typical', club: 'D' })).toHaveLength(1);
    expect(selectCohort(shots, [{ ...session, archived: true }], { mode: 'all', today: session.date, intent: 'all', contact: 'all' })).toHaveLength(0);
    expect(reviewCoverage(shots)).toMatchObject({ reviewed: 1, total: 2, mishits: 0 });
  });
});

describe('conservative club-label suggestions', () => {
  const sessions = ['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-06'].map(date => makeSession({ date }));
  const history = sessions.slice(0, 3).flatMap(s => Array.from({ length: 12 }, (_, i) => makeShot({ sessionId: s.id, rowIndex: i + 1, review: { intent: 'full' }, measurements: { flatCarryRange: 90 + i, speedRange: 120 + i } })));
  it('flags a joint positive outlier without changing raw shots and honours manual confirmation', () => {
    const candidate = makeShot({ sessionId: sessions[3]!.id, review: { intent: 'full' }, measurements: { flatCarryRange: 210, speedRange: 230 } });
    expect(clubFlags([...history, candidate], sessions).get(candidate.id)?.baselineCount).toBe(36);
    expect(candidate.recordedClub).toBe('7i');
    expect(clubFlags([...history, { ...candidate, review: { ...candidate.review, club: { kind: 'confirmed' } } }], sessions).has(candidate.id)).toBe(false);
  });
  it('abstains for short mishits, partial wedges, small samples and future/same-day evidence', () => {
    const short = makeShot({ sessionId: sessions[3]!.id, review: { intent: 'full' }, measurements: { flatCarryRange: 20, speedRange: 30 } });
    expect(clubFlags([...history, short], sessions).has(short.id)).toBe(false);
    const wedge = { ...short, recordedClub: 'SW' };
    expect(clubFlags([...history, wedge], sessions).has(wedge.id)).toBe(false);
    const high = { ...short, measurements: { ...short.measurements, flatCarryRange: 220, speedRange: 240 } };
    expect(clubFlags([...history.slice(0, 20), high], sessions).has(high.id)).toBe(false);
    expect(clubFlags([...history, high], sessions.map(s => ({ ...s, date: '2026-11-06', time: null }))).has(high.id)).toBe(false);
  });
});
