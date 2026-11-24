import { describe, expect, it } from 'vitest';
import { makeShot } from './fixtures';
import { initialReview, type Review } from './model';
import {
  analysisClub,
  resolveClub,
  resolveContact,
  resolveIntent,
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
