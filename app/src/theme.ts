export type Theme = 'light' | 'dark';
export const THEME_KEY = 'shotwise-theme';

/** No saved choice means the system preference wins. */
export function resolveTheme(saved: string | null, prefersDark: boolean): Theme {
  if (saved === 'light' || saved === 'dark') return saved;
  return prefersDark ? 'dark' : 'light';
}
