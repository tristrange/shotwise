#!/usr/bin/env node
/**
 * Captures the redesigned Sessions screens (D10) at phone and desktop widths
 * in both themes against the local Supabase stack with a synthetic seeded
 * account: the session history cards, one session recap with an open club
 * disclosure, and the A/B session comparison with an open club accordion.
 * Run from app/:
 *
 *   npm run shots:sessions
 *
 * Screenshots are written to ../docs/design-system/shots/sessions-*.png so the
 * owner can review the screens in the PR without running anything.
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
const PORT = 4197;
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

function shots(club: string, carries: number[]): Record<string, string>[] {
  return carries.map((carry) => ({
    Club: club,
    'Flat Carry Dist. Premium (m)': String(carry),
    'Flat Carry Dist. Range (m)': String(carry - 2),
  }));
}

function wedgeShots(club: string, target: string, carries: number[]): Record<string, string>[] {
  return carries.map((carry) => ({
    Club: club,
    'Target (m)': target,
    'Flat Carry Dist. Premium (m)': String(carry),
    'Flat Carry Dist. Range (m)': String(carry - 2),
    'Ball Speed (kph) Premium': '70',
    'Launch Direction': '1R',
  }));
}

// Three sessions: two comparable range sessions on the same venue (so the
// recap shows a baseline comparison) and one archived single-club session.
function sessionCsvs(): { filename: string; csv: string }[] {
  const morning = [
    ...shots('7i', [114, 116, 117, 118, 119, 120, 121, 122, 123, 124, 126, 128]),
    ...shots('9i', [148, 150, 151, 153]),
    ...shots('PW', [73, 75, 76, 78]),
  ];
  const evening = [
    ...shots('7i', [106, 108, 109, 110, 111, 112, 113, 114, 115, 116, 118, 120]),
    ...wedgeShots('SW', '30', [28, 31, 34]),
    ...shots('PW', [68, 70, 71, 73]),
  ];
  const night = [...shots('3w', [198, 201, 204])];
  return [
    { filename: 'morning-session.csv', csv: csvFixture(morning) },
    { filename: 'evening-session.csv', csv: csvFixture(evening) },
    { filename: 'night-session.csv', csv: csvFixture(night) },
  ];
}

async function main() {
  const stack = localStack();
  const admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `shotwise-sessions-shots-${crypto.randomUUID()}@example.test`;
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

    const today = localToday();
    const metas = [
      { date: shiftDate(today, -14), time: '08:00', venue: 'Synthetic range' },
      { date: today, time: '17:00', venue: 'Synthetic range' },
      { date: shiftDate(today, -5), time: '19:00', venue: 'Night range' },
    ] as const;
    const imports: { filename: string; date: string; time: string; venue: string; sessionId: string }[] = [];
    for (const [i, { filename, csv }] of sessionCsvs().entries()) {
      const meta = metas[i];
      if (!meta) throw new Error(`no metadata for session ${filename}`);
      const result = await repository.importCsv({
        filename,
        date: meta.date,
        time: meta.time,
        venue: meta.venue,
        notes: '',
        confirmedFull: false,
        allowSameDay: false,
        preview: await parseCsv(new TextEncoder().encode(csv)),
      });
      imports.push({ filename, sessionId: result.sessionId, ...meta });
    }
    // Archive the single-club night session so the history shows the badge.
    const nightImport = imports[2];
    if (!nightImport) throw new Error('night session missing after import list');
    const data = await repository.load();
    const night = data.sessions.find((s) => s.id === nightImport.sessionId);
    if (!night) throw new Error('night session missing after import');
    await repository.updateSession({ ...night, archived: true });

    const [morning, evening] = imports;
    if (!morning || !evening) throw new Error('expected morning and evening sessions');

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

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px at ${width}px ${theme}`);

        // 1. Session history cards.
        await page.evaluate(() => {
          location.hash = '#sessions';
        });
        await page.getByRole('heading', { name: 'Sessions & import', exact: true }).waitFor();
        await page.locator('.session-card').first().waitFor();
        const cardCount = await page.locator('.session-card').count();
        if (cardCount !== 3) throw new Error(`expected 3 session cards, found ${cardCount}`);
        const archivedBadges = await page.getByText('Archived', { exact: true }).count();
        if (archivedBadges !== 1) throw new Error(`expected 1 Archived badge, found ${archivedBadges}`);
        await page.waitForTimeout(500);
        await page.screenshot({
          path: path.join(outDir, `sessions-${width}-${theme}.png`),
          fullPage: true,
        });
        console.log(`captured sessions-${width}-${theme}.png`);

        // 2. Session recap with one club disclosure opened.
        await page.evaluate((id) => {
          location.hash = `#sessions/${id}`;
        }, evening.sessionId);
        await page.getByRole('heading', { name: 'Session recap', exact: true }).waitFor();
        await page
          .locator('.recap-club summary', { hasText: '7i metric details' })
          .first()
          .click();
        await page.locator('.recap-club[open]').first().waitFor();
        await page.waitForTimeout(500);
        const recapOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (recapOverflow > 1)
          throw new Error(`recap overflow ${recapOverflow}px at ${width}px ${theme}`);
        await page.screenshot({
          path: path.join(outDir, `sessions-recap-${width}-${theme}.png`),
          fullPage: true,
        });
        console.log(`captured sessions-recap-${width}-${theme}.png`);

        // 3. A/B comparison with the shared-club accordion opened.
        await page.evaluate(
          ([ref, cmp]) => {
            location.hash = `#sessions/compare?reference=${ref}&comparison=${cmp}`;
          },
          [morning.sessionId, evening.sessionId],
        );
        await page.getByRole('heading', { name: 'Compare sessions', exact: true }).waitFor();
        await page.getByText(/Only in reference.*9i/).waitFor();
        await page.getByText(/Only in comparison.*SW/).waitFor();
        await page.locator('summary').filter({ hasText: /^7i\b/ }).first().click();
        await page.getByRole('row', { name: /^Median carry/ }).waitFor();
        await page.waitForTimeout(500);
        const compareOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (compareOverflow > 1)
          throw new Error(`compare overflow ${compareOverflow}px at ${width}px ${theme}`);
        await page.screenshot({
          path: path.join(outDir, `sessions-compare-${width}-${theme}.png`),
          fullPage: true,
        });
        console.log(`captured sessions-compare-${width}-${theme}.png`);

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
