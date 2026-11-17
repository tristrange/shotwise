import { describe, expect, it } from 'vitest';
import { assessUnusualShots } from './unusualShots';
import { makeSession, makeShot } from './fixtures';
import type { Review } from './model';

describe('unusual iron shots', () => {
  const session = makeSession();
  const history = Array.from({ length: 20 }, (_, i) =>
    makeShot({
      sessionId: session.id,
      rowIndex: i + 1,
      measurements: {
        flatCarryRange: 100 + (i % 5),
        speedRange: 140 + (i % 5),
      },
    }),
  );
  const candidate = makeShot({
    sessionId: session.id,
    rowIndex: 21,
    measurements: { flatCarryRange: 40, speedRange: 90 },
  });

  it('explains a joint low outlier using only earlier paired measurements without changing shots', () => {
    const shots = [...history, candidate];
    const original = structuredClone(shots);
    expect(
      assessUnusualShots(shots, [session]).get(candidate.id),
    ).toMatchObject({
      kind: 'assessed',
      unusual: true,
      baselineCount: 20,
      sessions: 1,
      carry: 40,
      speed: 90,
      carryMedian: 102,
      speedMedian: 142,
      carryThreshold: 81.6,
      speedThreshold: 127.8,
    });
    expect(shots).toEqual(original);
  });

  it('uses recent prior sessions but never future rows, ambiguous same-day sessions or old history', () => {
    const earlier = makeSession({ date: '2026-11-15', time: '10:00' });
    const future = makeSession({ date: '2026-11-17' });
    const untimed = makeSession({ date: session.date });
    const tooOld = makeSession({ date: '2026-09-17' });
    const target = { ...candidate, rowIndex: 1 };
    const copy = (sessionId: string) =>
      history.map((s) => ({ ...s, id: crypto.randomUUID(), sessionId }));
    const prior = copy(earlier.id);
    const noise = [future, untimed, tooOld].flatMap((s) => copy(s.id));
    const sessions = [session, earlier, future, untimed, tooOld];
    expect(
      assessUnusualShots(
        [...prior, ...noise, ...history, target].reverse(),
        sessions,
      ).get(target.id),
    ).toMatchObject({ kind: 'assessed', unusual: true, baselineCount: 20 });
    expect(
      assessUnusualShots([...noise, ...history, target], sessions).get(
        target.id,
      ),
    ).toMatchObject({ kind: 'abstained', baselineCount: 0 });
  });

  it.each(['constant', 'very variable'])(
    'abstains when the baseline is %s instead of declaring a shot normal',
    (kind) => {
      const baseline = history.map((s, i) => ({
        ...s,
        measurements: {
          ...s.measurements,
          flatCarryRange: kind === 'constant' ? 100 : i % 2 ? 180 : 20,
        },
      }));
      expect(
        assessUnusualShots([...baseline, candidate], [session]).get(
          candidate.id,
        ),
      ).toMatchObject({ kind: 'abstained', baselineCount: 20 });
    },
  );

  it('targets the latest 50 earlier shots while keeping the full cutoff date', () => {
    const older = makeSession({ date: '2026-11-01' });
    const newer = makeSession({ date: '2026-11-15' });
    const baseline = [older, newer].flatMap((s, index) =>
      Array.from({ length: index ? 55 : 30 }, (_, i) =>
        makeShot({
          sessionId: s.id,
          rowIndex: i + 1,
          measurements: {
            flatCarryRange: (index ? 100 : 200) + (i % 5),
            speedRange: (index ? 140 : 240) + (i % 5),
          },
        }),
      ),
    );
    expect(
      assessUnusualShots([...baseline, candidate], [older, newer, session]).get(
        candidate.id,
      ),
    ).toMatchObject({
      kind: 'assessed',
      unusual: true,
      baselineCount: 55,
      carryMedian: 102,
      speedMedian: 142,
    });
  });

  it('respects a typical-contact decision but still uses reviewed typical shots as evidence', () => {
    const reviewed = history.map((s) => ({
      ...s,
      review: { ...s.review, contact: 'typical' as const },
    }));
    expect(
      assessUnusualShots([...reviewed, candidate], [session]).get(candidate.id),
    ).toMatchObject({ kind: 'assessed', unusual: true });
    const accepted = {
      ...candidate,
      review: { ...candidate.review, contact: 'typical' as const },
    };
    expect(
      assessUnusualShots([...history, accepted], [session]).has(accepted.id),
    ).toBe(false);
  });

  it.each([
    { flatCarryRange: 40, speedRange: 142 },
    { flatCarryRange: 102, speedRange: 90 },
    { flatCarryRange: 81.6, speedRange: 90 },
    { flatCarryRange: 102, speedRange: 142 },
  ])(
    'requires both measurements strictly below their cutoffs: %j',
    (measurements) => {
      const shot = {
        ...candidate,
        measurements: { ...candidate.measurements, ...measurements },
      };
      expect(
        assessUnusualShots([...history, shot], [session]).get(shot.id),
      ).toMatchObject({ kind: 'assessed', unusual: false });
    },
  );

  it.each([null, 0, -1])(
    'abstains on missing or invalid range speed (%s) without substituting premium speed',
    (speedRange) => {
      const shot = {
        ...candidate,
        measurements: {
          ...candidate.measurements,
          speedRange,
          speedPremium: 90,
        },
      };
      expect(
        assessUnusualShots([...history, shot], [session]).get(shot.id),
      ).toMatchObject({ kind: 'abstained' });
      const unpaired = history.map((s, i) =>
        i ? s : { ...s, measurements: { ...s.measurements, speedRange } },
      );
      expect(
        assessUnusualShots([...unpaired, candidate], [session]).get(
          candidate.id,
        ),
      ).toMatchObject({ kind: 'abstained', baselineCount: 19 });
    },
  );

  it.each([
    { intent: 'partial' },
    { contact: 'mishit' },
    { exclusion: { kind: 'excluded', reason: 'test' } },
    { club: { kind: 'corrected', club: '8i' } },
  ] satisfies Partial<Review>[])(
    'does not use unsuitable or differently corrected baseline shots: %j',
    (review) => {
      const baseline = history.map((s, i) =>
        i ? s : { ...s, review: { ...s.review, ...review } },
      );
      expect(
        assessUnusualShots([...baseline, candidate], [session]).get(
          candidate.id,
        ),
      ).toMatchObject({ kind: 'abstained', baselineCount: 19 });
    },
  );

  it.each(['SW', '?', '5h', 'Driver'])(
    'leaves unsupported club %s alone',
    (recordedClub) => {
      const shots = [...history, candidate].map((s) => ({
        ...s,
        recordedClub,
      }));
      expect(assessUnusualShots(shots, [session]).size).toBe(0);
    },
  );

  it('honours corrected iron labels, full intent and club confirmation without treating confirmation as contact review', () => {
    const corrected = {
      ...candidate,
      recordedClub: '?',
      review: {
        ...candidate.review,
        intent: 'full',
        club: { kind: 'corrected', club: '7i' },
      },
    } satisfies typeof candidate;
    expect(
      assessUnusualShots([...history, corrected], [session]).get(candidate.id),
    ).toMatchObject({ kind: 'assessed', unusual: true });
    expect(
      assessUnusualShots(
        [
          ...history,
          {
            ...candidate,
            review: { ...candidate.review, club: { kind: 'confirmed' } },
          },
        ],
        [session],
      ).get(candidate.id),
    ).toMatchObject({ kind: 'assessed', unusual: true });
    expect(
      assessUnusualShots(
        [...history, candidate],
        [{ ...session, archived: true }],
      ).size,
    ).toBe(0);
  });

  it('uses strictly earlier timed sessions and keeps earlier assessments unchanged when later evidence is added', () => {
    const morning = { ...session, time: '09:00' };
    const afternoon = makeSession({ time: '14:00' });
    const sameTime = makeSession({ time: '14:00' });
    const shot = { ...candidate, sessionId: afternoon.id };
    const before = assessUnusualShots([...history, shot], [morning, afternoon]);
    expect(before.get(shot.id)).toMatchObject({
      kind: 'assessed',
      unusual: true,
      baselineCount: 20,
    });
    const later = history.map((s) => ({
      ...s,
      id: crypto.randomUUID(),
      sessionId: sameTime.id,
    }));
    expect(
      assessUnusualShots(
        [...history, shot, ...later],
        [morning, afternoon, sameTime],
      ).get(shot.id),
    ).toEqual(before.get(shot.id));
  });
});
