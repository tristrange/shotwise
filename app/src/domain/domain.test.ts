import { quantile } from './statistics';
import { describe, expect, it } from 'vitest';
import { parseCsv, suggestDate, toBase64, fromBase64 } from './csv';
import {
  benchmarkClubGroups,
  clubGaps,
  summarize,
  selectCohort,
  clubFlags,
  mostImprovedClub,
  practiceInsights,
  reviewCoverage,
  suggestClub,
  type AnalysisQuery,
} from './analytics';
import { makeShot, makeSession, csvFixture } from './fixtures';
import { resolveShots } from './assessment';
import { clubOrder, emptyDataset, fullSwingCandidate } from './model';
import type { Review } from './model';

const allTimeQuery = {
  mode: 'all',
  today: '2026-11-16',
  intent: 'all',
  contact: 'all',
} satisfies AnalysisQuery;

describe('gapping analysis windows', () => {
  it('keeps old beginner data out of Recent gapping and curvature insights', () => {
    const old = makeSession({ date: '2026-01-01' });
    const recent = makeSession({ date: '2026-11-16' });
    const shots = [old, recent].flatMap((session, i) =>
      Array.from({ length: i === 0 ? 30 : 10 }, () =>
        makeShot({
          sessionId: session.id,
          measurements: {
            flatCarryPremium: i === 0 ? 70 : 120,
            curve: i === 0 ? -2 : 2,
          },
        }),
      ),
    );
    const data = { ...emptyDataset, sessions: [old, recent], shots };
    const recentQuery: AnalysisQuery = { ...allTimeQuery, mode: 'recent' };
    expect(clubGaps(data, 'premium-flat', recentQuery)[0]).toMatchObject({
      median: 120,
      n: 10,
    });
    expect(practiceInsights(data, 'premium-flat', recentQuery)).toEqual([]);
    expect(clubGaps(data, 'premium-flat', allTimeQuery)[0]).toMatchObject({
      median: 70,
      n: 40,
    });
    expect(practiceInsights(data, 'premium-flat', allTimeQuery)).toEqual([]);
  });

  it('reads the gapping spread band from the broader cohort in strong-strike mode', () => {
    const session = makeSession({ date: '2026-11-16' });
    // 20 typical carries 100..119 plus 4 strong 160s: in strong mode the
    // median follows the strong subset, but the P10-P90 band must still
    // describe the broader eligible population.
    const shots = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeShot({
          sessionId: session.id,
          rowIndex: i + 1,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 100 + i, speedPremium: 150 },
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeShot({
          sessionId: session.id,
          rowIndex: 30 + i,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 160, speedPremium: 210 },
        }),
      ),
    ];
    const data = { ...emptyDataset, sessions: [session], shots };
    const strong = clubGaps(data, 'premium-flat', {
      ...allTimeQuery,
      contact: 'strong',
    })[0]!;
    const all = clubGaps(data, 'premium-flat', allTimeQuery)[0]!;
    expect(strong.median).toBe(160); // strong-strike median
    expect(strong.low).toBe(all.low); // broader band, mode-invariant
    expect(strong.high).toBe(all.high);
    expect(strong.potential).toBe(all.potential);
  });

  it('exposes IQR quartiles from the same mode-invariant band cohort', () => {
    const session = makeSession({ date: '2026-11-16' });
    const shots = Array.from({ length: 12 }, (_, i) =>
      makeShot({
        sessionId: session.id,
        rowIndex: i + 1,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 100 + i * 5 },
      }),
    );
    const data = { ...emptyDataset, sessions: [session], shots };
    const row = clubGaps(data, 'premium-flat', allTimeQuery)[0]!;
    // Linear-interpolated quartiles of the 12 band carries 100..155 step 5.
    expect(row.q1).toBe(113.75);
    expect(row.q3).toBe(141.25);
    expect(row.low).toBe(105.5); // P10, same cohort
    expect(row.high).toBe(149.5); // P90, same cohort
    // Below 4 measured band shots the quartiles stay null (same guard as iqr).
    const few = {
      ...emptyDataset,
      sessions: [session],
      shots: shots.slice(0, 3),
    };
    const fewRow = clubGaps(few, 'premium-flat', allTimeQuery)[0]!;
    expect(fewRow.q1).toBeNull();
    expect(fewRow.q3).toBeNull();
    expect(fewRow.low).toBeNull();
  });

  it('applies review filters after the cutoff date without backfilling older shots', () => {
    const sessions = ['2026-11-16', '2026-11-10', '2026-10-01'].map((date) =>
      makeSession({ date }),
    );
    const shots = sessions.flatMap((session, i) =>
      Array.from({ length: i === 0 ? 30 : 40 }, (_, j) =>
        makeShot({
          sessionId: session.id,
          measurements: { flatCarryPremium: 100 + i * 10 },
          review: {
            intent: i === 0 ? 'partial' : i === 1 ? 'unknown' : 'full',
            contact: i === 1 && j < 10 ? 'typical' : 'uncertain',
          },
        }),
      ),
    );
    const data = { ...emptyDataset, sessions, shots };
    const query: AnalysisQuery = { ...allTimeQuery, mode: 'recent' };
    expect(clubGaps(data, 'premium-flat', query)[0]).toMatchObject({
      n: 40,
      median: 110,
    });
    expect(
      clubGaps(data, 'premium-flat', { ...query, contact: 'typical' })[0],
    ).toMatchObject({ n: 10, median: 110 });
    expect(
      clubGaps(data, 'premium-flat', { ...query, intent: 'full' }),
    ).toEqual([]);
    expect(
      practiceInsights(data, 'premium-flat', { ...query, intent: 'full' }),
    ).toEqual([]);
  });

  it('uses only measurements from the selected basis', () => {
    const session = makeSession();
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: Array.from({ length: 10 }, () =>
        makeShot({
          sessionId: session.id,
          measurements: { flatCarryPremium: null, flatCarryRange: 130 },
        }),
      ),
    };
    expect(clubGaps(data, 'premium-flat', allTimeQuery)).toEqual([]);
    expect(practiceInsights(data, 'premium-flat', allTimeQuery)).toEqual([]);
    expect(clubGaps(data, 'range-flat', allTimeQuery)[0]).toMatchObject({
      median: 130,
      n: 10,
    });
  });
});

