import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const publicDir = new URL('../public/', import.meta.url);

type Manifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

function pngSize(buffer: Buffer): { width: number; height: number } {
  // PNG signature is 8 bytes; the first chunk is IHDR with width/height at bytes 16..24.
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('PWA installability assets', () => {
  it('ships a valid web app manifest with standalone display', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('manifest.webmanifest', publicDir), 'utf8'),
    ) as Manifest;
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    // Relative URLs keep the manifest working under the /shotwise/ Pages base path.
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    const purposes = manifest.icons.map((icon) => icon.purpose ?? 'any');
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
  });

  it('references icon files that exist with their declared sizes', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('manifest.webmanifest', publicDir), 'utf8'),
    ) as Manifest;
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const buffer = await readFile(new URL(icon.src, publicDir));
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(buffer)).toEqual({ width, height });
    }
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('ships an Apple touch icon at 180x180', async () => {
    const buffer = await readFile(new URL('apple-touch-icon.png', publicDir));
    expect(pngSize(buffer)).toEqual({ width: 180, height: 180 });
  });

  it('keeps the header and sticky navigation clear of the iOS status-bar safe area', async () => {
    // In standalone mode (black-translucent) web content extends under the
    // status bar, so both the header and the sticky nav need safe-area-inset-top.
    const css = await readFile(
      new URL('../src/styles.css', import.meta.url),
      'utf8',
    );
    const block = (selector: string) => {
      const match = css.match(
        new RegExp(`^\\s*${selector}\\s*\\{[^}]*\\}`, 'm'),
      );
      return match?.[0] ?? '';
    };
    expect(block('.mobile-header')).toContain('env(safe-area-inset-top)');
    expect(block('.mobile-nav')).toContain('top: env(safe-area-inset-top)');
  });

  it('links the manifest and iOS meta tags from index.html', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('viewport-fit=cover');
    // User zoom must stay enabled; installability must not rely on locking the viewport.
    expect(html).not.toMatch(/user-scalable=no/);
    expect(html).not.toMatch(/maximum-scale/);
  });
});
