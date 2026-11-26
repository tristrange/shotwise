import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

/**
 * Guards the design tokens in styles/tokens.css: semantic colour pairs must
 * keep WCAG AA contrast (4.5:1 for text, 3:1 for graphical/semantic colour)
 * in both themes, so a palette edit cannot silently break readability.
 */

const tokensCss = new URL('./styles/tokens.css', import.meta.url);

type Theme = 'light' | 'dark';

function parseTokens(css: string): Record<Theme, Record<string, string>> {
  const block = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
    if (!match?.[1]) throw new Error(`missing block ${selector}`);
    const vars: Record<string, string> = {};
    for (const entry of match[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
      const name = entry[1]!;
      const value = entry[2]!;
      vars[name] = value.toLowerCase();
    }
    return vars;
  };
  return { light: block(':root'), dark: block(":root[data-theme='dark']") };
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}
function contrast(a: string, b: string) {
  const lum = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lum[0]! + 0.05) / (lum[1]! + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['--text', '--bg'],
  ['--text', '--surface'],
  ['--text-2', '--bg'],
  ['--text-2', '--surface'],
  ['--text-3', '--bg'],
  ['--text-3', '--surface'],
  ['--brand', '--bg'],
  ['--brand', '--surface'],
  ['--focus', '--bg'],
  // semantic hues used as small status TEXT (deltas, badges) need full AA
  ['--pos-text', '--bg'],
  ['--pos-text', '--surface'],
  ['--warn-text', '--bg'],
  ['--warn-text', '--surface'],
  ['--neg-text', '--bg'],
  ['--neg-text', '--surface'],
];
const GRAPHIC_PAIRS: [string, string][] = [
  ['--data', '--surface'],
  ['--compare', '--surface'],
  ['--pos', '--surface'],
  ['--warn', '--surface'],
  ['--neg', '--surface'],
];

describe('design tokens', () => {
  it('keep WCAG AA text contrast (4.5:1) in both themes', async () => {
    const { light, dark } = parseTokens(await readFile(tokensCss, 'utf8'));
    for (const theme of [light, dark] as const) {
      for (const [fg, bg] of TEXT_PAIRS) {
        expect(theme[fg], `${fg} missing`).toBeTruthy();
        expect(contrast(theme[fg]!, theme[bg]!), `${fg} on ${bg} (${theme === light ? 'light' : 'dark'})`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keep 3:1 contrast for chart series and semantic colour on surfaces', async () => {
    const { light, dark } = parseTokens(await readFile(tokensCss, 'utf8'));
    for (const theme of [light, dark] as const) {
      for (const [fg, bg] of GRAPHIC_PAIRS) {
        expect(contrast(theme[fg]!, theme[bg]!), `${fg} on ${bg} (${theme === light ? 'light' : 'dark'})`)
          .toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('defines the same token set in both themes', async () => {
    const { light, dark } = parseTokens(await readFile(tokensCss, 'utf8'));
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});