describe('lossless CSV boundary', () => {
  it('preserves bytes, extra cells, row order, duplicate source numbers, zero and signed metrics', async () => {
    const text =
      '\ufeff' +
      csvFixture([
        {
          'Shot #': '7',
          Club: 'PW',
          'Launch Direction': '5°L',
          Curve: '3R',
          'Apex (m)': '0',
          Comment: 'a, b',
        },
        {
          'Shot #': '7',
          Club: '?',
          'Launch Direction': '--',
          'Ball Speed (kph)': 'bad',
        },
      ]).replaceAll('\n', '\r\n');
    const bytes = new TextEncoder().encode(text);
    const parsed = await parseCsv(bytes);
    expect(fromBase64(parsed.originalBase64)).toEqual(bytes);
    expect(parsed.shots.map((s) => s.rowIndex)).toEqual([1, 2]);
    expect(parsed.shots.map((s) => s.sourceNumber)).toEqual(['7', '7']);
    expect(parsed.shots[0]?.raw.Comment).toBe('a, b');
    expect(parsed.shots[0]?.measurements).toMatchObject({
      launchDirection: -5,
      curve: 3,
      apexRange: 0,
    });
    expect(parsed.shots[1]?.measurements.speedRange).toBeNull();
    expect(parsed.warnings.some((w) => w.field === 'Ball Speed (kph)')).toBe(
      true,
    );
  });
  it('deduplicates content despite BOM, line endings, column order and filename', async () => {
    const a = await parseCsv(new TextEncoder().encode(csvFixture([{}])));
    const b = await parseCsv(
      new TextEncoder().encode(
        '\ufeff' + csvFixture([{}]).replaceAll('\n', '\r\n'),
      ),
    );
    expect(a.fileHash).not.toBe(b.fileHash);
    expect(a.contentHash).toBe(b.contentHash);
    expect(toBase64(fromBase64(a.originalBase64))).toBe(a.originalBase64);
  });
  it('rejects structural errors, missing headers, non-UTF8 and oversized files', async () => {
    await expect(
      parseCsv(new TextEncoder().encode('Club,Value\nPW,20')),
    ).rejects.toThrow('headers');
    await expect(
      parseCsv(
        new TextEncoder().encode(
          'Shot #,Club,Carry Dist. Range (m)\n1,PW,10,extra',
        ),
      ),
    ).rejects.toThrow('columns');
    await expect(parseCsv(new Uint8Array([255]))).rejects.toThrow('UTF-8');
    await expect(parseCsv(new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow(
      '5 MB',
    );
  });
  it('only suggests valid filename dates and rejects impossible numeric cells', async () => {
    expect(suggestDate('shot_data_5nov26.csv')).toBe('2026-11-05');
    expect(suggestDate('shot_data_5nov2026.csv')).toBe('2026-11-05');
    expect(suggestDate('session_2026-02-31.csv')).toBe('');
    const p = await parseCsv(
      new TextEncoder().encode(
        csvFixture([
          {
            'Carry Dist. Range (m)': 'Infinity',
            Curve: 'NaN',
            'Launch Angle (deg)': '17junk',
          },
        ]),
      ),
    );
    expect(p.shots[0]?.measurements).toMatchObject({
      carryRange: null,
      curve: null,
      launchRange: null,
    });
  });
});

describe('statistics and reproducible cohorts', () => {
  it('uses R7 quantiles, sample SD and explicit sparse/missing values without basis fallback', () => {
    expect(quantile([0, 10, 20, 30], 0.25)).toBe(7.5);
    const summary = summarize(
      [
        makeShot({ measurements: { flatCarryPremium: 0 } }),
        makeShot({
          measurements: { flatCarryPremium: null, flatCarryRange: 100 },
        }),
      ],
      'premium-flat',
    );
    expect(summary.carry).toMatchObject({
      n: 1,
      missing: 1,
      median: 0,
      sd: null,
      iqr: null,
    });
    expect(summarize([], 'premium-flat').carry.median).toBeNull();
  });
  it('keeps the full cutoff date, filters after recency selection and never backfills old data', () => {
    const sessions = [
      makeSession({ date: '2026-11-16' }),
      makeSession({ date: '2026-11-10' }),
      makeSession({ date: '2026-01-01' }),
    ];
    const shots = sessions.flatMap((s, i) =>
      Array.from({ length: i === 0 ? 30 : 40 }, (_, j) =>
        makeShot({
          sessionId: s.id,
          rowIndex: j + 1,
          review: { intent: i === 0 ? 'partial' : 'full' },
        }),
      ),
    );
    const recent = selectCohort(shots, sessions, {
      mode: 'recent',
      today: '2026-11-16',
      intent: 'full',
      contact: 'all',
    });
    expect(recent).toHaveLength(40);
    expect(
      selectCohort(shots, sessions, {
        mode: 'recent',
        today: '2027-05-01',
        intent: 'all',
        contact: 'all',
      }),
    ).toHaveLength(0);
  });
  it('applies one club-benchmark eligibility rule and keeps suspected rows out of the Recent cap', () => {
    // Genuine 9i history across two dates, then a driver block plus a 10-shot
    // 9i-labelled block at driver distances — a strong forgotten-switch flag.
    const a1 = makeSession({ id: 'a1', date: '2026-10-01' });
    const a2 = makeSession({ id: 'a2', date: '2026-11-01' });
    const b = makeSession({ id: 'b', date: '2026-11-16' });
    const nineIron = (session: typeof a1, count: number, startRow: number) =>
      Array.from({ length: count }, (_, i) =>
        makeShot({
          sessionId: session.id,
          rowIndex: startRow + i,
          recordedClub: '9i',
          measurements: { flatCarryPremium: 120, speedPremium: 118 },
        }),
      );
    const shots = [
      ...nineIron(a1, 10, 1),
      ...nineIron(a2, 45, 1),
      ...Array.from({ length: 12 }, (_, i) =>
        makeShot({
          sessionId: b.id,
          rowIndex: i + 1,
          recordedClub: 'D',
          measurements: { flatCarryPremium: 240, speedPremium: 210 },
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeShot({
          id: `wrong-${i}`,
          sessionId: b.id,
          rowIndex: 20 + i,
          recordedClub: '9i',
          measurements: { flatCarryPremium: 235, speedPremium: 205 },
        }),
      ),
    ];
    const sessions = [a1, a2, b];
    const resolved = resolveShots(shots, sessions, 'premium-flat');
    // The shared rule: flagged rows are out of every club group.
    const groups = benchmarkClubGroups(shots, resolved);
    expect(groups.get('9i')).toHaveLength(55);
    expect(groups.get('D')).toHaveLength(12);
    for (const g of groups.values())
      expect(g.some((s) => s.id.startsWith('wrong-'))).toBe(false);
    // Recent mode: the cap runs over eligible shots only, so the 10 suspected
    // rows (newest) cannot displace older valid 9i rows in the club cohort.
    const clubCohort = selectCohort(shots, sessions, {
      mode: 'recent',
      today: '2026-11-16',
      intent: 'all',
      contact: 'all',
      club: '9i',
    });
    expect(clubCohort).toHaveLength(55);
    expect(clubCohort.every((s) => s.sessionId !== b.id)).toBe(true);
    // Session-wide Recent keeps the suspected rows with their recorded label.
    const sessionWide = selectCohort(shots, sessions, {
      mode: 'recent',
      today: '2026-11-16',
      intent: 'all',
      contact: 'all',
    });
    expect(sessionWide.filter((s) => s.id.startsWith('wrong-'))).toHaveLength(10);
  });
  it('uses effective clubs, exclusions, archived sessions and only reviewed typical shots', () => {
    const session = makeSession();
    const shots = [
      makeShot({
        sessionId: session.id,
        review: { club: { kind: 'corrected', club: 'D' }, contact: 'typical' },
      }),
      makeShot({ sessionId: session.id }),
      makeShot({
        sessionId: session.id,
        review: { exclusion: { kind: 'excluded', reason: 'tracking error' } },
      }),
    ];
    expect(
      selectCohort(shots, [session], {
        mode: 'all',
        today: session.date,
        intent: 'all',
        contact: 'typical',
        club: 'D',
      }),
    ).toHaveLength(1);
    expect(
      selectCohort(shots, [{ ...session, archived: true }], {
        mode: 'all',
        today: session.date,
        intent: 'all',
        contact: 'all',
      }),
    ).toHaveLength(0);
    expect(reviewCoverage(shots)).toMatchObject({
      reviewed: 1,
      total: 2,
      mishits: 0,
    });
  });

  it('treats automatically assessed shots as typical without review (ADR-0001)', () => {
    const early = makeSession({ id: 'early', date: '2026-11-01' });
    const late = makeSession({ id: 'late', date: '2026-11-16' });
    const history = Array.from({ length: 12 }, (_, i) =>
      makeShot({
        sessionId: early.id,
        rowIndex: i + 1,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 150, speedPremium: 200 },
      }),
    );
    const shots = [
      ...history,
      makeShot({
        id: 'auto-typical',
        sessionId: late.id,
        rowIndex: 1,
        measurements: { flatCarryPremium: 150, speedPremium: 200 },
      }),
      makeShot({
        id: 'auto-mishit',
        sessionId: late.id,
        rowIndex: 2,
        measurements: { flatCarryPremium: 50, speedPremium: 80 },
      }),
    ];
    const base = {
      mode: 'all',
      today: '2026-11-16',
      intent: 'all',
    } satisfies Omit<AnalysisQuery, 'contact'>;
    // Contact "typical" no longer requires manual review: the automatic
    // assessment of the unreviewed normal shot qualifies it.
    const typical = selectCohort(shots, [early, late], {
      ...base,
      contact: 'typical',
    });
    expect(typical.map((s) => s.id)).toContain('auto-typical');
    expect(typical.map((s) => s.id)).not.toContain('auto-mishit');
    // Hide-likely-mishits also drops the automatically assessed mishit.
    const hidden = selectCohort(shots, [early, late], {
      ...base,
      contact: 'all',
      hideLikelyMishits: true,
    });
    expect(hidden.map((s) => s.id)).not.toContain('auto-mishit');
    expect(hidden.map((s) => s.id)).toContain('auto-typical');
    // Manual review stays authoritative over the automatic layer.
    const manual = [
      ...history,
      makeShot({
        id: 'manual-typical',
        sessionId: late.id,
        rowIndex: 2,
        measurements: { flatCarryPremium: 50, speedPremium: 80 },
        review: { contact: 'typical' },
      }),
    ];
    const typicalManual = selectCohort(manual, [early, late], {
      ...base,
      contact: 'typical',
    });
    expect(typicalManual.map((s) => s.id)).toContain('manual-typical');
    // Coverage reports both manual review and automatic assessment.
    const resolved = resolveShots(shots, [early, late], 'premium-flat');
    // Assessed = manual (0) plus automatic: the two late shots and the two
    // history shots that already had >= 10 earlier shots as their baseline.
    const coverage = reviewCoverage(shots, resolved);
    expect(coverage).toMatchObject({
      total: 14,
      reviewed: 0,
      assessed: 4,
      automatic: 4,
    });
    // The two unassessed denominators answer different questions: manual-only
    // vs resolved (manual + automatic). They must not be mixed.
    expect(coverage.unassessed).not.toBeNull();
    expect(coverage.unassessedResolved).not.toBeNull();
    expect(coverage.unassessedResolved!).toBeLessThanOrEqual(coverage.unassessed!);
    // Without a resolved map the resolved denominator is unavailable, not zero.
    expect(reviewCoverage(shots).unassessedResolved).toBeNull();
  });

  it('groups inferred clubs and excludes suspected wrong-club shots from club views', () => {
    const early = makeSession({ id: 'early', date: '2026-11-01' });
    const late = makeSession({ id: 'late', date: '2026-11-16' });
    const history = (club: string, carry: number, speed: number) =>
      Array.from({ length: 12 }, (_, i) =>
        makeShot({
          sessionId: early.id,
          rowIndex: i + 1,
          recordedClub: club,
          measurements: { flatCarryPremium: carry, speedPremium: speed },
        }),
      );
    const shots = [
      ...history('7i', 150, 200),
      ...history('9i', 120, 170),
      // Unknown label inside a 7i run: inferred as 7i, groups with 7i.
      makeShot({
        id: 'unknown',
        sessionId: late.id,
        rowIndex: 1,
        recordedClub: '?',
        measurements: { flatCarryPremium: 150, speedPremium: 200 },
      }),
      ...Array.from({ length: 10 }, (_, i) =>
        makeShot({
          id: `late-7i-${i}`,
          sessionId: late.id,
          rowIndex: i + 2,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 150, speedPremium: 200 },
        }),
      ),
      // A 9i-labelled run that actually matches 7i measurements: suspected.
      ...Array.from({ length: 10 }, (_, i) =>
        makeShot({
          id: `wrong-${i}`,
          sessionId: late.id,
          rowIndex: 20 + i,
          recordedClub: '9i',
          measurements: { flatCarryPremium: 150, speedPremium: 200 },
        }),
      ),
    ];
    const base = {
      mode: 'all',
      today: '2026-11-16',
      intent: 'all',
      contact: 'all',
    } satisfies AnalysisQuery;
    const club7i = selectCohort(shots, [early, late], { ...base, club: '7i' });
    expect(club7i.map((s) => s.id)).toContain('unknown');
    expect(club7i.map((s) => s.id)).not.toContain('wrong-3');
    const club9i = selectCohort(shots, [early, late], { ...base, club: '9i' });
    expect(club9i.map((s) => s.id)).not.toContain('wrong-3');
    expect(club9i).toHaveLength(12);
    // Without a club filter the suspected shots stay in the session-wide view.
    expect(selectCohort(shots, [early, late], base)).toHaveLength(45);
  });
});

describe('conservative club-label suggestions', () => {
  const sessions = ['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-06'].map(
    (date) => makeSession({ date }),
  );
  const history = sessions.slice(0, 3).flatMap((s) =>
    Array.from({ length: 12 }, (_, i) =>
      makeShot({
        sessionId: s.id,
        rowIndex: i + 1,
        review: { intent: 'full' },
        measurements: { flatCarryRange: 90 + i, speedRange: 120 + i },
      }),
    ),
  );
  it('flags a joint positive outlier without changing raw shots and honours manual confirmation', () => {
    const candidate = makeShot({
      sessionId: sessions[3]!.id,
      review: { intent: 'full' },
      measurements: { flatCarryRange: 210, speedRange: 230 },
    });
    expect(
      clubFlags([...history, candidate], sessions).get(candidate.id)
        ?.baselineCount,
    ).toBe(36);
    expect(candidate.recordedClub).toBe('7i');
    expect(
      clubFlags(
        [
          ...history,
          {
            ...candidate,
            review: { ...candidate.review, club: { kind: 'confirmed' } },
          },
        ],
        sessions,
      ).has(candidate.id),
    ).toBe(false);
  });
  it('abstains for short mishits, partial wedges, small samples and future/same-day evidence', () => {
    const short = makeShot({
      sessionId: sessions[3]!.id,
      review: { intent: 'full' },
      measurements: { flatCarryRange: 20, speedRange: 30 },
    });
    expect(clubFlags([...history, short], sessions).has(short.id)).toBe(false);
    const wedge = { ...short, recordedClub: 'SW' };
    expect(clubFlags([...history, wedge], sessions).has(wedge.id)).toBe(false);
    const high = {
      ...short,
      measurements: {
        ...short.measurements,
        flatCarryRange: 220,
        speedRange: 240,
      },
    };
    expect(
      clubFlags([...history.slice(0, 20), high], sessions).has(high.id),
    ).toBe(false);
    expect(
      clubFlags(
        [...history, high],
        sessions.map((s) => ({ ...s, date: '2026-11-06', time: null })),
      ).has(high.id),
    ).toBe(false);
  });
});

describe('most improved club', () => {
  const earlier = makeSession({ id: crypto.randomUUID(), date: '2026-11-01' });
  const latest = makeSession({ id: crypto.randomUUID(), date: '2026-11-08' });
  const sessions = [earlier, latest];

  function shotsFor(
    sessionId: string,
    club: string,
    count: number,
    premium: number,
    range: number,
    review: Partial<Review> = {},
  ) {
    return Array.from({ length: count }, (_, i) =>
      makeShot({
        sessionId,
        recordedClub: club,
        rowIndex: i + 1,
        measurements: { flatCarryPremium: premium, flatCarryRange: range },
        review,
      }),
    );
  }

  it('picks the largest positive median gain with enough shots on both sides', () => {
    const shots = [
      ...shotsFor(earlier.id, '7i', 10, 150, 150),
      ...shotsFor(earlier.id, '5i', 10, 200, 200),
      ...shotsFor(latest.id, '7i', 3, 170, 170),
      ...shotsFor(latest.id, '5i', 3, 205, 205),
    ];
    expect(
      mostImprovedClub({ ...emptyDataset, sessions, shots }, 'premium-flat'),
    ).toMatchObject({
      club: '7i',
      delta: 20,
      recentMedian: 170,
      baselineMedian: 150,
      recentDate: '2026-11-08',
    });
  });

  it('returns nothing when sample sizes or improvement are absent', () => {
    const sparse = [
      ...shotsFor(earlier.id, '7i', 10, 150, 150),
      ...shotsFor(latest.id, '7i', 2, 180, 180),
    ];
    expect(
      mostImprovedClub({ ...emptyDataset, sessions, shots: sparse }, 'premium-flat'),
    ).toBeNull();
    const regressing = [
      ...shotsFor(earlier.id, '7i', 10, 150, 150),
      ...shotsFor(latest.id, '7i', 3, 140, 140),
    ];
    expect(
      mostImprovedClub(
        { ...emptyDataset, sessions, shots: regressing },
        'premium-flat',
      ),
    ).toBeNull();
  });

  it('uses the selected measurement basis and ignores excluded shots', () => {
    const shots = [
      ...shotsFor(earlier.id, '7i', 10, 150, 150),
      ...shotsFor(earlier.id, '5i', 10, 200, 200),
      ...shotsFor(latest.id, '7i', 3, 170, 145),
      ...shotsFor(latest.id, '5i', 3, 205, 230),
      ...shotsFor(latest.id, '9i', 10, 0, 0, {
        exclusion: { kind: 'excluded', reason: 'misread' },
      }),
    ];
    const data = { ...emptyDataset, sessions, shots };
    expect(mostImprovedClub(data, 'premium-flat')?.club).toBe('7i');
    expect(mostImprovedClub(data, 'range-flat')?.club).toBe('5i');
  });
});

describe('club order', () => {
  it('runs longest to shortest, with wedges last in pw, gw, sw, lw order', () => {
    const clubs = ['lw', '7i', 'PW', '3w', '4H', 'D', '5i', 'sw', 'gw', '9i', '2h', '5w'];
    expect(
      [...clubs].sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b)),
    ).toEqual(['D', '3w', '5w', '2h', '4H', '5i', '7i', '9i', 'PW', 'gw', 'sw', 'lw']);
  });
  it('puts unknown labels last', () => {
    expect(clubOrder('?')).toBeGreaterThan(clubOrder('lw'));
    expect(clubOrder('misread')).toBeGreaterThan(clubOrder('9i'));
  });

  it('orders wedge lofts low to high and keeps approach and utility wedges before sand and lob wedges', () => {
    const clubs = [
      '60°',
      'LW',
      '56',
      'SW',
      'UW',
      'AW',
      'GW',
      '52°',
      '48°',
      'PW',
      '9i',
    ];
    expect(
      clubs.sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b)),
    ).toEqual([
      '9i',
      'PW',
      '48°',
      'AW',
      'GW',
      'UW',
      '52°',
      '56',
      'SW',
      '60°',
      'LW',
    ]);
  });
});

