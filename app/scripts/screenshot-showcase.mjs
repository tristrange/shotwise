#!/usr/bin/env node
/**
 * Captures the dev-only design-system showcase (`/#showcase`) at phone,
 * tablet and desktop widths in both themes. Run from app/:
 *
 *   npm run shots:showcase
 *
 * Screenshots are written to ../docs/design-system/shots/ so the owner can
 * review the visual direction in the PR without running anything.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(appDir, '../docs/design-system/shots');
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const WIDTHS = [320, 375, 390, 768, 1280];
const THEMES = ['light', 'dark'];

function startServer() {
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`dev server did not start at ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const server = startServer();
try {
  await waitForServer(BASE);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
      });
      await context.addInitScript((t) => {
        try {
          localStorage.setItem('shotwise-theme', t);
          document.documentElement.dataset.theme = t;
        } catch {}
      }, theme);
      const page = await context.newPage();
      await page.goto(`${BASE}/#showcase`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.showcase', { timeout: 15000 });
      // Let fonts, charts and the expand animation settle.
      await page.waitForTimeout(700);
      const file = path.join(outDir, `showcase-${width}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const size = (await page.evaluate(() => document.documentElement.scrollWidth)).toString();
      console.log(`showcase-${width}-${theme}.png  (scrollWidth=${size})`);
      await context.close();
    }
  }
  await browser.close();
  console.log(`Screenshots written to ${outDir}`);
} finally {
  server.kill('SIGTERM');
}
