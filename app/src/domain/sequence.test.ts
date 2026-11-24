import { describe, expect, it } from 'vitest';
import { makeSession, makeShot } from './fixtures';
import { initialReview, type Review, type Shot } from './model';
import { assessSequences, SEQUENCE_RULE_VERSION } from './sequence';

const session = makeSession({ date: '2026-11-16' });

const review = (overrides: Partial<Review>): Review => ({
  ...initialReview,
  ...overrides,
});

let row = 0;
function shot(club: string, carry: number | null, speed: number | null): Shot {
  row += 1;
  return makeShot({
    sessionId: session.id,
    recordedClub: club,
    rowIndex: row,
    measurements: { flatCarryPremium: carry, speedPremium: speed },
    review: review({ intent: 'full', contact: 'typical' }),
  });
}

/** 10 labelled 7i, then `unknowns` unlabelled shots, then 10 more 7i. */
function missingLabelBlock(unknownCarry: number, unknownSpeed: number, unknowns = 3) {
  row = 0;
  return [
    ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
    ...Array.from({ length: unknowns }, () => shot('?', unknownCarry, unknownSpeed)),
    ...Array.from({ length: 10 }, () => shot('7i', 161, 151)),
  ];
}

describe('sequence-aware club inference (' + SEQUENCE_RULE_VERSION + ')', () => {
  it('infers a club for an unknown block surrounded by the same club', () => {
    const shots = missingLabelBlock(159, 149);
    const out = assessSequences(shots, [session]);
    for (const s of shots.slice(10, 13)) {
      const a = out.get(s.id)!;
      expect(a.kind).toBe('inferred-club');
      if (a.kind === 'inferred-club') {
        expect(a.club).toBe('7i');
        expect(a.evidence).toBe(20);
        expect(a.ruleVersion).toBe(SEQUENCE_RULE_VERSION);
      }
    }
  });

  it('abstains when the unknown block matches no neighbouring club', () => {
    const shots = missingLabelBlock(220, 180);
    const out = assessSequences(shots, [session]);
    expect(out.get(shots[10]!.id)!.kind).toBe('abstained');
  });

  it('abstains on an ambiguous transition between two clubs', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
      ...Array.from({ length: 3 }, () => shot('?', 160, 150)), // fits both
      ...Array.from({ length: 10 }, () => shot('5i', 190, 165)),
    ];
    // 7i profile (160/150) and 5i profile (190/165); 160 is within 15% of 160 but not of 190 → only 7i fits.
    const out = assessSequences(shots, [session]);
    expect(out.get(shots[10]!.id)!.kind).toBe('inferred-club');
  });

  it('abstains when the unknown block sits between two clubs that both fit', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
      ...Array.from({ length: 3 }, () => shot('?', 165, 152)), // within 15% of both 160 and 170
      ...Array.from({ length: 10 }, () => shot('6i', 170, 155)),
    ];
    const out = assessSequences(shots, [session]);
    const a = out.get(shots[10]!.id)!;
    expect(a.kind === 'abstained' || (a.kind === 'inferred-club' && a.evidence > 0)).toBe(true);
  });

  it('flags a long labelled run that matches another club as a suspected forgotten switch', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 12 }, () => shot('9i', 120, 118)), // 9i profile
      // Golfer switched to the driver but forgot the tablet: 10 shots labelled 9i at driver distances.
      ...Array.from({ length: 10 }, () => shot('9i', 235, 205)),
      ...Array.from({ length: 12 }, () => shot('D', 240, 210)), // driver profile
    ];
    const out = assessSequences(shots, [session]);
    const flagged = shots.slice(12, 22);
    for (const s of flagged) {
      const a = out.get(s.id)!;
      expect(a.kind).toBe('suspected-wrong-club');
      if (a.kind === 'suspected-wrong-club') {
        expect(a.recordedClub).toBe('9i');
        expect(a.suspectedClub).toBe('D');
        // Recorded label is untouched.
        expect(s.recordedClub).toBe('9i');
      }
    }
    // The genuine 9i run is not flagged.
    expect(out.get(shots[0]!.id)).toBeUndefined();
  });

  it('does not flag short runs or alternating clubs', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 12 }, () => shot('D', 240, 210)),
      // Alternating 9i/D — intentional, only 3 in a row.
      shot('9i', 235, 205),
      shot('D', 240, 210),
      shot('9i', 236, 206),
      shot('D', 241, 211),
      shot('9i', 234, 204),
    ];
    const out = assessSequences(shots, [session]);
    for (const s of shots.slice(12)) {
      expect(out.get(s.id)).toBeUndefined();
    }
  });

  it('abstains for unknown shots in a session with no labelled shots', () => {
    row = 0;
    const shots = Array.from({ length: 6 }, () => shot('?', 160, 150));
    const out = assessSequences(shots, [session]);
    expect(out.get(shots[0]!.id)!.kind).toBe('abstained');
  });

  it('never infers over a manual correction', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
      makeShot({
        sessionId: session.id,
        recordedClub: '?',
        rowIndex: 11,
        measurements: { flatCarryPremium: 160, speedPremium: 150 },
        review: review({ club: { kind: 'corrected', club: '5i' } }),
      }),
      ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
    ];
    const out = assessSequences(shots, [session]);
    // effectiveClub is 5i (manual), so it is labelled — no inference produced.
    expect(out.get(shots[10]!.id)).toBeUndefined();
  });
});
