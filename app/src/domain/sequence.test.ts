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

  it('abstains on an exact tie between two candidate clubs (same-level comparison)', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 12 }, () => shot('9i', 120, 118)), // 9i profile
      // Eight 9i-labelled shots at wood distances: seven at 240/210, one at 235/205.
      ...Array.from({ length: 7 }, () => shot('9i', 240, 210)),
      shot('9i', 235, 205),
      ...Array.from({ length: 12 }, () => shot('D', 240, 210)), // D profile
      ...Array.from({ length: 12 }, () => shot('3w', 240, 210)), // identical 3w profile
    ];
    const out = assessSequences(shots, [session]);
    // D and 3w tie exactly: no clear margin, so nothing is flagged.
    for (const s of shots.slice(12, 20)) expect(out.get(s.id)).toBeUndefined();
  });

  it('splits own-compatible shots out of a suspect block instead of discarding it', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 20 }, () => shot('9i', 120, 118)), // 9i profile
      shot('9i', 130, 125), // overlaps: fits 9i and is adjacent to the suspect block
      ...Array.from({ length: 8 }, () => shot('9i', 150, 140)), // labelled 9i, 7i distances
      ...Array.from({ length: 12 }, () => shot('7i', 150, 140)), // 7i profile
    ];
    const out = assessSequences(shots, [session]);
    // The overlapping 130/125 shot must not make the eight suspect shots disappear.
    const flagged = shots.slice(21, 29);
    for (const s of flagged) {
      const a = out.get(s.id);
      expect(a?.kind).toBe('suspected-wrong-club');
      if (a?.kind === 'suspected-wrong-club') expect(a.suspectedClub).toBe('7i');
    }
    // The genuinely 9i-compatible shot is not flagged.
    expect(out.get(shots[20]!.id)).toBeUndefined();
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

  it('is append-stable: later active or archived visits never change earlier results', () => {
    const early = makeSession({ id: 'early', date: '2026-10-01' });
    const shots = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeShot({
          sessionId: early.id,
          rowIndex: i + 1,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 160, speedPremium: 150 },
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeShot({
          sessionId: early.id,
          rowIndex: 11 + i,
          recordedClub: '?',
          measurements: { flatCarryPremium: 160, speedPremium: 150 },
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeShot({
          sessionId: early.id,
          rowIndex: 14 + i,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 161, speedPremium: 151 },
        }),
      ),
    ];
    const before = assessSequences(shots, [early], 'premium-flat');
    const unknownIds = shots.slice(10, 13).map((s) => s.id);
    for (const id of unknownIds) {
      expect(before.get(id)?.kind).toBe('inferred-club');
    }
    // A later active visit with a very different 7i distribution.
    const later = makeSession({ id: 'later', date: '2026-11-16' });
    const laterShots = Array.from({ length: 10 }, (_, i) =>
      makeShot({
        sessionId: later.id,
        rowIndex: i + 1,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 200, speedPremium: 220 },
      }),
    );
    const afterActive = assessSequences([...shots, ...laterShots], [early, later], 'premium-flat');
    for (const id of unknownIds) expect(afterActive.get(id)).toEqual(before.get(id));
    // An archived visit 62 days later must not move any window either.
    const archived = makeSession({ id: 'arch', date: '2026-12-02', archived: true });
    const archivedShots = Array.from({ length: 10 }, (_, i) =>
      makeShot({
        sessionId: archived.id,
        rowIndex: i + 1,
        recordedClub: '7i',
        measurements: { flatCarryPremium: 90, speedPremium: 90 },
      }),
    );
    const afterArchived = assessSequences(
      [...shots, ...laterShots, ...archivedShots],
      [early, later, archived],
      'premium-flat',
    );
    for (const id of unknownIds) expect(afterArchived.get(id)).toEqual(before.get(id));
  });

  it('is invariant under input permutation', () => {
    const shots = missingLabelBlock(159, 149);
    const base = assessSequences(shots, [session], 'premium-flat');
    const shuffled = [...shots].reverse();
    const out = assessSequences(shuffled, [session], 'premium-flat');
    for (const s of shots) expect(out.get(s.id)).toEqual(base.get(s.id));
  });

  it('abstains on an exact tie between two neighbouring clubs', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
      ...Array.from({ length: 3 }, () => shot('?', 160, 150)),
      ...Array.from({ length: 10 }, () => shot('6i', 160, 150)), // identical profile
    ];
    const out = assessSequences(shots, [session]);
    for (const s of shots.slice(10, 13)) expect(out.get(s.id)!.kind).toBe('abstained');
  });

  it('enforces the minimum sample on whichever profile source is used', () => {
    row = 0;
    const shots = [
      shot('7i', 160, 150),
      shot('7i', 161, 151),
      shot('?', 160, 150),
    ];
    const out = assessSequences(shots, [session]);
    // Only 2 labelled 7i shots exist anywhere — below MIN_PROFILE on both sources.
    expect(out.get(shots[2]!.id)!.kind).toBe('abstained');
  });

  it('infers a poor strike as the surrounding club, not a club change', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
      shot('?', 40, 60), // a very short mishit inside the 7i block
      ...Array.from({ length: 10 }, () => shot('7i', 161, 151)),
    ];
    const out = assessSequences(shots, [session]);
    const a = out.get(shots[10]!.id)!;
    expect(a.kind).toBe('inferred-club');
    if (a.kind === 'inferred-club') {
      expect(a.club).toBe('7i');
      expect(a.reason).toContain('poor');
    }
  });

  it('flags a short matching block as advisory, never exclusion-grade', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 12 }, () => shot('9i', 120, 118)),
      ...Array.from({ length: 5 }, () => shot('9i', 235, 205)), // 5-shot forgotten switch
      ...Array.from({ length: 12 }, () => shot('D', 240, 210)),
    ];
    const out = assessSequences(shots, [session]);
    const flagged = shots.slice(12, 17);
    for (const s of flagged) {
      const a = out.get(s.id)!;
      expect(a.kind).toBe('suspected-wrong-club');
      if (a.kind === 'suspected-wrong-club') expect(a.strength).toBe('advisory');
    }
  });

  it('keeps advisory suspicions out of benchmark exclusion in resolveShots', async () => {
    const { resolveShots } = await import('./assessment');
    row = 0;
    const shots = [
      ...Array.from({ length: 12 }, () => shot('9i', 120, 118)),
      ...Array.from({ length: 5 }, () => shot('9i', 235, 205)),
      ...Array.from({ length: 12 }, () => shot('D', 240, 210)),
    ];
    const resolved = resolveShots(shots, [session], 'premium-flat');
    const a = resolved.get(shots[12]!.id)!;
    expect(a.suspicion?.strength).toBe('advisory');
    expect(a.suspectedWrongClub).toBe(false);
  });

  it('excludes reviewed mishits and partials from reference profiles', () => {
    row = 0;
    const shots = [
      ...Array.from({ length: 10 }, () => shot('7i', 160, 150)),
      // Reviewed mishits inside the 7i block must not move the 7i profile.
      ...Array.from({ length: 4 }, () =>
        makeShot({
          sessionId: session.id,
          rowIndex: ++row,
          recordedClub: '7i',
          measurements: { flatCarryPremium: 40, speedPremium: 60 },
          review: review({ contact: 'mishit' }),
        }),
      ),
      ...Array.from({ length: 3 }, () => shot('?', 160, 150)),
      ...Array.from({ length: 10 }, () => shot('7i', 161, 151)),
    ];
    const out = assessSequences(shots, [session]);
    const a = out.get(shots[14]!.id)!;
    expect(a.kind).toBe('inferred-club');
    if (a.kind === 'inferred-club') {
      expect(a.club).toBe('7i');
      // 20 labelled 7i shots, not 24 — the reviewed mishits are excluded.
      expect(a.evidence).toBe(20);
    }
  });
});
