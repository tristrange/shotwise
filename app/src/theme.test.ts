import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('theme resolution', () => {
  it('defaults to the system preference until the user chooses', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });
  it('honours a saved choice over the system preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('garbage', true)).toBe('dark');
  });
});
