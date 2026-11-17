import { describe, expect, it } from 'vitest';
import { parseCsv, suggestDate, toBase64, fromBase64 } from './csv';
import {
  clubGaps,
  summarize,
  quantile,
  selectCohort,
  clubFlags,
  mostImprovedClub,
  reviewCoverage,
  suggestClub,
} from './analytics';
import { makeShot, makeSession, csvFixture } from './fixtures';
import { clubOrder, emptyDataset } from './model';
import type { Review } from './model';

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
    expect(clubGaps(data, 'premium-flat').map((row) => row.club)).toEqual([
      '5i',
      '7i',
      'PW',
    ]);
    expect(clubGaps(data, 'premium-flat')[1]).toMatchObject({
      median: 160,
      n: 10,
      reliable: true,
    });
  });

  it('flags large gaps and overlaps, but never on a thin sample', () => {
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
    const rows = clubGaps(data, 'premium-flat');
    expect(rows.find((row) => row.club === '9i')).toMatchObject({
      gap: 40,
      flag: 'large',
    });
    expect(rows.find((row) => row.club === 'PW')).toMatchObject({
      flag: 'overlap',
    });
    expect(rows.find((row) => row.club === 'SW')).toMatchObject({
      reliable: false,
      flag: null,
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

  it('falls back to all sessions when the shot’s own session has too few known shots', () => {
    const earlier = makeSession({ id: crypto.randomUUID(), date: '2026-11-01' });
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
      shots: [...known('7i', 150, 9, 1), makeShot({ sessionId: session.id, recordedClub: '?', measurements: { flatCarryPremium: 152 } })],
    };
    expect(suggestClub(sparse.shots.at(-1)!, sparse, 'premium-flat')).toBeNull();

    const distant = {
      ...emptyDataset,
      sessions: [session],
      shots: [...known('7i', 150, 10, 1), makeShot({ sessionId: session.id, recordedClub: '?', measurements: { flatCarryPremium: 200 } })],
    };
    expect(suggestClub(distant.shots.at(-1)!, distant, 'premium-flat')).toBeNull();
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
          review: { ...shot.review, exclusion: { kind: 'excluded' as const, reason: 'bad' } },
        })),
        ...known('?', 150, 10, 11),
        unknown,
      ],
    };
    expect(suggestClub(unknown, data, 'premium-flat')).toBeNull();
  });
});
