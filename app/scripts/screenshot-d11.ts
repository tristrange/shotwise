#!/usr/bin/env node
/**
 * Captures the redesigned D11 screens (Shot shape, Ball-flight explorer,
 * Review, Settings) at phone and desktop widths in both themes against the
 * local Supabase stack with a synthetic seeded account. Run from app/:
 *
 *   npm run shots:d11
 *
 * Screenshots are written to ../docs/design-system/shots/d11-*.png so the
 * owner can review the screens in the PR without running anything.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localStack } from '../tests/local';
import { csvFixture, makeEquipment } from '../src/domain/fixtures';
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
    if (Date.now() - start > timeoutMs)
      throw new Error(`dev server did not start at ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function ironRow(
  club: string,
  carry: number,
  speed: number,
  extra: Record<string, string> = {},
) {
  return {
    Club: club,
    'Flat Carry Dist. Premium (m)': String(carry),
    'Flat Carry Dist. Range (m)': String(carry - 2),
    'Total Dist. Premium (m)': String(carry + 12),
    'Ball Speed (kph) Premium': String(speed),
    'Ball Speed (kph)': String(speed - 2),
    'Launch Angle (deg) Premium': '12.5',
    'Apex (m) Premium': '31',
    ...extra,
  };
}

// A realistic 7i block with launch direction / curve / from-centre recorded,
// plus one very short, slow shot that the automatic classifier flags as a
// likely mishit, a few 9i shots, and one unreadable club label (suggestions).
function recentCsv(): string {
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < 21; i++) {
    rows.push(
      ironRow('7i', 146 + ((i * 7) % 9), 226 + ((i * 5) % 8), {
        'Launch Direction': `${(i % 5) - 2}${i % 2 === 0 ? 'R' : 'L'}`,
        Curve: `${(i % 4) - 1 === 0 ? '' : (i % 4) - 1 > 0 ? `${(i % 4) - 1}R` : `${1 - (i % 4)}L`}`,
        'From Centre (m)': `${(i % 6) - 3}R`,
      }),
    );
  }
  // Likely mishit: both carry and speed far below the club baseline.
  rows.push(
    ironRow('7i', 95, 150, {
      'Launch Direction': '3L',
      Curve: '8L',
      'From Centre (m)': '14L',
    }),
  );
  rows.push(ironRow('9i', 128, 205, { 'Launch Direction': '1R', Curve: '2R' }));
  rows.push(ironRow('9i', 130, 208, { 'Launch Direction': '--', Curve: '1L' }));
  rows.push(ironRow('9i', 126, 202));
  rows.push({
    Club: '?',
    'Flat Carry Dist. Premium (m)': '140',
    'Ball Speed (kph) Premium': '220',
  });
  return csvFixture(rows);
}

function oldCsv(): string {
  return csvFixture([
    ironRow('7i', 138, 218),
    ironRow('7i', 141, 222, { 'Launch Direction': '2R', Curve: '3L' }),
    ironRow('7i', 139, 219),
  ]);
}

async function main() {
  const stack = localStack();
  const admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `shotwise-d11-shots-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID() + 'Aa1!';
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw created.error ?? new Error('no user');
  const userId = created.data.user.id;

  const server = startServer();
  try {
    const client = createClient(stack.API_URL, stack.PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    const repository = createRepository(client);

    const today = localToday();
    const imports = [
      {
        filename: 'range-recent.csv',
        csv: recentCsv(),
        date: today,
        time: '08:00',
        venue: 'Synthetic range',
      },
      {
        filename: 'range-old.csv',
        csv: oldCsv(),
        date: shiftDate(today, -95),
        time: '18:30',
        venue: 'Old range',
      },
    ];
    for (const meta of imports) {
      await repository.importCsv({
        filename: meta.filename,
        date: meta.date,
        time: meta.time,
        venue: meta.venue,
        notes: '',
        confirmedFull: false,
        allowSameDay: false,
        preview: await parseCsv(new TextEncoder().encode(meta.csv)),
      });
    }
    // One physical club so the bag list is not empty on the settings screen.
    await repository.saveEquipment({
      ...makeEquipment({ name: 'Fitted 7i', inrangeLabel: '7i' }),
      revision: null,
    });

    await waitForServer(BASE);
    await mkdir(outDir, { recursive: true });
    const browser = await chromium.launch();
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          deviceScaleFactor: 2,
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
        await page
          .getByRole('button', { name: 'Sign in', exact: true })
          .click();
        await page
          .getByRole('heading', { name: 'Overview', exact: true })
          .waitFor({ timeout: 20000 });

        const overflowOf = () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
        const shot = async (name: string) => {
          const overflow = await overflowOf();
          if (overflow > 1)
            throw new Error(
              `${name}: horizontal overflow ${overflow}px at ${width}px ${theme}`,
            );
          await page.waitForTimeout(400);
          await page.screenshot({
            path: path.join(outDir, `d11-${name}-${width}-${theme}.png`),
            fullPage: true,
          });
          console.log(`captured d11-${name}-${width}-${theme}.png`);
        };

        // 1. Shot shape with a selected point and the measurements disclosure open.
        await page.evaluate(() => {
          location.hash = '#shape';
        });
        await page
          .getByRole('heading', { name: 'Shot shape', exact: true })
          .waitFor();
        const shapePlot = page.getByRole('group', {
          name: '7i recorded shot shapes',
          exact: true,
        });
        await shapePlot.waitFor();
        await shapePlot
          .getByRole('button', { name: /Plot 7i row 3/ })
          .first()
          .click({ force: true });
        await page
          .locator('details', { hasText: 'Shot measurements' })
          .first()
          .locator('summary')
          .click();
        await page
          .getByRole('table', { name: '7i shot measurements' })
          .waitFor();
        await shot('shape');

        // 2. Ball-flight explorer with a selected point (the likely mishit is marked).
        await page.evaluate(() => {
          location.hash = '#shape/explorer';
        });
        const explorer = page.getByRole('region', {
          name: 'Ball-flight explorer',
          exact: true,
        });
        await explorer.waitFor();
        await explorer
          .getByRole('button', { name: /^Plot 7i row 5/ })
          .first()
          .click({ force: true });
        const mishitMarkers = await explorer
          .locator('.shape-point.mishit')
          .count();
        if (mishitMarkers < 1)
          throw new Error(
            'expected at least one auto likely-mishit point in the explorer',
          );
        await shot('explorer');

        // 3. Review queue with the open flags and the club suggestion card.
        await page.evaluate(() => {
          location.hash = '#review';
        });
        await page
          .getByRole('heading', { name: 'Review', exact: true })
          .waitFor();
        await page.getByText('auto: likely mishit').first().waitFor();
        await shot('review');

        // 4. Settings: manage bag + backups.
        await page.evaluate(() => {
          location.hash = '#settings';
        });
        await page
          .getByRole('heading', { name: 'Settings', exact: true })
          .waitFor();
        await page.getByRole('region', { name: 'Manage bag' }).waitFor();
        await page
          .getByRole('button', { name: 'Edit Fitted 7i', exact: true })
          .waitFor();
        await shot('settings');

        await context.close();
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
