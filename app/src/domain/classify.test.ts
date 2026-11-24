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

  it('flags short wedge shots as likely partial but well struck', () => {
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
    const partial = out.get(shots.at(-1)!.id)!;
    expect(partial.intent.value).toBe('partial');
    expect(partial.contact.value).toBe('typical');
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
});
