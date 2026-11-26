#!/usr/bin/env node
/**
 * Captures the redesigned Gapping page (D9) at phone and desktop widths in
 * both themes against the local Supabase stack with a synthetic seeded
 * account. Run from app/:
 *
 *   npm run shots:gapping
 *
 * Screenshots are written to ../docs/design-system/shots/gapping-*.png so the
 * owner can review the screen in the PR without running anything.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localStack } from '../tests/local';
import { csvFixture } from '../src/domain/fixtures';
import { parseCsv } from '../src/domain/csv';
import { createRepository } from '../src/data/repository';
import { localToday, shiftDate } from '../src/domain/model';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(appDir, '../docs/design-system/shots');
const PORT = 4198;
const BASE = `http://127.0.0.1:${PORT}`;
const WIDTHS = [390, 1280] as const;
const THEMES = ['light', 'dark'] as const;

function startServer(): ChildProcess {
  const stack = localStack();
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--port', String(PORT), '--strictPort'],
    {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        VITE_SUPABASE_URL: stack.API_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY,
      },
    },
  );
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer(url: string, timeoutMs = 30000) {
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

// Two sessions of irons plus wedge target practice, shaped to show a small
// adjacent gap, a strong-strike potential above every median, a
// sample-limited club and a reversed pair.
function fixtureCsv(): string {
  const rows: Record<string, string>[] = [];
  const clubs: [string, number[]][] = [
    ['D', [232, 238, 241, 245, 248, 251, 255, 258, 262, 266, 270, 274]],
    ['5i', [158, 161, 163, 165, 167, 169, 171, 173, 176, 179, 182, 185]],
    ['6i', [148, 150, 152, 154, 156, 158, 160, 162, 165, 167, 170, 172]],
    ['7i', [139, 141, 143, 145, 147, 149, 151, 153, 155, 158, 160, 162]],
    ['8i', [130, 132, 134, 136, 138, 140, 142, 144, 146, 148, 150, 152]],
    ['9i', [120, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 141]],
    ['PW', [112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134]],
  ];
  const dates = [shiftDate(localToday(), -20), localToday()];
  for (const date of dates) {
    for (const [club, carries] of clubs) {
      carries.forEach((carry, i) => {
        rows.push({
          Club: club,
          'Flat Carry Dist. Premium (m)': String(carry + (date === dates[0] ? -6 : 0)),
          'Flat Carry Dist. Range (m)': String(carry + (date === dates[0] ? -8 : -2)),
          'Ball Speed (kph) Premium': String(120 + i),
          'Launch Angle (deg) Premium': '14°',
          'Apex (m) Premium': '28',
        });
      });
    }
    // Wedge target practice: a 30 m target group and partial swings.
    const wedges: [string, string, string][] = [
      ['SW', '30', '28'], ['SW', '30', '31'], ['SW', '30', '34'],
      ['SW', '50', '48'], ['SW', '50', '52'], ['GW', '--', '66'],
      ['GW', '--', '64'],
    ];
    wedges.forEach(([club, target, carry]) => {
      rows.push({
        Club: club,
        'Target (m)': target,
        'Flat Carry Dist. Premium (m)': carry,
        'Flat Carry Dist. Range (m)': String(Number(carry) - 2),
        'Ball Speed (kph) Premium': '70',
        'Prox to Hole (m)': '3',
        'Launch Direction': '1R',
      });
    });
  }
  // One sample-limited club.
  rows.push({ Club: 'LW', 'Flat Carry Dist. Premium (m)': '58', 'Flat Carry Dist. Range (m)': '55' });
  return csvFixture(rows);
}

async function main() {
  const stack = localStack();
  const admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `shotwise-gapping-shots-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID() + 'Aa1!';
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error ?? new Error('no user');
  const userId = created.data.user.id;

  const server = startServer();
  try {
    const client = createClient(stack.API_URL, stack.PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    const repository = createRepository(client);
    await repository.importCsv({
      filename: 'gapping-shots.csv',
      date: localToday(),
      time: '10:00',
      venue: 'Synthetic range',
      notes: '',
      confirmedFull: false,
      allowSameDay: false,
      preview: await parseCsv(new TextEncoder().encode(fixtureCsv())),
    });

    await waitForServer(BASE);
    await mkdir(outDir, { recursive: true });
    const browser = await chromium.launch();
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          deviceScaleFactor: 2,
          // Reduced motion also disables Recharts JS animations, so charts
          // render in their final state deterministically.
          reducedMotion: 'reduce',
        });
        await context.addInitScript((t) => {
          try {
            localStorage.setItem('shotwise-theme', t);
          } catch {}
        }, theme);
        const page = await context.newPage();
        await page.goto(`${BASE}/`);
        await page.getByLabel('Email', { exact: true }).fill(email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor({ timeout: 20000 });
        await page.evaluate(() => {
          location.hash = '#gapping';
        });
        await page.getByRole('heading', { name: 'Club gapping', exact: true }).waitFor();
        // Select the 7i band so the detail panel is visible in the shots.
        const band = page.getByRole('button', { name: /^7i: Median/ });
        if (await band.count()) await band.first().click();
        await page.waitForTimeout(700);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px at ${width}px ${theme}`);
        await page.screenshot({
          path: path.join(outDir, `gapping-${width}-${theme}.png`),
          fullPage: true,
        });
        // Sanity-check the other two chart views render their shared-axis charts.
        for (const [label, group] of [
          ['Potential', /median carry vs strong-strike potential by club/i],
          ['Distances', /median carry by club/i],
        ] as const) {
          await page.getByRole('button', { name: label, exact: true }).click();
          await page.getByRole('group', { name: group }).waitFor();
          if (label === 'Potential' && width === 1280 && theme === 'light') {
            await page.waitForTimeout(300);
            await page.screenshot({
              path: path.join(outDir, 'gapping-1280-light-potential.png'),
              fullPage: true,
            });
            console.log('captured gapping-1280-light-potential.png');
          }
          const viewOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          if (viewOverflow > 1)
            throw new Error(`overflow ${viewOverflow}px in ${label} view at ${width}px`);
          console.log(`view ok: ${label} @${width}px ${theme}`);
        }
        await context.close();
        console.log(`captured gapping-${width}-${theme}.png`);
      }
    }
    await browser.close();
  } finally {
    server.kill();
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
