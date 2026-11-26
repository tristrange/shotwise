import { describe, expect, it } from 'vitest';
import { clubDisplayName } from './clubNames';

describe('clubDisplayName', () => {
  it('expands abbreviated labels into readable names', () => {
    expect(clubDisplayName('D')).toBe('Driver');
    expect(clubDisplayName('dr')).toBe('Driver');
    expect(clubDisplayName('1w')).toBe('Driver');
    expect(clubDisplayName('3w')).toBe('3 wood');
    expect(clubDisplayName('4h')).toBe('4 hybrid');
    expect(clubDisplayName('7i')).toBe('7 iron');
    expect(clubDisplayName('9i')).toBe('9 iron');
    expect(clubDisplayName('PW')).toBe('Pitching wedge');
    expect(clubDisplayName('sw')).toBe('Sand wedge');
    expect(clubDisplayName('60')).toBe('60° wedge');
    expect(clubDisplayName('60°')).toBe('60° wedge');
  });

  it('keeps unknown labels as recorded', () => {
    expect(clubDisplayName('custom-thing')).toBe('custom-thing');
    expect(clubDisplayName(' 7i ')).toBe('7 iron');
  });
});
