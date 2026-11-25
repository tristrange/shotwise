import { describe, expect, it } from 'vitest';
import { makeSession, makeShot } from './fixtures';
import { initialReview, type Review, type Shot } from './model';
import { assessShots, CLASSIFIER_VERSION } from './classify';
import { resolveContact, resolveIntent } from './assessment';

const session = makeSession({ date: '2026-11-16' });
const older = makeSession({ date: '2026-11-10' });

const review = (overrides: Partial<Review>): Review => ({
  ...initialReview,
  ...overrides,
});

function fullShots(club: string, carry: number, speed: number, count: number, sess = session): Shot[] {
  return Array.from({ length: count }, (_, i) =>
    makeShot({
      sessionId: sess.id,
      recordedClub: club,
      rowIndex: i + 1,
      measurements: { flatCarryPremium: carry, speedPremium: speed },
      review: review({ intent: 'full', contact: 'typical' }),
    }),
  );
}

describe('automatic shot assessment (classifier ' + CLASSIFIER_VERSION + ')', () => {
  it('assesses legit full swings as full/typical and severe mishits as mishit', () => {
    const shots = [
      ...fullShots('7i', 160, 150, 12),
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: 20,
        measurements: { flatCarryPremium: 90, speedPremium: 100 },
      }),
    ];
    const out = assessShots(shots, [session]);
    const mishit = out.get(shots.at(-1)!.id)!;
    expect(mishit.contact.value).toBe('mishit');
    expect(mishit.intent.value).toBe('full');
    // Causal baseline: only the 12 earlier shots count.
    expect(mishit.baselineCount).toBe(12);
    expect(mishit.classifierVersion).toBe(CLASSIFIER_VERSION);
    // A shot with >= 10 earlier shots gets a full assessment.
    const good = out.get(shots[11]!.id)!;
    expect(good.contact.value).toBe('typical');
    expect(good.intent.value).toBe('full');
    // Early shots with thin causal history abstain.
    expect(out.get(shots[0]!.id)!.contact.value).toBe('uncertain');
    expect(out.get(shots[5]!.id)!.contact.value).toBe('uncertain');
  });

  it('flags a clean short wedge shot as likely partial and well struck', () => {
    const shots = [
      ...fullShots('SW', 100, 90, 12),
      makeShot({
        sessionId: session.id,
        recordedClub: 'SW',
        rowIndex: 20,
        measurements: { flatCarryPremium: 60, speedPremium: 88 },
      }),
    ];
    const out = assessShots(shots, [session]);
    const partial = out.get(shots.at(-1)!.id)!;
    expect(partial.intent.value).toBe('partial');
    expect(partial.contact.value).toBe('typical');
  });

  it('does not read a clean partial’s naturally lower apex as low flight', () => {
    const baseline = Array.from({ length: 12 }, (_, i) =>
      makeShot({
        sessionId: session.id,
        recordedClub: 'SW',
        rowIndex: i + 1,
        measurements: {
          flatCarryPremium: 100,
          speedPremium: 130,
          launchPremium: 35,
          apexPremium: 30,
        },
      }),
    );
    // Clean 60% partial: same launch, proportionally lower apex.
    const partial = makeShot({
      sessionId: session.id,
      recordedClub: 'SW',
      rowIndex: 20,
      measurements: {
        flatCarryPremium: 60,
        speedPremium: 110,
        launchPremium: 35,
        apexPremium: 16,
      },
    });
    const out = assessShots([...baseline, partial], [session]);
    expect(out.get(partial.id)!.intent.value).toBe('partial');
    expect(out.get(partial.id)!.contact.value).toBe('typical');
    // A genuine dud at the same distance stays a mishit (very low launch/apex).
    const dud = makeShot({
      sessionId: session.id,
      recordedClub: 'SW',
      rowIndex: 21,
      measurements: {
        flatCarryPremium: 45,
        speedPremium: 140,
        launchPremium: 2,
        apexPremium: 1,
      },
    });
    const out2 = assessShots([...baseline, partial, dud], [session]);
    expect(out2.get(dud.id)!.contact.value).toBe('mishit');
  });

  it('keeps a chunked partial representable as partial and mishit', () => {
    const shots = [
      ...fullShots('SW', 100, 90, 12),
      makeShot({
        sessionId: session.id,
        recordedClub: 'SW',
        rowIndex: 20,
        measurements: { flatCarryPremium: 45, speedPremium: 55 },
      }),
    ];
    const out = assessShots(shots, [session]);
    const chunked = out.get(shots.at(-1)!.id)!;
    expect(chunked.intent.value).toBe('partial');
    expect(chunked.contact.value).toBe('mishit');
  });

  it('catches a low-flight full strike with retained ball speed as a mishit', () => {
    const baseline = Array.from({ length: 12 }, (_, i) =>
      makeShot({
        sessionId: session.id,
        recordedClub: 'PW',
        rowIndex: i + 1,
        measurements: {
          flatCarryPremium: 110,
          speedPremium: 150,
          launchPremium: 13,
          apexPremium: 30,
        },
        review: review({ intent: 'full', contact: 'typical' }),
      }),
    );
    const duff = makeShot({
      sessionId: session.id,
      recordedClub: 'PW',
      rowIndex: 20,
      measurements: {
        flatCarryPremium: 45,
        speedPremium: 140,
        launchPremium: 2,
        apexPremium: 1,
      },
    });
    const out = assessShots([...baseline, duff], [session]);
    const assessed = out.get(duff.id)!;
    // Low flight, not distance control: intent stays full, contact is a mishit
    // even though ball speed was retained.
    expect(assessed.intent.value).toBe('full');
    expect(assessed.contact.value).toBe('mishit');
  });

  it('distinguishes a likely partial PW from a full PW', () => {
    const baseline = Array.from({ length: 12 }, (_, i) =>
      makeShot({
        sessionId: session.id,
        recordedClub: 'PW',
        rowIndex: i + 1,
        measurements: {
          flatCarryPremium: 120,
          speedPremium: 110,
          launchPremium: 12,
          apexPremium: 25,
        },
        review: review({ intent: 'full', contact: 'typical' }),
      }),
    );
    const partial = makeShot({
      sessionId: session.id,
      recordedClub: 'PW',
      rowIndex: 20,
      measurements: {
        flatCarryPremium: 70,
        speedPremium: 105,
        launchPremium: 12,
        apexPremium: 24,
      },
    });
    const out = assessShots([...baseline, partial], [session]);
    const assessed = out.get(partial.id)!;
    expect(assessed.intent.value).toBe('partial');
    expect(assessed.contact.value).toBe('typical');
  });

  it('abstains wedge intent when carry is missing', () => {
    const shots = [
      ...fullShots('SW', 100, 90, 12),
      makeShot({
        sessionId: session.id,
        recordedClub: 'SW',
        rowIndex: 20,
        measurements: { flatCarryPremium: null, speedPremium: 90 },
      }),
    ];
    const out = assessShots(shots, [session]);
    const last = out.get(shots.at(-1)!.id)!;
    expect(last.intent.value).toBe('unknown');
    expect(last.contact.value).toBe('uncertain');
  });

  it('treats PW as iron-style full, not partial', () => {
    const shots = [
      ...fullShots('PW', 120, 110, 12),
      makeShot({
        sessionId: session.id,
        recordedClub: 'PW',
        rowIndex: 20,
        measurements: { flatCarryPremium: 118, speedPremium: 108 },
      }),
    ];
    const out = assessShots(shots, [session]);
    expect(out.get(shots.at(-1)!.id)!.intent.value).toBe('full');
  });

  it('abstains on sparse history and unknown clubs', () => {
    const shots = [
      ...fullShots('7i', 160, 150, 5),
      makeShot({
        sessionId: session.id,
        recordedClub: '?',
        rowIndex: 20,
        measurements: { flatCarryPremium: 160, speedPremium: 150 },
      }),
    ];
    const out = assessShots(shots, [session]);
    const thin = out.get(shots[0]!.id)!;
    expect(thin.contact.value).toBe('uncertain');
    expect(thin.intent.value).toBe('unknown');
    expect(thin.baselineCount).toBeLessThan(10);
    const unknown = out.get(shots.at(-1)!.id)!;
    expect(unknown.intent.value).toBe('unknown');
    expect(unknown.contact.value).toBe('uncertain');
  });

  it('abstains when carry or speed is missing', () => {
    const shots = [
      ...fullShots('7i', 160, 150, 12),
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: 20,
        measurements: { flatCarryPremium: 160, speedPremium: null },
      }),
    ];
    const out = assessShots(shots, [session]);
    expect(out.get(shots.at(-1)!.id)!.contact.value).toBe('uncertain');
  });

  it('keeps manual review authoritative via the ADR-0001 resolvers', () => {
    const shots = [
      ...fullShots('7i', 160, 150, 12),
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: 20,
        measurements: { flatCarryPremium: 90, speedPremium: 100 },
        review: review({ intent: 'partial', contact: 'typical' }),
      }),
    ];
    const out = assessShots(shots, [session]);
    const shot = shots.at(-1)!;
    const auto = out.get(shot.id)!;
    expect(auto.contact.value).toBe('mishit');
    // Manual 'typical' wins over the automatic 'mishit'.
    expect(resolveContact(shot.review.contact, auto.contact.value)).toBe('typical');
    expect(resolveIntent(shot.review.intent, auto.intent.value)).toBe('partial');
    // Unreviewed shots adopt the automatic assessment.
    const unreviewed = shots[0]!;
    expect(resolveIntent(unreviewed.review.intent, out.get(unreviewed.id)!.intent.value)).toBe('full');
  });

  it('uses a recent causal window for baselines', () => {
    const oldShots = fullShots('7i', 120, 100, 12, older);
    const ancient = makeSession({ date: '2026-01-01' });
    const ancientShots = fullShots('7i', 90, 70, 12, ancient);
    const newShots = fullShots('7i', 170, 160, 12);
    const out = assessShots([...ancientShots, ...oldShots, ...newShots], [ancient, older, session]);
    // For a shot on 2026-11-16, the 2026-01-01 session is outside the 60-day window.
    expect(out.get(newShots[5]!.id)!.baselineCount).toBe(12 + 5);
  });

  it('counts unambiguously earlier same-day visits, but not same-time or timeless ones', () => {
    const morning = makeSession({ id: 'morning', date: '2026-11-16', time: '09:00' });
    const evening = makeSession({ id: 'evening', date: '2026-11-16', time: '18:00' });
    const morningShots = fullShots('7i', 160, 150, 12, morning);
    const eveningShots = fullShots('7i', 160, 150, 3, evening);
    const probe = makeShot({
      sessionId: evening.id,
      recordedClub: '7i',
      rowIndex: 20,
      measurements: { flatCarryPremium: 90, speedPremium: 100 },
    });
    const out = assessShots([...eveningShots, ...morningShots, probe], [evening, morning]);
    // 12 morning shots + the 3 earlier evening shots form the causal baseline.
    expect(out.get(probe.id)!.baselineCount).toBe(15);
    expect(out.get(probe.id)!.contact.value).toBe('mishit');
    // A same-start-time visit is not unambiguously earlier: excluded.
    const sameTime = makeSession({ id: 'sametime', date: '2026-11-16', time: '18:00' });
    const sameTimeShots = fullShots('7i', 160, 150, 5, sameTime);
    const out2 = assessShots(
      [...eveningShots, ...morningShots, ...sameTimeShots, probe],
      [evening, morning, sameTime],
    );
    expect(out2.get(probe.id)!.baselineCount).toBe(15);
    // A timeless same-day visit is also excluded (order unknowable).
    const timeless = makeSession({ id: 'timeless', date: '2026-11-16', time: null });
    const timelessShots = fullShots('7i', 160, 150, 5, timeless);
    const out3 = assessShots(
      [...eveningShots, ...morningShots, ...timelessShots, probe],
      [evening, morning, timeless],
    );
    expect(out3.get(probe.id)!.baselineCount).toBe(15);
  });

  it('keeps a transitive visit order when same-day times mix known and missing', () => {
    // a=12:00, b=null, c=10:00 on the same date: with a consistent ordering
    // (missing time first), c is unambiguously earlier than a, and the
    // baseline must not depend on input permutation.
    const a = makeSession({ id: 'a', date: '2026-11-16', time: '12:00' });
    const b = makeSession({ id: 'b', date: '2026-11-16', time: null });
    const c = makeSession({ id: 'c', date: '2026-11-16', time: '10:00' });
    const blockA = fullShots('7i', 160, 150, 10, a);
    const blockB = fullShots('7i', 170, 160, 10, b);
    const blockC = fullShots('7i', 150, 140, 10, c);
    const probe = makeShot({
      sessionId: a.id,
      recordedClub: '7i',
      rowIndex: 50,
      measurements: { flatCarryPremium: 90, speedPremium: 100 },
    });
    const forward = assessShots([...blockA, ...blockB, ...blockC, probe], [a, b, c]);
    const shuffled = assessShots([probe, ...blockB, ...blockC, ...blockA], [b, c, a]);
    // The probe's own earlier a-shots (10) plus c (10:00 < 12:00) count;
    // b's missing time is not evidence of being earlier, so it is excluded.
    expect(forward.get(probe.id)!.baselineCount).toBe(20);
    expect(shuffled.get(probe.id)).toEqual(forward.get(probe.id));
  });

  it('picks a deterministic baseline at the 50-shot cap regardless of input order', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      makeShot({
        sessionId: session.id,
        recordedClub: '7i',
        rowIndex: i + 1,
        measurements: { flatCarryPremium: 150 + (i % 7), speedPremium: 150 },
        review: review({ intent: 'full', contact: 'typical' }),
      }),
    );
    const probe = makeShot({
      sessionId: session.id,
      recordedClub: '7i',
      rowIndex: 99,
      measurements: { flatCarryPremium: 160, speedPremium: 150 },
    });
    const forward = assessShots([...many, probe], [session]);
    expect(forward.get(probe.id)!.baselineCount).toBe(50);
    // Same selected baseline (median, P75 and reasons) under permutation.
    const shuffled = assessShots([probe, ...[...many].reverse()], [session]);
    expect(shuffled.get(probe.id)).toEqual(forward.get(probe.id));
  });
});