describe('club gapping', () => {
  const session = makeSession({ date: '2026-11-16' });
  const shotsWith = (club: string, carries: number[]) =>
    carries.map((carry, i) =>
      makeShot({
        sessionId: session.id,
        recordedClub: club,
        rowIndex: i + 1,
        measurements: { flatCarryPremium: carry },
        review: { intent: 'full', contact: 'typical' },
      }),
    );

  it('summarises full swings with typical contact, ordered longest to shortest', () => {
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: [
        ...shotsWith('PW', [86, 88, 90, 92, 94, 96, 98, 100, 102, 104]),
        ...shotsWith('7i', [150, 154, 158, 160, 160, 160, 162, 166, 170, 170]),
        ...shotsWith('5i', [180, 182, 184, 186, 188, 190, 192, 194, 196, 198]),
        makeShot({
          sessionId: session.id,
          recordedClub: '3w',
          measurements: { flatCarryPremium: 300 },
          review: { intent: 'full', contact: 'mishit' },
        }),
        makeShot({
          sessionId: session.id,
          recordedClub: '?',
          measurements: { flatCarryPremium: 400 },
          review: { intent: 'full', contact: 'typical' },
        }),
      ],
    };
    expect(
      clubGaps(data, 'premium-flat', allTimeQuery).map((row) => row.club),
    ).toEqual(['5i', '7i', 'PW']);
    expect(clubGaps(data, 'premium-flat', allTimeQuery)[1]).toMatchObject({
      median: 160,
      n: 10,
      reliable: true,
    });
  });

  it('treats unreviewed pitching-wedge shots as iron-style full-swing candidates', () => {
    const unreviewed = (club: string, carries: number[]) =>
      carries.map((carry, i) =>
        makeShot({
          sessionId: session.id,
          recordedClub: club,
          rowIndex: i + 1,
          measurements: { flatCarryPremium: carry },
        }),
      );
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: [
        ...unreviewed('7i', [150, 154, 158, 160, 160, 160, 162, 166, 170, 170]),
        ...unreviewed('PW', [100, 102, 104, 106, 108, 110, 112, 114, 116, 118]),
        ...unreviewed('SW', [50, 52, 54, 56, 58, 60, 62, 64, 66, 68]),
        makeShot({
          sessionId: session.id,
          recordedClub: 'PW',
          rowIndex: 40,
          measurements: { flatCarryPremium: 60 },
          review: { intent: 'partial' },
        }),
      ],
    };
    const rows = clubGaps(data, 'premium-flat', allTimeQuery);
    // PW joins the irons; SW stays out until reviewed; the partial PW is excluded.
    expect(rows.map((row) => row.club)).toEqual(['7i', 'PW']);
    expect(rows.find((row) => row.club === 'PW')).toMatchObject({
      n: 10,
      median: 109,
    });
  });

  it('fullSwingCandidate keeps higher wedges conservative and partials out', () => {
    const base = { sessionId: session.id, recordedClub: '7i' };
    expect(
      fullSwingCandidate(makeShot({ ...base, review: { intent: 'full' } })),
    ).toBe(true);
    expect(
      fullSwingCandidate(makeShot({ ...base, review: { intent: 'unknown' } })),
    ).toBe(true);
    expect(
      fullSwingCandidate(
        makeShot({ ...base, recordedClub: 'PW', review: { intent: 'unknown' } }),
      ),
    ).toBe(true);
    expect(
      fullSwingCandidate(
        makeShot({ ...base, recordedClub: 'SW', review: { intent: 'unknown' } }),
      ),
    ).toBe(false);
    expect(
      fullSwingCandidate(
        makeShot({ ...base, recordedClub: 'PW', review: { intent: 'partial' } }),
      ),
    ).toBe(false);
  });

  it('includes unreviewed shots but leaves out identified partials and mishits', () => {
    const base = Array.from({ length: 10 }, (_, i) =>
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: i + 1,
        measurements: { flatCarryPremium: 150 + i },
      }),
    );
    const partial = makeShot({
      sessionId: session.id,
      recordedClub: '9i',
      rowIndex: 11,
      measurements: { flatCarryPremium: 90 },
      review: { intent: 'partial' },
    });
    const mishit = makeShot({
      sessionId: session.id,
      recordedClub: '5i',
      rowIndex: 12,
      measurements: { flatCarryPremium: 210 },
      review: { contact: 'mishit' },
    });
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: [...base, partial, mishit],
    };
    expect(
      clubGaps(data, 'premium-flat', allTimeQuery).map((row) => row.club),
    ).toEqual(['7i']);
  });

  it('flags large and small median gaps, but never on a thin sample', () => {
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: [
        ...shotsWith('7i', [152, 155, 158, 160, 160, 160, 162, 165, 168, 170]),
        ...shotsWith('9i', [112, 115, 118, 120, 120, 120, 122, 125, 128, 128]),
        ...shotsWith('PW', [100, 104, 108, 112, 116, 120, 124, 128, 132, 136]),
        ...shotsWith('SW', [50, 55, 60]),
      ],
    };
    const rows = clubGaps(data, 'premium-flat', allTimeQuery);
    expect(rows.find((row) => row.club === '9i')).toMatchObject({
      gap: 40,
      flag: 'large',
    });
    expect(rows.find((row) => row.club === 'PW')).toMatchObject({
      flag: 'small',
    });
    expect(rows.find((row) => row.club === 'SW')).toMatchObject({
      reliable: false,
      flag: null,
    });
  });

  it('identifies reversed medians without calling them overlapping bands', () => {
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: [
        ...shotsWith('5i', Array(10).fill(100)),
        ...shotsWith('6i', Array(10).fill(160)),
      ],
    };
    expect(clubGaps(data, 'premium-flat', allTimeQuery)[1]).toMatchObject({
      gap: -60,
      flag: 'reversed',
    });
  });
});

