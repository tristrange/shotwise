import { describe, expect, it } from 'vitest';
import { makeSession, makeShot } from './fixtures';
import { initialReview, type Review, type Session, type Shot } from './model';
import {
  analysisClub,
  isFullSwingResolved,
  resolveClub,
  resolveContact,
  resolveIntent,
  resolveShots,
  resolvedClub,
  ASSESSMENT_VERSION,
} from './assessment';

const review = (overrides: Partial<Review>): Review => ({
  ...initialReview,
  ...overrides,
});

describe('assessment precedence (ADR-0001)', () => {
  it('prefers manual intent/contact, then automatic, then the default', () => {
    expect(resolveIntent('full', 'partial')).toBe('full');
    expect(resolveIntent('unknown', 'partial')).toBe('partial');
    expect(resolveIntent('unknown')).toBe('unknown');
    expect(resolveContact('mishit', 'typical')).toBe('mishit');
    expect(resolveContact('uncertain', 'typical')).toBe('typical');
    expect(resolveContact('uncertain')).toBe('uncertain');
  });

  it('manual club correction beats inference and recording', () => {
    const shot = makeShot({
      recordedClub: '7i',
      review: review({ club: { kind: 'corrected', club: '6i' } }),
    });
    const resolved = resolveClub(shot, '5i');
    expect(resolved).toEqual({
      kind: 'confirmed',
      club: '6i',
      provenance: 'manual',
    });
    expect(analysisClub(resolved)).toBe('6i');
  });

  it('manual confirmation keeps the recorded club', () => {
    const shot = makeShot({
      recordedClub: '7i',
      review: review({ club: { kind: 'confirmed' } }),
    });
    expect(resolveClub(shot, '5i')).toEqual({
      kind: 'confirmed',
      club: '7i',
      provenance: 'manual',
    });
  });

  it('unreviewed shots take a provisional inferred club, never overwriting the recording', () => {
    const shot = makeShot({ recordedClub: '7i' });
    const resolved = resolveClub(shot, '6i');
    expect(resolved).toEqual({
      kind: 'inferred',
      club: '6i',
      provenance: 'automatic',
      provisional: true,
    });
    // The recorded label is untouched.
    expect(shot.recordedClub).toBe('7i');
    expect(shot.review.club.kind).toBe('unreviewed');
  });

  it('falls back to the recorded club when there is no usable inference', () => {
    const shot = makeShot({ recordedClub: '9i' });
    expect(resolveClub(shot)).toEqual({
      kind: 'recorded',
      club: '9i',
      provenance: 'recorded',
    });
    expect(resolveClub(shot, '?')).toMatchObject({ kind: 'recorded' });
    expect(resolveClub(shot, '  ')).toMatchObject({ kind: 'recorded' });
  });
});

describe('resolveShots (PR 10 analytics wiring)', () => {
  const early = makeSession({ id: 'early', date: '2026-11-01' });
  const late = makeSession({ id: 'late', date: '2026-11-16' });
  const sessions = [early, late];
  const history = (club: string, carry: number, speed: number, session = early) =>
    Array.from({ length: 12 }, (_, i) =>
      makeShot({
        sessionId: session.id,
        rowIndex: i + 1,
        recordedClub: club,
        measurements: { flatCarryPremium: carry, speedPremium: speed },
      }),
    );

  it('resolves automatic intent/contact when unreviewed and keeps manual review authoritative', () => {
    const shots: Shot[] = [
      ...history('7i', 150, 200),
      makeShot({
        id: 'normal',
        sessionId: late.id,
        rowIndex: 1,
        measurements: { flatCarryPremium: 150, speedPremium: 200 },
      }),
      makeShot({
        id: 'low',
        sessionId: late.id,
        rowIndex: 2,
        measurements: { flatCarryPremium: 50, speedPremium: 80 },
      }),
      makeShot({
        id: 'low-reviewed',
        sessionId: late.id,
        rowIndex: 3,
        measurements: { flatCarryPremium: 50, speedPremium: 80 },
        review: { contact: 'typical' },
      }),
    ];
    const before = structuredClone(shots);
    const resolved = resolveShots(shots, sessions, 'premium-flat');
    expect(resolved.get('normal')).toMatchObject({
      intent: 'full',
      contact: 'typical',
      club: { kind: 'recorded', club: '7i', provenance: 'recorded' },
      suspectedWrongClub: false,
      assessmentVersion: ASSESSMENT_VERSION,
    });
    expect(resolved.get('low')?.contact).toBe('mishit');
    expect(resolved.get('low-reviewed')?.contact).toBe('typical');
    // Derived only: shots and reviews are untouched.
    expect(shots).toEqual(before);
  });

  it('infers a provisional club for unknown labels and flags suspected wrong clubs', () => {
    const shots: Shot[] = [
      ...history('7i', 150, 200),
      ...history('8i', 140, 190),
      // A genuine 9i profile, well separated from the 8i measurements.
      ...history('9i', 120, 170),
      // Unknown label surrounded by 7i shots with matching measurements.
      makeShot({
        id: 'unknown',
        sessionId: late.id,
        rowIndex: 1,
        recordedClub: '?',
        measurements: { flatCarryPremium: 150, speedPremium: 200 },
      }),
      ...history('7i', 150, 200, late).map((s, i) => ({
        ...s,
        id: `late-7i-${i}`,
        rowIndex: i + 2,
      })),
      // A long 9i-labelled run whose measurements match 8i: forgotten switch.
      ...Array.from({ length: 10 }, (_, i) =>
        makeShot({
          id: `wrong-${i}`,
          sessionId: late.id,
          rowIndex: 20 + i,
          recordedClub: '9i',
          measurements: { flatCarryPremium: 140, speedPremium: 190 },
        }),
      ),
    ];
    const resolved = resolveShots(shots, sessions, 'premium-flat');
    const unknown = resolved.get('unknown');
    expect(unknown?.club).toEqual({
      kind: 'inferred',
      club: '7i',
      provenance: 'automatic',
      provisional: true,
    });
    expect(resolvedClub(unknown!)).toBe('7i');
    expect(isFullSwingResolved(unknown!)).toBe(true);
    const wrong = resolved.get('wrong-3');
    expect(wrong?.suspectedWrongClub).toBe(true);
    // The recorded label is kept, never reassigned.
    expect(wrong?.club).toMatchObject({ kind: 'recorded', club: '9i' });
  });

  it('abstains without enough history and falls back to the recorded defaults', () => {
    const session: Session = makeSession({ id: 'solo', date: '2026-11-16' });
    const shots = [
      makeShot({
        id: 's1',
        sessionId: session.id,
        rowIndex: 1,
        recordedClub: 'SW',
        measurements: { flatCarryPremium: 90, speedPremium: 150 },
      }),
    ];
    const resolved = resolveShots(shots, [session], 'premium-flat');
    expect(resolved.get('s1')).toMatchObject({
      intent: 'unknown',
      contact: 'uncertain',
      club: { kind: 'recorded', club: 'SW', provenance: 'recorded' },
    });
    // Unknown intent on a higher wedge is not treated as a full swing.
    expect(isFullSwingResolved(resolved.get('s1')!)).toBe(false);
  });
});