describe('club suggestions', () => {
  const session = makeSession({ id: crypto.randomUUID(), date: '2026-11-16' });
  const known = (club: string, carry: number, count: number, start: number) =>
    Array.from({ length: count }, (_, i) =>
      makeShot({
        sessionId: session.id,
        recordedClub: club,
        rowIndex: start + i,
        measurements: { flatCarryPremium: carry },
      }),
    );

  it('does not suggest clubs for a shot in an archived session', () => {
    const archived = makeSession({ archived: true });
    const unknown = makeShot({
      sessionId: archived.id,
      recordedClub: '?',
      measurements: { flatCarryPremium: 150 },
    });
    const data = {
      ...emptyDataset,
      sessions: [session, archived],
      shots: [...known('7i', 150, 10, 1), unknown],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toBeNull();
  });

  it('suggests the nearest well-sampled club in the same session', () => {
    const unknown = makeShot({
      sessionId: session.id,
      recordedClub: '?',
      rowIndex: 21,
      measurements: { flatCarryPremium: 152 },
    });
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: [...known('7i', 150, 10, 1), ...known('5i', 180, 10, 11), unknown],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toMatchObject({
      club: '7i',
      delta: 2,
      source: 'session',
      sampleSize: 10,
    });
  });

  it.each([
    [150, 150],
    [150, 153],
    [164, 166],
  ])(
    'withholds ambiguous suggestions regardless of shot order (%s m and %s m)',
    (firstCarry, secondCarry) => {
      const unknown = makeShot({
        sessionId: session.id,
        recordedClub: '?',
        measurements: { flatCarryPremium: 150 },
      });
      const data = {
        ...emptyDataset,
        sessions: [session],
        shots: [
          ...known('6i', firstCarry, 10, 1),
          ...known('7i', secondCarry, 10, 11),
          unknown,
        ],
      };
      expect(suggestClub(unknown, data, 'premium-flat')).toBeNull();
      expect(
        suggestClub(
          unknown,
          { ...data, shots: [...data.shots].reverse() },
          'premium-flat',
        ),
      ).toBeNull();
    },
  );

  it('does not override ambiguous session evidence with a historical winner', () => {
    const earlier = makeSession({ date: '2026-11-01' });
    const unknown = makeShot({
      sessionId: session.id,
      recordedClub: '?',
      measurements: { flatCarryPremium: 150 },
    });
    const data = {
      ...emptyDataset,
      sessions: [session, earlier],
      shots: [
        ...known('6i', 150, 10, 1),
        ...known('7i', 150, 10, 11),
        ...known('6i', 180, 20, 1).map((shot) => ({
          ...shot,
          sessionId: earlier.id,
        })),
        unknown,
      ],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toBeNull();
  });

  it.each([
    [150, 155],
    [165, 180],
  ])(
    'allows a clear suggestion at the distance and runner-up boundaries (%s m and %s m)',
    (firstCarry, secondCarry) => {
      const unknown = makeShot({
        sessionId: session.id,
        recordedClub: '?',
        measurements: { flatCarryPremium: 150 },
      });
      const data = {
        ...emptyDataset,
        sessions: [session],
        shots: [
          ...known('6i', firstCarry, 10, 1),
          ...known('7i', secondCarry, 10, 11),
          unknown,
        ],
      };
      expect(suggestClub(unknown, data, 'premium-flat')?.club).toBe('6i');
    },
  );

  it('also withholds ambiguous suggestions when falling back to other sessions', () => {
    const recent = makeSession();
    const unknown = makeShot({
      sessionId: recent.id,
      recordedClub: '?',
      measurements: { flatCarryPremium: 150 },
    });
    const data = {
      ...emptyDataset,
      sessions: [session, recent],
      shots: [...known('6i', 150, 10, 1), ...known('7i', 150, 10, 11), unknown],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toBeNull();
  });

  it('can use historical data when no session candidate is within the 15 m tolerance', () => {
    const earlier = makeSession({ date: '2026-11-01' });
    const unknown = makeShot({
      sessionId: session.id,
      recordedClub: '?',
      measurements: { flatCarryPremium: 150 },
    });
    const data = {
      ...emptyDataset,
      sessions: [session, earlier],
      shots: [
        ...known('6i', 166, 10, 1),
        ...known('7i', 167, 10, 11),
        ...known('6i', 150, 20, 1).map((shot) => ({
          ...shot,
          sessionId: earlier.id,
        })),
        unknown,
      ],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toMatchObject({
      club: '6i',
      source: 'all',
    });
  });

  it('falls back to all sessions when the shot’s own session has too few known shots', () => {
    const earlier = makeSession({
      id: crypto.randomUUID(),
      date: '2026-11-01',
    });
    const recent = makeSession({ id: crypto.randomUUID(), date: '2026-11-16' });
    const unknown = makeShot({
      sessionId: recent.id,
      recordedClub: '?',
      measurements: { flatCarryPremium: 151 },
    });
    const data = {
      ...emptyDataset,
      sessions: [earlier, recent],
      shots: [
        ...Array.from({ length: 10 }, () =>
          makeShot({
            sessionId: earlier.id,
            recordedClub: '7i',
            measurements: { flatCarryPremium: 150 },
          }),
        ),
        makeShot({
          sessionId: recent.id,
          recordedClub: '5i',
          measurements: { flatCarryPremium: 180 },
        }),
        unknown,
      ],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toMatchObject({
      club: '7i',
      source: 'all',
    });
  });

  it('returns nothing when samples are too few or the nearest club is too far away', () => {
    const sparse = {
      ...emptyDataset,
      sessions: [session],
      shots: [
        ...known('7i', 150, 9, 1),
        makeShot({
          sessionId: session.id,
          recordedClub: '?',
          measurements: { flatCarryPremium: 152 },
        }),
      ],
    };
    expect(
      suggestClub(sparse.shots.at(-1)!, sparse, 'premium-flat'),
    ).toBeNull();

    const distant = {
      ...emptyDataset,
      sessions: [session],
      shots: [
        ...known('7i', 150, 10, 1),
        makeShot({
          sessionId: session.id,
          recordedClub: '?',
          measurements: { flatCarryPremium: 200 },
        }),
      ],
    };
    expect(
      suggestClub(distant.shots.at(-1)!, distant, 'premium-flat'),
    ).toBeNull();
  });

  it('ignores excluded shots and already-unknown labels when building the baseline', () => {
    const unknown = makeShot({
      sessionId: session.id,
      recordedClub: '?',
      measurements: { flatCarryPremium: 152 },
    });
    const data = {
      ...emptyDataset,
      sessions: [session],
      shots: [
        ...known('7i', 50, 10, 1).map((shot) => ({
          ...shot,
          review: {
            ...shot.review,
            exclusion: { kind: 'excluded' as const, reason: 'bad' },
          },
        })),
        ...known('?', 150, 10, 11),
        unknown,
      ],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toBeNull();
  });
});
