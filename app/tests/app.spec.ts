import {
  test as base,
  expect,
  devices,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { localStack } from './local';
import { csvFixture, makeEquipment } from '../src/domain/fixtures';
import {
  effectiveClub,
  localToday,
  shiftDate,
  type Dataset,
} from '../src/domain/model';
import { parseCsv } from '../src/domain/csv';
import { createRepository } from '../src/data/repository';
import { parseBackup, serializeBackup } from '../src/domain/backup';

const stack = localStack();
const admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
type Account = {
  email: string;
  password: string;
  repository: ReturnType<typeof createRepository>;
};
const test = base.extend<{ account: Account }>({
  account: async ({ browserName }, use) => {
    const email = `shotwise-${browserName}-${crypto.randomUUID()}@example.test`;
    const password = crypto.randomUUID() + 'Aa1!';
    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (result.error || !result.data.user)
      throw new Error('Could not provision local acceptance user.');
    const client = createClient(stack.API_URL, stack.PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    await use({ email, password, repository: createRepository(client) });
    await admin.auth.admin.deleteUser(result.data.user.id);
  },
});
async function login(page: Page, account: Account) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
}
// Phone layout uses five bottom tabs (Home/Clubs/Progress/Sessions/More);
// the Clubs and More tabs expose their screens through a sub-nav, and the
// desktop sidebar mirrors the same grouping.
const screenTargets: Record<string, { tab: string; buttons: string[] }> = {
  Overview: { tab: 'Home', buttons: ['Overview', 'Home'] },
  Clubs: { tab: 'Clubs', buttons: ['Club profiles', 'Clubs'] },
  Gapping: { tab: 'Clubs', buttons: ['Gapping'] },
  'Shot shape': { tab: 'Clubs', buttons: ['Shot shape'] },
  Explorer: { tab: 'Clubs', buttons: ['Explorer', 'Ball-flight explorer'] },
  Progress: { tab: 'Progress', buttons: ['Progress'] },
  Sessions: { tab: 'Sessions', buttons: ['Sessions & import', 'Sessions'] },
  Review: { tab: 'More', buttons: ['Shot review', 'Review'] },
  Settings: { tab: 'More', buttons: ['Settings', 'More'] },
};

/** Opens a <details> by its summary text unless it is already open. */
async function openDisclosure(page: Page, summary: string) {
  const details = page.locator('details', { hasText: summary }).first();
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await details.locator('summary').click();
  }
}
async function clickVisibleButton(page: Page, names: string[]) {
  for (const name of names) {
    const target = page
      .getByRole('button', { name, exact: true })
      .filter({ visible: true });
    if ((await target.count()) > 0) {
      await target.click();
      return true;
    }
  }
  return false;
}
async function nav(page: Page, name: string) {
  const screen = screenTargets[name] ?? { tab: name, buttons: [name] };
  if (await clickVisibleButton(page, screen.buttons)) return;
  // The screen sits behind a primary tab: open the tab (which reveals the
  // sub-nav on phones), then click the screen's own button.
  if (!(await clickVisibleButton(page, [screen.tab])))
    throw new Error(`No navigation tab for ${name}`);
  if (!(await clickVisibleButton(page, screen.buttons)))
    throw new Error(`No navigation button for ${name} after ${screen.tab}`);
}
const fixture = () =>
  csvFixture([
    {
      Club: '7i',
      'Carry Dist. Range (m)': '100',
      'Flat Carry Dist. Range (m)': '100',
      'Flat Carry Dist. Premium (m)': '105',
      'Flat Total Dist. Premium (m)': '115',
      'Ball Speed (kph)': '130',
      'Ball Speed (kph) Premium': '135',
      'Launch Angle (deg) Premium': '21°',
      'Apex (m) Premium': '15',
      Curve: '2R',
    },
    {
      Club: '7i',
      'Carry Dist. Range (m)': '90',
      'Flat Carry Dist. Range (m)': '90',
      'Flat Carry Dist. Premium (m)': '95',
      'Ball Speed (kph)': '125',
      'Ball Speed (kph) Premium': '130',
      Curve: '1L',
    },
    {
      Club: 'SW',
      'Carry Dist. Range (m)': '30',
      'Flat Carry Dist. Premium (m)': '31',
      'Ball Speed (kph)': '70',
      Curve: '0',
    },
  ]);
async function seed(account: Account) {
  return account.repository.importCsv({
    filename: 'synthetic.csv',
    date: localToday(),
    time: null,
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: true,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(fixture())),
  });
}

async function seedClubSuggestions(account: Account) {
  for (const archived of [false, true]) {
    const rows = archived
      ? [{ Club: '9i' }, { Club: '?' }]
      : [
          ...Array.from({ length: 10 }, () => ({ Club: '7i' })),
          { Club: '?' },
          { Club: '?' },
        ];
    const result = await account.repository.importCsv({
      filename: archived ? 'archived.csv' : 'clubs.csv',
      date: shiftDate(localToday(), archived ? -1 : 0),
      time: null,
      venue: '',
      notes: '',
      confirmedFull: false,
      allowSameDay: false,
      preview: await parseCsv(
        new TextEncoder().encode(
          csvFixture(
            rows.map((row) => ({
              ...row,
              'Flat Carry Dist. Premium (m)': archived ? '80' : '150',
            })),
          ),
        ),
      ),
    });
    if (archived) {
      const data = await account.repository.load();
      const session = data.sessions.find(
        (session) => session.id === result.sessionId,
      );
      if (!session) throw new Error('Missing seeded session');
      await account.repository.updateSession({ ...session, archived: true });
    }
  }
}

async function seedFocusedReviews(account: Account) {
  const normal = (i: number) => ({
    'Flat Carry Dist. Range (m)': String(100 + (i % 5)),
    'Ball Speed (kph)': String(140 + (i % 5)),
  });
  const weak = () => ({
    'Flat Carry Dist. Range (m)': '40',
    'Ball Speed (kph)': '90',
  });
  const main = await account.repository.importCsv({
    filename: 'focused-irons.csv',
    date: localToday(),
    time: '10:00',
    venue: 'Main range',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture([
          ...Array.from({ length: 20 }, (_, i) => normal(i)),
          weak(),
          weak(),
          normal(0),
        ]),
      ),
    ),
  });
  // Reuses source numbers 1–5 so navigation must stay inside the focused session.
  await account.repository.importCsv({
    filename: 'other-session.csv',
    date: shiftDate(localToday(), -1),
    time: '10:00',
    venue: 'Other range',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture(
          Array.from({ length: 5 }, () => ({
            Club: '3w',
            'Flat Carry Dist. Range (m)': '190',
            'Flat Carry Dist. Premium (m)': '200',
            'Ball Speed (kph)': '200',
          })),
        ),
      ),
    ),
  });
  return main;
}

test('toggles automatic mishits across stats without changing reviews', async ({
  page,
  account,
}, testInfo) => {
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => ({
      Club: 'D',
      'Flat Carry Dist. Range (m)': String(150 + (i % 5)),
      'Ball Speed (kph)': String(200 + (i % 5)),
      'Flat Carry Dist. Premium (m)': String(180 + (i % 5)),
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      Club: 'D',
      'Flat Carry Dist. Range (m)': String(35 + i * 3),
      'Ball Speed (kph)': '90',
      'Flat Carry Dist. Premium (m)': String(40 + i * 3),
    })),
    ...Array.from({ length: 20 }, (_, i) => ({
      Club: 'PW',
      'Flat Carry Dist. Range (m)': String(80 + (i % 5)),
      'Ball Speed (kph)': String(120 + (i % 5)),
      'Flat Carry Dist. Premium (m)': String(90 + (i % 5)),
    })),
    ...Array.from({ length: 3 }, () => ({
      Club: 'PW',
      'Flat Carry Dist. Range (m)': '30',
      'Ball Speed (kph)': '60',
      'Flat Carry Dist. Premium (m)': '40',
    })),
    ...Array.from({ length: 10 }, () => ({
      Club: '5i',
      'Flat Carry Dist. Premium (m)': '111',
    })),
    ...Array.from({ length: 10 }, () => ({
      Club: '6i',
      'Flat Carry Dist. Premium (m)': '109',
    })),
  ];
  await account.repository.importCsv({
    filename: 'filter.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  const original = await account.repository.load();
  await login(page, account);
  const clubs = page.getByRole('list', { name: 'Your clubs' });
  const driver = clubs
    .getByRole('listitem')
    .filter({ has: page.locator('.club-badge', { hasText: /^D$/ }) });
  const pitchingWedge = clubs
    .getByRole('listitem')
    .filter({ has: page.locator('.club-badge', { hasText: /^PW$/ }) });
  await expect(driver.locator('.club-shots')).toHaveText('25');
  const toggle = page.getByRole('button', {
    name: 'Hide likely mishits',
    exact: true,
  });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(driver.locator('.club-shots')).toHaveText('20');
  // The three short+slow PW shots are partial intent AND likely mishits on the
  // canonical basis, so hiding likely mishits removes them too.
  await expect(pitchingWedge.locator('.club-shots')).toHaveText('20');
  await page.screenshot({
    path: testInfo.outputPath('filtered-stats.png'),
    fullPage: true,
  });
  await nav(page, 'Gapping');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByText(/No recurring practice patterns yet/),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Adjacent club gaps' }),
  ).toContainText('small median gap');
  await nav(page, 'Progress');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // Detailed session tables sit behind one disclosure per club.
  await page.locator('summary', { hasText: 'Driver session details' }).click();
  await expect(
    page.getByRole('table', { name: 'D session details', exact: true }),
  ).toContainText('20 / 0');
  await nav(page, 'Shot shape');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'Shot shape', exact: true }),
  ).toBeVisible();
  await expect(page.locator('p.context')).toContainText('60 shots');
  await nav(page, 'Overview');
  await toggle.click();
  await expect(driver.locator('.club-shots')).toHaveText('25');
  expect(await account.repository.load()).toEqual(original);
});

test('switches overview club rows between All, Typical and Strong-strike', async ({
  page,
  account,
}) => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    Club: '7i',
    'Flat Carry Dist. Premium (m)': String(100 + i),
    'Ball Speed (kph) Premium': '200',
  }));
  await account.repository.importCsv({
    filename: 'strong.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  await login(page, account);
  await nav(page, 'Overview');
  const list = page.getByRole('list', { name: 'Your clubs' });
  const row = list.getByRole('listitem').filter({ hasText: '7i' });
  const shots = row.locator('.club-shots');
  await expect(shots).toContainText('20');
  // P80 of carries 100..119 is 115.2, so Strong-strike keeps 116..119.
  await page
    .getByRole('button', { name: 'Strong-strike', exact: true })
    .click();
  await expect(shots).toContainText('4');
  // The mishit toggle is redundant in strong mode and stays hidden.
  await expect(
    page.getByRole('button', { name: 'Hide likely mishits', exact: true }),
  ).toHaveCount(0);
  // Typical needs an automatic assessment (>= 10 earlier same-club shots).
  await page.getByRole('button', { name: 'Typical', exact: true }).click();
  await expect(shots).toContainText('10');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(shots).toContainText('20');
});

test('hides archived shots and club labels from suggestions', async ({
  page,
  account,
}) => {
  await seedClubSuggestions(account);
  await login(page, account);
  await nav(page, 'Review');
  const suggestions = page.locator('.suggestion-list');
  await expect(suggestions.locator('.suggestion-row')).toHaveCount(2);
  await expect(
    suggestions.getByRole('option', { name: '9i', exact: true }),
  ).toHaveCount(0);
});

test('holds all suggestion controls steady until a save completes', async ({
  page,
  account,
}) => {
  await seedClubSuggestions(account);
  await login(page, account);
  await nav(page, 'Review');
  const suggestions = page.locator('.suggestion-list');
  await suggestions
    .getByRole('combobox', { name: 'Club for row 12', exact: true })
    .selectOption('7i');
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let requests = 0;
  await page.route('**/rest/v1/rpc/apply_reviews', async (route) => {
    requests++;
    entered();
    await gate;
    await route.continue();
  });
  await suggestions
    .getByRole('button', { name: 'Save club', exact: true })
    .first()
    .click();
  await request;
  try {
    await nav(page, 'Overview');
    await nav(page, 'Review');
    await expect(
      suggestions.getByRole('button', { name: 'Saving…' }),
    ).toBeDisabled();
    await expect(
      suggestions.getByRole('button', { name: 'Save club', exact: true }),
    ).toBeDisabled();
    await expect(
      suggestions.getByRole('combobox', {
        name: 'Club for row 11',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      suggestions.getByRole('combobox', {
        name: 'Club for row 12',
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(suggestions.locator('.suggestion-row')).toHaveCount(1);
  await expect(
    suggestions.getByRole('combobox', { name: 'Club for row 12', exact: true }),
  ).toHaveValue('7i');
  await expect(
    suggestions.getByRole('button', { name: 'Save club', exact: true }),
  ).toBeEnabled();
  expect(requests).toBe(1);
});

test('preserves a club choice after a failed suggestion save and allows retry', async ({
  page,
  account,
}) => {
  await seedClubSuggestions(account);
  await login(page, account);
  await nav(page, 'Review');
  const suggestions = page.locator('.suggestion-list');
  const choice = suggestions.getByRole('combobox', {
    name: 'Club for row 11',
    exact: true,
  });
  await choice.selectOption('7i');
  await page.route('**/rest/v1/rpc/apply_reviews', (route) => route.abort());
  await suggestions
    .getByRole('button', { name: 'Save club', exact: true })
    .first()
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await nav(page, 'Overview');
  await nav(page, 'Review');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(choice).toBeEnabled();
  await expect(choice).toHaveValue('7i');
  await page.unroute('**/rest/v1/rpc/apply_reviews');
  await suggestions
    .getByRole('button', { name: 'Save club', exact: true })
    .first()
    .click();
  await expect(suggestions.locator('.suggestion-row')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps theme controls in sync across desktop, tablet and phone', async ({
  page,
  account,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, account);
  await page
    .getByRole('button', { name: 'Switch to dark theme' })
    .filter({ visible: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  const lightButton = page
    .getByRole('button', { name: 'Switch to light theme' })
    .filter({ visible: true });
  await expect(lightButton).toBeVisible();
  await lightButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page
    .getByRole('button', { name: 'Switch to dark theme' })
    .filter({ visible: true })
    .click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page
      .getByRole('button', { name: 'Switch to light theme' })
      .filter({ visible: true }),
  ).toBeVisible();
});

test('uses a five-tab bottom navigation on phones with every feature reachable', async ({
  page: projectPage,
  browser,
  account,
}, testInfo) => {
  // WebKit cannot resize the layout viewport of a mobile-emulated page:
  // setViewportSize only changes the visual viewport, which leaves the fixed
  // bottom nav outside the hit-test area on pages shorter than the visual
  // viewport. Give the phone project a context with a real 390x844 layout.
  const phoneContext =
    testInfo.project.name === 'phone-webkit'
      ? await browser.newContext({
          ...devices['iPhone 13'],
          viewport: { width: 390, height: 844 },
        })
      : null;
  const page = phoneContext ? await phoneContext.newPage() : projectPage;
  await seed(account);
  await login(page, account);
  if (!phoneContext) await page.setViewportSize({ width: 390, height: 844 });
  const bottomNav = page.locator('.bottom-nav');
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.getByRole('button')).toHaveCount(5);
  for (const label of ['Home', 'Clubs', 'Progress', 'Sessions', 'More']) {
    await expect(
      bottomNav.getByRole('button', { name: label, exact: true }),
    ).toBeVisible();
  }
  // The old sideways-scrolling top nav is gone.
  await expect(page.locator('.mobile-nav')).toHaveCount(0);

  // The Clubs tab opens club profiles directly and exposes the other club
  // screens through the sub-nav.
  await bottomNav.getByRole('button', { name: 'Clubs', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Club profiles', exact: true }),
  ).toBeVisible();
  const subNav = page.locator('.sub-nav');
  await expect(subNav).toBeVisible();
  await expect(subNav.getByRole('button')).toHaveCount(4);
  await subNav.getByRole('button', { name: 'Gapping', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Club gapping', exact: true }),
  ).toBeVisible();
  await expect(
    bottomNav.getByRole('button', { name: 'Clubs', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    subNav.getByRole('button', { name: 'Gapping', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);

  // Every tab opens its primary content directly.
  await bottomNav
    .getByRole('button', { name: 'Progress', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Progress', exact: true }),
  ).toBeVisible();
  await expect(
    bottomNav.getByRole('button', { name: 'Progress', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await bottomNav
    .getByRole('button', { name: 'Sessions', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Sessions & import', exact: true }),
  ).toBeVisible();
  await bottomNav.getByRole('button', { name: 'More', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manage bag' })).toBeVisible();
  await expect(
    bottomNav.getByRole('button', { name: 'More', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  // Review is secondary navigation under More.
  await subNav
    .getByRole('button', { name: 'Shot review', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Review', exact: true }),
  ).toBeVisible();
  await expect(
    bottomNav.getByRole('button', { name: 'More', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await bottomNav.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();

  // Deep links keep working and highlight the right tab.
  await page.evaluate(() => {
    window.location.hash = 'shape/explorer';
  });
  await expect(
    page.getByRole('region', { name: 'Ball-flight explorer', exact: true }),
  ).toBeVisible();
  await expect(
    bottomNav.getByRole('button', { name: 'Clubs', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    subNav.getByRole('button', { name: 'Explorer', exact: true }),
  ).toHaveAttribute('aria-current', 'page');

  // No content is hidden behind the fixed bottom bar.
  const clearance = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav') as HTMLElement;
    const main = document.querySelector('.main-content') as HTMLElement;
    return (
      parseFloat(getComputedStyle(main).paddingBottom) >=
      nav.getBoundingClientRect().height
    );
  });
  expect(clearance).toBe(true);
  await phoneContext?.close();
});

test('keeps the right primary item active for nested routes, deep links and back/forward', async ({
  page,
  account,
}, testInfo) => {
  await seed(account);
  // A second visit so the compare route has content.
  await account.repository.importCsv({
    filename: 'synthetic-2.csv',
    date: shiftDate(localToday(), -7),
    time: null,
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(fixture())),
  });
  await login(page, account);
  const isPhone = testInfo.project.name === 'phone-webkit';
  const primary = isPhone ? page.locator('.bottom-nav') : page.locator('.sidebar nav');
  const tab = (label: string) =>
    primary.getByRole('button', { name: label, exact: true });
  // On desktop the matching sidebar item carries aria-current; on phones the
  // primary tab does.
  const clubsItem = tab(isPhone ? 'Clubs' : 'Club profiles');
  const explorerItem = tab(isPhone ? 'Clubs' : 'Ball-flight explorer');
  const sessionsItem = tab(isPhone ? 'Sessions' : 'Sessions & import');
  const moreItem = tab(isPhone ? 'More' : 'Shot review');
  const progressItem = tab('Progress');
  const data = await account.repository.load();
  const session = data.sessions[0];
  if (!session) throw new Error('seeded data missing session');
  const shot = data.shots.find((s) => s.sessionId === session.id);
  if (!shot) throw new Error('seeded data missing shot');

  // Club-profile deep link highlights Clubs / Club profiles.
  await page.evaluate((club) => {
    window.location.hash = `clubs/${club}`;
  }, '7i');
  await expect(clubsItem).toHaveAttribute('aria-current', 'page');
  if (isPhone) {
    await expect(
      page.locator('.sub-nav').getByRole('button', { name: 'Club profiles' }),
    ).toHaveAttribute('aria-current', 'page');
  }
  // Re-tapping the Clubs tab keeps the deep link instead of resetting it.
  if (isPhone) {
    await tab('Clubs').click();
    expect(new URL(page.url()).hash).toBe('#clubs/7i');
  }

  // Explorer deep link stays inside the Clubs group.
  await page.evaluate(() => {
    window.location.hash = 'shape/explorer';
  });
  await expect(
    page.getByRole('region', { name: 'Ball-flight explorer', exact: true }),
  ).toBeVisible();
  await expect(explorerItem).toHaveAttribute('aria-current', 'page');

  // Session recap, evidence and compare deep links highlight Sessions.
  await page.evaluate(
    (id) => {
      window.location.hash = `sessions/${id}`;
    },
    session.id,
  );
  await expect(sessionsItem).toHaveAttribute('aria-current', 'page');
  await page.evaluate(
    ([id, shotId]) => {
      window.location.hash = `sessions/${id}?shot=${shotId}`;
    },
    [session.id, shot.id] as const,
  );
  await expect(
    page.getByRole('heading', { name: 'Supporting shots' }),
  ).toBeVisible();
  await expect(sessionsItem).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() => {
    window.location.hash = 'sessions/compare';
  });
  await expect(
    page.getByRole('region', { name: 'Compare sessions' }),
  ).toBeVisible();
  await expect(sessionsItem).toHaveAttribute('aria-current', 'page');

  // Review deep link highlights More (secondary access under More).
  await page.evaluate(() => {
    window.location.hash = 'review';
  });
  await expect(
    page.getByRole('heading', { name: 'Review', exact: true }),
  ).toBeVisible();
  await expect(moreItem).toHaveAttribute('aria-current', 'page');

  // Back/forward restore both the hash route and the active primary item.
  await page.evaluate(() => {
    window.location.hash = 'progress';
  });
  await expect(
    page.getByRole('heading', { name: 'Progress', exact: true }),
  ).toBeVisible();
  await expect(progressItem).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toBe('#review');
  await expect(moreItem).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toBe('#progress');
  await expect(progressItem).toHaveAttribute('aria-current', 'page');
});

/** True when the element's box sits inside the current viewport. */
async function inFirstViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) return false;
  const height = await page.evaluate(() => window.innerHeight);
  return box.y >= -1 && box.y + box.height <= height + 1;
}

test('starts deliberate primary navigation at the destination top and preserves history and evidence focus', async ({
  page,
  account,
}, testInfo) => {
  // A tall recap so scrolling deep is meaningful.
  const rows = Array.from({ length: 40 }, (_, i) => ({
    Club: i % 2 ? '7i' : '9i',
    'Flat Carry Dist. Premium (m)': String(120 + (i % 5)),
    'Flat Carry Dist. Range (m)': String(130 + (i % 5)),
    'Ball Speed (kph)': '140',
  }));
  const tall = await account.repository.importCsv({
    filename: 'tall-recap.csv',
    date: localToday(),
    time: '08:00',
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: true,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  await login(page, account);
  // React key warnings surface as console errors in the dev build; the
  // sidebar groups must render without duplicate-key errors.
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const isPhone = testInfo.project.name === 'phone-webkit';
  const primary = isPhone ? page.locator('.bottom-nav') : page.locator('.sidebar nav');
  const data = await account.repository.load();
  const session = data.sessions.find((s) => s.id === tall.sessionId);
  const shot = data.shots.find((s) => s.sessionId === tall.sessionId);
  if (!session || !shot) throw new Error('seeded data missing session or shot');

  // Open the recap from the logbook, then scroll deep into it.
  await nav(page, isPhone ? 'Sessions' : 'Sessions & import');
  await page.getByRole('link', { name: /tall-recap\.csv/ }).click();
  await expect(
    page.getByRole('region', { name: 'Session recap' }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBeGreaterThan(400);

  // Deliberate primary navigation starts at the destination top: Home and
  // Progress open with their heading in the first viewport, not deep down.
  for (const [button, heading] of [
    [isPhone ? 'Home' : 'Overview', 'Overview'],
    ['Progress', 'Progress'],
  ] as const) {
    await primary.getByRole('button', { name: button, exact: true }).click();
    const target = page.getByRole('heading', { name: heading, exact: true });
    await expect(target).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);
    expect(await inFirstViewport(page, target)).toBe(true);
  }

  // Browser Back/Forward still restore the route and the original scroll:
  // back to the Home entry (top), then to the deep-scrolled recap, then
  // forward again.
  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toBe('#overview');
  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBe(0);
  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toBe(`#sessions/${session.id}`);
  await expect(
    page.getByRole('region', { name: 'Session recap' }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBeGreaterThan(400);
  await page.goForward();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toBe('#overview');
  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBe(0);

  // Theme change re-renders the navigation without duplicate-key errors and
  // with every item rendered exactly once.
  await page
    .getByRole('button', { name: /Switch to (dark|light) theme/ })
    .click();
  if (!isPhone) {
    await expect(page.locator('.sidebar nav').getByRole('button')).toHaveCount(9);
  } else {
    await expect(page.locator('.bottom-nav').getByRole('button')).toHaveCount(5);
  }
  expect(consoleErrors.filter((text) => /key/i.test(text))).toEqual([]);

  // A direct evidence link still focuses and reveals its own destination.
  await page.evaluate(
    ([id, shotId]) => {
      window.location.hash = `sessions/${id}?shot=${shotId}`;
    },
    [session.id, shot.id] as const,
  );
  const evidence = page.getByRole('heading', { name: 'Supporting shots' });
  await expect(evidence).toBeVisible();
  await expect(evidence).toBeFocused();
  await expect.poll(() => inFirstViewport(page, evidence)).toBe(true);

  // Re-tapping the active Clubs tab keeps a deep link instead of resetting.
  if (isPhone) {
    await page.evaluate(() => {
      window.location.hash = 'clubs/7i';
    });
    await expect(page.locator('.club-profile').first()).toBeVisible();
    await primary.getByRole('button', { name: 'Clubs', exact: true }).click();
    expect(new URL(page.url()).hash).toBe('#clubs/7i');
  }
});

test('keeps all four Clubs sub-nav entries visible at 320 and 390 px, including a direct Explorer deep link', async ({
  page,
  browser,
  account,
}, testInfo) => {
  test.setTimeout(150000);
  await seed(account);
  const isPhone = testInfo.project.name === 'phone-webkit';
  const contexts: BrowserContext[] = [];
  let loggedIn = false;
  try {
    for (const width of [320, 390]) {
      let target = page;
      if (isPhone) {
        // WebKit cannot resize the layout viewport of a mobile-emulated page:
        // give each width a real context.
        const context = await browser.newContext({
          ...devices['iPhone 13'],
          viewport: { width, height: 700 },
        });
        contexts.push(context);
        target = await context.newPage();
        await login(target, account);
      } else {
        await page.setViewportSize({ width, height: 700 });
        if (!loggedIn) {
          await login(page, account);
          loggedIn = true;
        }
      }
      await target.evaluate(() => {
        window.location.hash = 'clubs';
      });
      await expect(
        target.getByRole('heading', { name: 'Club profiles', exact: true }),
      ).toBeVisible();
      const subNav = target.locator('.sub-nav');
      await expect(subNav.getByRole('button')).toHaveCount(4);
      // Every entry — including Explorer — fits inside the viewport width.
      for (const label of ['Club profiles', 'Gapping', 'Shot shape', 'Explorer']) {
        const box = await subNav
          .getByRole('button', { name: label, exact: true })
          .boundingBox();
        expect(box, `${label} box at ${width}px`).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await expect
        .poll(() =>
          target.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      // A direct Explorer deep link keeps its entry active and in view.
      await target.evaluate(() => {
        window.location.hash = 'shape/explorer';
      });
      const explorer = subNav.getByRole('button', { name: 'Explorer', exact: true });
      await expect(explorer).toHaveAttribute('aria-current', 'page');
      const box = await explorer.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      await expect(
        target.getByRole('region', { name: 'Ball-flight explorer', exact: true }),
      ).toBeVisible();
      // Explorer stays reachable by tapping the sub-nav entry from Clubs.
      await target.evaluate(() => {
        window.location.hash = 'clubs';
      });
      await expect(
        target.getByRole('heading', { name: 'Club profiles', exact: true }),
      ).toBeVisible();
      await explorer.click();
      await expect(
        target.getByRole('region', { name: 'Ball-flight explorer', exact: true }),
      ).toBeVisible();
      await expect(explorer).toHaveAttribute('aria-current', 'page');
      if (isPhone) await contexts.pop()?.close();
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  }
});

test('fits the overview hero on phone viewports without pinch zoom', async ({
  page,
  account,
}) => {
  await seed(account);
  await login(page, account);
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [320, 568],
  ] as const) {
    await page.setViewportSize({ width, height });
    const hero = page.locator('.hero');
    await expect(hero).toBeVisible();
    // No horizontal page overflow at common iPhone widths.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
    // The full hero is visible at the default zoom level: it starts below the
    // header and its bottom edge stays inside the viewport.
    const fit = await page.evaluate(() => {
      const hero = document.querySelector('.hero')?.getBoundingClientRect();
      return hero
        ? { top: hero.top, bottom: hero.bottom, height: hero.height }
        : null;
    });
    expect(fit).not.toBeNull();
    expect(fit!.top).toBeGreaterThan(0);
    expect(fit!.bottom).toBeLessThanOrEqual(height + 1);
    // Mobile hero is shorter than the desktop 560px minimum.
    expect(fit!.height).toBeLessThan(500);
    // Hero text stays inside the hero box (nothing clipped by overflow hidden).
    const clipped = await page.evaluate(() => {
      const hero = document.querySelector('.hero') as HTMLElement;
      const copy = hero.querySelector('.hero-copy') as HTMLElement;
      return (
        copy.getBoundingClientRect().bottom -
        hero.getBoundingClientRect().bottom
      );
    });
    expect(clipped).toBeLessThanOrEqual(1);
  }
});

test('includes unreviewed pitching-wedge shots in iron-style gapping but not higher wedges', async ({
  page,
  account,
}) => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': String(150 + i),
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      Club: 'PW',
      'Flat Carry Dist. Premium (m)': String(100 + i),
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      Club: 'SW',
      'Flat Carry Dist. Premium (m)': String(50 + i),
    })),
  ];
  await account.repository.importCsv({
    filename: 'pw-gapping.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  await login(page, account);
  await nav(page, 'Gapping');
  const list = page.getByRole('list', { name: 'Club carry distances' });
  await expect(
    list.getByRole('link', { name: '7i', exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole('link', { name: 'PW', exact: true }),
  ).toBeVisible();
  await expect(list.getByRole('link', { name: 'SW', exact: true })).toHaveCount(
    0,
  );
});

test('expands overview club cards inline with per-club measurements', async ({
  page,
  account,
}) => {
  await seed(account);
  await login(page, account);
  const clubs = page.getByRole('list', { name: 'Your clubs' });
  const cardOf = (code: string) =>
    clubs
      .getByRole('listitem')
      .filter({
        has: page.locator('.club-badge', {
          hasText: new RegExp(`^${code}$`, 'i'),
        }),
      });
  const card7i = cardOf('7i');
  const cardSW = cardOf('SW');
  // The whole card header is the expansion control.
  const toggle7i = card7i.getByRole('button').first();
  const toggleSW = cardSW.getByRole('button').first();
  const detail7i = card7i.locator('.club-card-detail');
  const detailSW = cardSW.locator('.club-card-detail');
  await expect(toggle7i).toHaveAttribute('aria-expanded', 'false');
  // Collapsed content is hidden AND inert (out of the tab order / a11y tree).
  await expect(detail7i).toBeHidden();
  await expect(await detail7i.evaluate((el) => (el as HTMLElement).inert)).toBe(
    true,
  );

  // Keyboard: focus + Enter expands.
  await toggle7i.focus();
  await page.keyboard.press('Enter');
  await expect(toggle7i).toHaveAttribute('aria-expanded', 'true');
  await expect(detail7i).toBeVisible();
  await expect(detail7i).toContainText('Ball speed');
  await expect(detail7i).toContainText('kph');
  await expect(detail7i).toContainText('Launch');
  await expect(detail7i).toContainText('21.0');
  await expect(detail7i).toContainText('Apex');
  // Strong-strike P80 lives in the card header ("potential") and is not
  // repeated inside the expanded card (no duplicate P80 within one card).
  await expect(detail7i).not.toContainText('Strong-strike P80');
  await expect(card7i.locator('.club-card-header')).toContainText('potential');
  // The distribution plot stretches full-width; its label carries the range,
  // and withheld rating categories name their actual reason.
  await expect(detail7i).toContainText('Carry distribution');
  await expect(detail7i).toContainText('P10–P90');
  await expect(detail7i).toContainText('insufficient eligible carry measurements');
  await expect(
    detail7i.getByRole('link', { name: /Full club profile/ }),
  ).toHaveAttribute('href', '#clubs/7i');
  // The profile action is a separate control, not nested in the expand button.
  await expect(
    card7i.getByRole('link', { name: 'Open the full 7i profile' }),
  ).toHaveAttribute('href', '#clubs/7i');

  // Clubs expand independently.
  await toggleSW.click();
  await expect(detailSW).toBeVisible();
  await expect(detail7i).toBeVisible();
  await toggle7i.click();
  await expect(detail7i).toBeHidden();
  await expect(detailSW).toBeVisible();

  // No horizontal overflow with details open on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test('?reference=edit deep link opens the personal-reference editor', async ({
  page,
  account,
}) => {
  await seed(account);
  await login(page, account);
  // The rating breakdown's "set a personal reference" action links here.
  await page.evaluate(() => {
    window.location.hash = 'clubs/7i?reference=edit';
  });
  await expect(page).toHaveURL(/#clubs\/7i\?reference=edit$/);
  const personal = page.locator('.personal-reference');
  await expect(personal).toBeVisible();
  await expect(personal.getByLabel(/Value \(m\)/)).toBeVisible();
  await expect(personal.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('shows non-authoritative automatic assessment badges in review', async ({
  page,
  account,
}) => {
  const rows = [
    ...Array.from({ length: 12 }, () => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': '160',
      'Ball Speed (kph) Premium': '150',
    })),
    {
      Club: '7i',
      'Flat Carry Dist. Premium (m)': '90',
      'Ball Speed (kph) Premium': '100',
    },
    ...Array.from({ length: 12 }, () => ({
      Club: 'SW',
      'Flat Carry Dist. Premium (m)': '100',
      'Ball Speed (kph) Premium': '90',
    })),
    {
      Club: 'SW',
      'Flat Carry Dist. Premium (m)': '45',
      'Ball Speed (kph) Premium': '55',
    },
  ];
  await account.repository.importCsv({
    filename: 'auto-assess.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  await login(page, account);
  await nav(page, 'Review');
  // Summary pill: the short+slow 7i is a likely mishit, and the short+slow SW is
  // both a likely partial and a likely mishit (intent and contact are independent).
  await expect(
    page.getByText(/auto: 2 likely mishits · 1 likely partials/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All shots', exact: true }).click();
  await expect(page.getByText('auto: likely mishit').first()).toBeVisible();
  await expect(page.getByText('auto: likely partial').first()).toBeVisible();

  // Saving a manual contact decision makes the automatic badge defer to it.
  const mishitShot = page.locator('.shot', { hasText: '90 m' }).last();
  await mishitShot.getByRole('checkbox').check();
  await page
    .getByRole('combobox', { name: /^Set contact/ })
    .selectOption('typical');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(
    page.getByText(/auto: 1 likely mishits · 1 likely partials/),
  ).toBeVisible();
  await expect(mishitShot.getByText('auto: likely mishit')).toHaveCount(0);
});

test('infers missing clubs from shot sequence and flags forgotten club switches', async ({
  page,
  account,
}) => {
  const rows = [
    ...Array.from({ length: 10 }, () => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': '160',
      'Ball Speed (kph) Premium': '150',
    })),
    ...Array.from({ length: 3 }, () => ({
      Club: '?',
      'Flat Carry Dist. Premium (m)': '159',
      'Ball Speed (kph) Premium': '149',
    })),
    ...Array.from({ length: 10 }, () => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': '161',
      'Ball Speed (kph) Premium': '151',
    })),
    ...Array.from({ length: 12 }, () => ({
      Club: '9i',
      'Flat Carry Dist. Premium (m)': '120',
      'Ball Speed (kph) Premium': '118',
    })),
    // Forgotten tablet switch: labelled 9i but hit like a driver.
    ...Array.from({ length: 10 }, () => ({
      Club: '9i',
      'Flat Carry Dist. Premium (m)': '235',
      'Ball Speed (kph) Premium': '205',
    })),
    ...Array.from({ length: 12 }, () => ({
      Club: 'D',
      'Flat Carry Dist. Premium (m)': '240',
      'Ball Speed (kph) Premium': '210',
    })),
  ];
  await account.repository.importCsv({
    filename: 'sequence.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  await login(page, account);
  await nav(page, 'Review');
  // Unknown block surrounded by 7i: sequence inference proposes 7i for all three.
  await expect(page.getByText(/Sequence: likely 7i/)).toHaveCount(3);
  // The driver-like 9i block is flagged as a possible wrong club, label kept.
  await page.getByRole('button', { name: 'All shots', exact: true }).click();
  await expect(
    page.getByText('auto: possible wrong club (D?)').first(),
  ).toBeVisible();
  const suspect = page.locator('.shot', { hasText: '235 m' }).first();
  await expect(suspect).toContainText('9i → 9i');
});

test('uses theme colours for carry bands and labels', async ({
  page,
  account,
}, testInfo) => {
  await seed(account);
  await account.repository.importCsv({
    filename: 'theme-sample.csv',
    date: shiftDate(localToday(), -1),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: true,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture(
          Array.from({ length: 10 }, () => ({
            Club: '7i',
            'Flat Carry Dist. Premium (m)': '150',
          })),
        ),
      ),
    ),
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page, account);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark')
      await page
        .getByRole('button', { name: 'Switch to dark theme' })
        .filter({ visible: true })
        .click();
    const colors = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const color = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const result = {
        ring: color('--ring-track'),
        band: color('--data'),
        label: color('--text-3'),
      };
      probe.remove();
      return result;
    });
    // Overview club cards + trend chart follow the theme tokens: the score
    // ring track, the chart series stroke and the metric labels.
    await expect(page.locator('.ds-score-ring .ring-track').first()).toHaveCSS(
      'stroke',
      colors.ring,
    );
    await expect(
      page.locator('.ds-chart .recharts-area-curve').first(),
    ).toHaveCSS('stroke', colors.band);
    await expect(page.locator('.ds-metric-label').first()).toHaveCSS(
      'color',
      colors.label,
    );
  }
  await page.screenshot({
    path: testInfo.outputPath('dark-overview.png'),
    fullPage: true,
  });
});

test('shares the analysis window and measurement basis across pages', async ({
  page,
  account,
}) => {
  for (const old of [true, false]) {
    await account.repository.importCsv({
      filename: old ? 'old.csv' : 'recent.csv',
      date: shiftDate(localToday(), old ? -100 : 0),
      time: null,
      venue: '',
      notes: '',
      confirmedFull: false,
      allowSameDay: false,
      preview: await parseCsv(
        new TextEncoder().encode(
          csvFixture(
            Array.from({ length: old ? 30 : 10 }, () => ({
              Club: '7i',
              'Flat Carry Dist. Premium (m)': old ? '70' : '120',
              'Flat Carry Dist. Range (m)': old ? '80' : '130',
              Curve: old ? '2L' : '2R',
            })),
          ),
        ),
      ),
    });
  }
  const window = page.getByRole('group', { name: 'Analysis window' });
  const basis = page.getByTitle('Change measurement basis');

  await login(page, account);
  // The Overview club list is the per-club readout; the collapsed card line
  // names the cohort statistic (median carry) explicitly.
  const overviewClubs = page.getByRole('list', { name: 'Your clubs' });
  const overview7i = overviewClubs
    .getByRole('listitem')
    .filter({ hasText: '7i' });
  await expect(overview7i).toContainText('120 m carry');
  await nav(page, 'Gapping');
  const gapping = page.getByRole('list', { name: 'Club carry distances' });
  await expect(gapping).toContainText('120 m');
  await expect(
    page.getByText(/No recurring practice patterns yet/),
  ).toBeVisible();
  await window.getByRole('button', { name: 'All-time' }).click();
  await expect(gapping).toContainText('70 m');
  await expect(
    page.getByText(/No recurring practice patterns yet/),
  ).toBeVisible();

  await nav(page, 'Overview');
  await expect(
    window.getByRole('button', { name: 'All-time' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(overview7i).toContainText('70 m carry');
  await basis.click();
  await expect(basis).toHaveText('Range · flat');

  await nav(page, 'Gapping');
  await expect(basis).toHaveText('Range · flat');
  await expect(gapping).toContainText('80 m');

  await nav(page, 'Progress');
  await expect(
    page.getByRole('heading', { name: 'Performance trend' }),
  ).toBeVisible();
  await expect(
    window.getByRole('button', { name: 'All-time' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // One interactive trend chart drives the page; the per-club session table
  // opens from its disclosure.
  await expect(
    page.getByRole('group', { name: /7i median carry per session/ }),
  ).toBeVisible();
  await page.locator('summary', { hasText: '7 iron session details' }).click();
  await expect(
    page
      .getByRole('table', { name: '7i session details', exact: true })
      .getByRole('row'),
  ).toHaveCount(3);
  await window.getByRole('button', { name: 'Recent' }).click();

  await nav(page, 'Overview');
  await expect(window.getByRole('button', { name: 'Recent' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(overview7i).toContainText('130 m carry');
  await nav(page, 'Gapping');
  await expect(gapping).toContainText('130 m');
});

test('explores progress through one interactive chart with sparse and missing data', async ({
  page,
  account,
}, testInfo) => {
  for (let i = 0; i < 3; i++) {
    const carries =
      i === 0 ? [90, 100, 110, 120] : i === 1 ? [110, 115, 120, 125] : [null];
    await account.repository.importCsv({
      filename: `progress-${i}.csv`,
      date: shiftDate(localToday(), i - 2),
      time: null,
      venue: '',
      notes: '',
      confirmedFull: false,
      allowSameDay: false,
      preview: await parseCsv(
        new TextEncoder().encode(
          csvFixture([
            ...carries.map((carry) => ({
              'Flat Carry Dist. Premium (m)':
                carry === null ? '--' : String(carry),
            })),
            { Club: '9i', 'Flat Carry Dist. Premium (m)': '60' },
          ]),
        ),
      ),
    });
  }
  await login(page, account);
  await nav(page, 'Progress');
  // One interactive trend card: club selector, metric segmented control,
  // headline + change vs the first session, tappable chart.
  const trend = page.locator('.performance-trend');
  await expect(
    page.getByRole('heading', { name: 'Performance trend' }),
  ).toBeVisible();
  await expect(page.getByLabel('Club', { exact: true })).toHaveValue('7i');
  const metricGroup = trend.getByRole('group', { name: 'Metric' });
  await expect(
    metricGroup.getByRole('button', { name: 'Carry' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const chart = page.getByRole('group', {
    name: /7i median carry per session/,
  });
  await expect(chart).toBeVisible();
  // Prominent headline: latest measured session, with the change vs the
  // clearly identified first session.
  const headline = trend.locator('.ds-metric').first();
  await expect(headline).toContainText('117.5');
  await expect(headline).toContainText('m');
  await expect(headline).toContainText(/\+12\.5 m vs first session/);
  // Compact first / latest / best session summaries.
  const summaryMetric = (label: string) =>
    trend
      .locator('.ds-metric-label', { hasText: new RegExp(`^${label}`) })
      .locator('xpath=..');
  await expect(summaryMetric('First session')).toContainText('105');
  await expect(summaryMetric('Latest session')).toContainText('117.5');
  await expect(summaryMetric('Best session')).toContainText('117.5');
  await expect(trend).toContainText(
    'Tap a point (or pick a session above) to inspect it',
  );
  // Hovering the chart shows the concise tooltip with date, value and sample.
  await chart.hover();
  const tooltip = page.locator('.ds-chart-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('measured');
  // Tapping the chart selects the nearest session (touch-friendly inspection).
  await chart.click();
  await expect(trend).toContainText(/Selected S\d ·/);
  await expect(
    trend.getByRole('link', { name: 'open session recap' }),
  ).toBeVisible();
  // Metric switch: the same chart swaps to carry spread (lower = consistent).
  await metricGroup.getByRole('button', { name: 'Spread' }).click();
  await expect(
    page.getByRole('group', { name: /7i carry spread \(iqr\) per session/ }),
  ).toBeVisible();
  await metricGroup.getByRole('button', { name: 'Carry' }).click();
  // Optional comparison series on carry: median + strong-strike potential.
  const potentialToggle = trend.getByRole('button', {
    name: /Potential \(P80\) series/,
  });
  await potentialToggle.click();
  await expect(potentialToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(trend.locator('.chart-legend')).toContainText(
    'Strong-strike potential (P80)',
  );
  await potentialToggle.click();
  // Concise cross-club comparison on compatible session measurements (median
  // carry, first vs latest measured session), with the no-proof caveat.
  const crossClub = page.getByRole('list', { name: 'Carry trend by club' });
  await expect(crossClub).toContainText('7 iron');
  await expect(crossClub).toContainText('+12.5 m');
  await expect(crossClub).toContainText('9 iron');
  await expect(crossClub).toContainText('+0.0 m');
  await expect(page.locator('.cross-club')).toContainText(
    'do not prove long-term improvement',
  );
  // Detailed session tables retained behind per-club disclosures.
  await page.locator('summary', { hasText: '7 iron session details' }).click();
  const details = page.getByRole('table', {
    name: '7i session details',
    exact: true,
  });
  await expect(details.getByRole('row').nth(1)).toContainText('105.0 m');
  await expect(details.getByRole('row').nth(1)).toContainText('15.0 m');
  await expect(details.getByRole('row').nth(2)).toContainText('117.5 m');
  await expect(details.getByRole('row').nth(2)).toContainText('7.5 m');
  await expect(details.getByRole('row').nth(3)).toContainText('No carry');
  await expect(details.getByRole('row').nth(3)).toContainText(
    'Needs 4 measured shots',
  );
  await page.locator('summary', { hasText: '9 iron session details' }).click();
  await expect(
    page.getByRole('table', { name: '9i session details', exact: true }),
  ).toContainText('60.0 m');
  await expect(details).toContainText('Sample limited');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('progress.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'All-time', exact: true }).click();
  await expect(details.getByRole('row')).toHaveCount(4);
  await page
    .getByRole('button', { name: 'Premium · flat (estimate)', exact: true })
    .click();
  await expect(details.getByRole('row').nth(1)).toContainText('No carry');
  await expect(details.getByRole('row').nth(1)).toContainText('0 / 4');
});

test('withholds an ambiguous same-day progress delta and selects chart points exactly', async ({
  page,
  account,
  hasTouch,
}) => {
  // Review A2: the first date carries a 7i visit with median 100 m and no
  // recorded time plus an 08:00 visit with median 130 m; the next day is
  // 150 m. "First" could be either same-day value, so no +50 m is fair.
  const firstDay = shiftDate(localToday(), -2);
  const nextDay = shiftDate(localToday(), -1);
  const importVisit = async (filename: string, date: string, time: string | null, carry: string) =>
    account.repository.importCsv({
      filename,
      date,
      time,
      venue: '',
      notes: '',
      confirmedFull: false,
      allowSameDay: true,
      preview: await parseCsv(
        new TextEncoder().encode(
          csvFixture([
            { Club: '7i', 'Flat Carry Dist. Premium (m)': carry },
          ]),
        ),
      ),
    });
  const untimed = await importVisit('a2-untimed.csv', firstDay, null, '100');
  const morning = await importVisit('a2-morning.csv', firstDay, '08:00', '130');
  const later = await importVisit('a2-next.csv', nextDay, null, '150');
  const sessionIds = [untimed.sessionId, morning.sessionId, later.sessionId] as const;
  await login(page, account);
  await nav(page, 'Progress');
  const trend = page.locator('.performance-trend');
  const chart = page.getByRole('group', { name: /7i median carry per session/ });
  await expect(chart).toBeVisible();
  // The headline still shows the latest measured value, but the change vs the
  // first session is explicitly withheld — not claimed as +50 m.
  const headline = trend.locator('.ds-metric').first();
  await expect(headline).toContainText('150.0');
  await expect(headline).toContainText('Change not shown');
  await expect(headline).not.toContainText('+50');
  // The cross-club comparison names the withholding reason instead of a delta.
  await expect(page.locator('.cross-club')).toContainText(
    'same-day visits in no recorded order',
  );
  await expect(
    page.getByRole('list', { name: 'Carry trend by club' }),
  ).toHaveCount(0);
  // Every visit keeps its own measured value in the session table.
  await page.locator('summary', { hasText: '7 iron session details' }).click();
  const details = page.getByRole('table', {
    name: '7i session details',
    exact: true,
  });
  await expect(details.getByRole('row')).toHaveCount(4);
  await expect(details).toContainText('100.0 m');
  await expect(details).toContainText('130.0 m');
  await expect(details).toContainText('150.0 m');
  // One curve with two subpaths leaves a gap between the unordered visits.
  const curve = await chart.locator('path.recharts-area-curve').getAttribute('d');
  expect(curve?.match(/M/g)).toHaveLength(2);
  // Review B3: a direct tap on a point selects exactly that visit — each dot
  // is an accessible control (role=button, focusable, aria-label) keyed by
  // the session UUID, which also works on phone WebKit.
  const dots = chart.locator('circle.trend-dot[role="button"]');
  await expect(dots).toHaveCount(3);
  await expect(chart.locator('circle.trend-dot[tabindex="0"]')).toHaveCount(1);
  await expect(dots.nth(0)).toHaveAttribute('aria-label', /Select S1 ·/);
  if (hasTouch) await dots.nth(2).tap();
  else await dots.nth(2).click();
  const inspect = page.getByLabel('Inspect session', { exact: true });
  await expect(inspect).toHaveValue(sessionIds[2]);
  await expect(trend).toContainText(/Selected S3 ·/);
  await expect(
    trend.getByRole('link', { name: 'open session recap' }),
  ).toHaveAttribute('href', `#sessions/${sessionIds[2]}`);
  // The native picker is retained and lists every visit by UUID.
  await inspect.selectOption(sessionIds[0]);
  await expect(trend).toContainText(/Selected S1 ·/);
  await expect(
    trend.getByRole('link', { name: 'open session recap' }),
  ).toHaveAttribute('href', `#sessions/${sessionIds[0]}`);
  await inspect.selectOption(sessionIds[1]);
  const selectedDot = chart.locator('circle.trend-dot[tabindex="0"]');
  await expect(selectedDot).toHaveAttribute('aria-label', /Select S2 ·/);
  await selectedDot.focus();
  await page.keyboard.press('Enter');
  await expect(inspect).toHaveValue(sessionIds[1]);
  await expect(trend).toContainText(/Selected S2 ·/);
  // A latest day with unknown ordering cannot name a latest measured visit.
  await importVisit('a2-next-morning.csv', nextDay, '08:00', '140');
  await page.reload();
  await expect(trend.locator('.ds-metric').first()).toContainText('Change not shown');
  await expect(trend.getByText(/Latest session ·/)).toHaveCount(0);
  await expect(trend.getByText(/First session ·/)).toHaveCount(0);
});

test('shows readable carry bands without recommending practice from overlap alone', async ({
  page,
  account,
}, testInfo) => {
  const carries = [110, 110, 120, 122, 123, 123, 124, 130, 136, 136];
  await account.repository.importCsv({
    filename: 'gapping.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture([
          ...carries.map((carry) => ({
            Club: '6i',
            'Flat Carry Dist. Premium (m)': String(carry + 25),
          })),
          ...carries.map((carry) => ({
            Club: '7i',
            'Flat Carry Dist. Premium (m)': String(carry),
          })),
          { Club: '9i', 'Flat Carry Dist. Premium (m)': '60' },
        ]),
      ),
    ),
  });
  await login(page, account);
  await nav(page, 'Gapping');
  const rows = page
    .getByRole('list', { name: 'Club carry distances' })
    .getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('123 m');
  await expect(rows.nth(1)).not.toContainText('bands overlap');
  // The P10–P90 band needs 10 shots; the 1-shot 9i row says so explicitly.
  await expect(rows.nth(2)).toContainText('P10–P90 needs 10 shots');
  // Tapping a club's band selects it and surfaces carry, spread, potential
  // and the adjacent gap in the detail panel below the shared-scale chart.
  await rows
    .nth(1)
    .getByRole('button', { name: /Median 123 m/ })
    .click();
  const detail = page.getByRole('region', { name: 'Gapping details for 7i' });
  await expect(detail).toContainText(/123\s*m/);
  await expect(detail).toContainText(/110–136\s*m/);
  await expect(detail).toContainText(/\+25\s*m/);
  await expect(detail).toContainText('10 shots');
  await expect(
    page.getByRole('list', { name: 'Adjacent club gaps' }),
  ).toContainText('+25 m');
  await expect(
    page.getByText(/No recurring practice patterns yet/),
  ).toBeVisible();
  expect(await rows.nth(1).ariaSnapshot()).toContain('Median 123 m');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('gapping.png'),
    fullPage: true,
  });
  await page.getByTitle('Change measurement basis').click();
  await expect(
    page.getByText('No comparable shots for these filters.'),
  ).toBeVisible();
});

test('renders the IQR band at true scale for a four-shot club without the P10–P90 band', async ({
  page,
  account,
}) => {
  // Review A3: carries 120/124/128/132 give Q1 = 123, Q3 = 129 (IQR eligible
  // with 4+ measured shots) but no P10–P90 (needs 10+). The shared
  // DistributionPlot used to hide the IQR behind the outer gate.
  await account.repository.importCsv({
    filename: 'iqr-four.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture(
          [120, 124, 128, 132].map((carry) => ({
            Club: '6i',
            'Flat Carry Dist. Premium (m)': String(carry),
          })),
        ),
      ),
    ),
  });
  await login(page, account);
  await nav(page, 'Gapping');
  const rows = page
    .getByRole('list', { name: 'Club carry distances' })
    .getByRole('listitem');
  await expect(rows).toHaveCount(1);
  const row = rows.nth(0);
  // Median 126 m is shown; the missing outer band is named explicitly.
  await expect(row).toContainText('126 m');
  await expect(row).toContainText('P10–P90 needs 10 shots');
  // No outer band, but the IQR band and the median line render.
  await expect(row.locator('.band-p')).toHaveCount(0);
  const iqr = row.locator('.band-iqr');
  await expect(iqr).toHaveCount(1);
  await expect(row.locator('line.median')).toHaveCount(1);
  // True scale on the shared axis: the band cohort is 123–129, so the shared
  // scale pads outward to [120, 130] and the band spans bandX(123)…bandX(129)
  // of the 300-unit viewBox — no minimum pixel width, no shifted endpoint.
  const x = Number(await iqr.evaluate((el) => el.getAttribute('x')));
  const width = Number(await iqr.evaluate((el) => el.getAttribute('width')));
  const bandX = (v: number, min: number, max: number) =>
    4 + ((v - min) / (max - min)) * (300 - 8);
  expect(x).toBeCloseTo(bandX(123, 120, 130), 5);
  expect(width).toBeCloseTo(bandX(129, 120, 130) - bandX(123, 120, 130), 5);
});

test('explains unusual iron shots and keeps review decisions explicit and reversible', async ({
  page,
  account,
}, testInfo) => {
  await account.repository.importCsv({
    filename: 'unusual-irons.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture([
          ...Array.from({ length: 20 }, (_, i) => ({
            'Flat Carry Dist. Range (m)': String(100 + (i % 5)),
            'Ball Speed (kph)': String(140 + (i % 5)),
          })),
          { 'Flat Carry Dist. Range (m)': '40', 'Ball Speed (kph)': '90' },
        ]),
      ),
    ),
  });
  const before = await account.repository.load();
  await login(page, account);
  await nav(page, 'Review');
  const focused = page.getByRole('region', {
    name: 'Focused shot',
    exact: true,
  });
  await expect(
    page.getByText('Likely mishit · experimental', { exact: false }),
  ).toBeVisible();
  const target = page.locator('.shot').filter({ hasText: 'Row 21 · Shot #21' });
  await expect(target).toContainText('40.0 m');
  await expect(target).toContainText('90.0 kph');
  await expect(target).toContainText('20 earlier paired shots');
  await expect(target).toContainText('102.0 m');
  await expect(target).toContainText('142.0 kph');
  await expect(target).toContainText('103.0 m');
  await expect(target).toContainText('143.0 kph');
  await expect(target).toContainText('67.0 m');
  await expect(target).toContainText('114.4 kph');
  expect(await account.repository.load()).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath('unusual-review.png'),
    fullPage: true,
  });
  await target.getByRole('checkbox').check();
  await page
    .getByRole('combobox', { name: /^Set contact/ })
    .selectOption('typical');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(focused.locator('.focused-label')).toContainText(
    'Row 21 · Shot #21',
  );
  await expect(target).toContainText('unknown · typical · included');
  await expect(target).not.toContainText('Likely mishit · experimental');
  await page.getByRole('button', { name: 'All shots', exact: true }).click();
  await expect(target).toBeVisible();
  await expect(target).toContainText('unknown · typical · included');
  await expect(target).toContainText('7i → 7i');
  await expect(
    page
      .getByText('Needs at least 20 earlier paired shots for this club.', {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await target.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Undo selected', exact: true })
    .click();
  await expect(target).toContainText('unknown · uncertain · included');
  await page.getByRole('button', { name: 'Open flags', exact: true }).click();
  await expect(target).toContainText('Likely mishit · experimental');
  const restored = await account.repository.load();
  expect(restored.shots.map((shot) => ({ ...shot, revision: 0 }))).toEqual(
    before.shots.map((shot) => ({ ...shot, revision: 0 })),
  );
});

test('reviews consecutive flags in one focused session without wrapping', async ({
  page,
  account,
}) => {
  const main = await seedFocusedReviews(account);
  await login(page, account);
  await nav(page, 'Review');

  const focused = page.getByRole('region', {
    name: 'Focused shot',
    exact: true,
  });
  const nearby = focused.getByRole('region', {
    name: 'Nearby source rows',
    exact: true,
  });
  const current = focused.locator('.focused-label');
  const next = focused.getByRole('button', { name: 'Next shot', exact: true });
  const previous = focused.getByRole('button', {
    name: 'Previous shot',
    exact: true,
  });
  const contact = page.getByRole('combobox', { name: /^Set contact/ });
  const clubDecision = page.getByRole('combobox', {
    name: 'Club decision',
    exact: true,
  });
  const save = page.getByRole('button', { name: 'Save review', exact: true });
  const today = localToday();
  const row = (n: number) =>
    page
      .locator('.shot')
      .filter({ hasText: `Row ${n} · Shot #${n}` })
      .filter({ hasText: today });

  // Two consecutive flagged rows, with a non-flagged neighbour in the same session.
  await expect(row(21)).toBeVisible();
  await expect(row(22)).toBeVisible();
  await row(21).getByRole('checkbox').check();
  await expect(current).toContainText('Row 21 · Shot #21');
  await expect(nearby).toContainText('Row 20 · Shot #20');
  await expect(nearby).toContainText('Row 22 · Shot #22');
  await expect(nearby).not.toContainText('3w');

  // Enter and Space work on the native navigation buttons.
  await contact.selectOption('mishit');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(current).toContainText('Row 22 · Shot #22');
  await expect(contact).toHaveValue('');
  await previous.focus();
  await page.keyboard.press('Space');
  await expect(current).toContainText('Row 21 · Shot #21');

  // Review the first flag, then advance directly to the second.
  await contact.selectOption('typical');
  await save.click();
  await expect(current).toContainText('Row 21 · Shot #21');
  await expect(row(21)).toContainText('unknown · typical · included');
  await expect(row(21)).toContainText('7i → 7i');
  await next.click();
  await expect(current).toContainText('Row 22 · Shot #22');
  await expect(row(21)).toHaveCount(0);
  await expect(row(22).getByRole('checkbox')).toBeChecked();
  await expect(contact).toHaveValue('');
  await clubDecision.selectOption('confirmed');
  await save.click();
  await expect(current).toContainText('Row 22 · Shot #22');
  await expect(row(22)).toContainText('unknown · uncertain · included');

  await expect
    .poll(async () => {
      const data = await account.repository.load();
      const shots = data.shots.filter(
        (shot) => shot.sessionId === main.sessionId,
      );
      const a = shots.find((shot) => shot.rowIndex === 21);
      const b = shots.find((shot) => shot.rowIndex === 22);
      return {
        a: a && {
          contact: a.review.contact,
          club: a.review.club.kind,
          intent: a.review.intent,
        },
        b: b && {
          contact: b.review.contact,
          club: b.review.club.kind,
          intent: b.review.intent,
        },
      };
    })
    .toEqual({
      a: { contact: 'typical', club: 'unreviewed', intent: 'unknown' },
      b: { contact: 'uncertain', club: 'confirmed', intent: 'unknown' },
    });

  // Navigation stops at this session's edges; overlapping numbers elsewhere are ignored.
  await page.getByRole('button', { name: 'All shots', exact: true }).click();
  await row(22).getByRole('checkbox').check();
  await next.click();
  await expect(current).toContainText('Row 23 · Shot #23');
  await expect(next).toBeDisabled();
  await row(1).getByRole('checkbox').check();
  await expect(current).toContainText('focused-irons.csv');
  await expect(previous).toBeDisabled();
  await expect(nearby).toContainText('Row 1 · Shot #1');
  await expect(nearby).not.toContainText('3w');
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
});

test('filters open flags, manually reviewed shots and all shots by active events', async ({
  page,
  account,
}) => {
  const main = await seedFocusedReviews(account);
  await login(page, account);
  await nav(page, 'Review');

  const openFlags = page.getByRole('button', {
    name: 'Open flags',
    exact: true,
  });
  const reviewed = page.getByRole('button', {
    name: 'Manually reviewed',
    exact: true,
  });
  const all = page.getByRole('button', { name: 'All shots', exact: true });
  const today = localToday();
  const row = (n: number) =>
    page
      .locator('.shot')
      .filter({ hasText: `Row ${n} · Shot #${n}` })
      .filter({ hasText: today });

  await expect(openFlags).toHaveAttribute('aria-pressed', 'true');
  await expect(row(21)).toBeVisible();
  await expect(row(22)).toBeVisible();
  await expect(row(20)).toHaveCount(0);
  await reviewed.click();
  await expect(page.getByText('No shots in this view.')).toBeVisible();
  await all.click();
  await expect(row(20)).toBeVisible();
  await expect(row(21)).toBeVisible();
  await expect(row(22)).toBeVisible();

  // A club confirmation and an open contact flag can coexist.
  await row(21).getByRole('checkbox').check();
  await page
    .getByRole('combobox', { name: 'Club decision', exact: true })
    .selectOption('confirmed');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(row(21)).toContainText('7i → 7i');
  await openFlags.click();
  await expect(row(21)).toBeVisible();
  await expect(row(22)).toBeVisible();
  await reviewed.click();
  await expect(row(21)).toBeVisible();
  await expect(row(22)).toHaveCount(0);

  // Undo deactivates the event, so the shot leaves the reviewed filter.
  await row(21).getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Undo selected', exact: true })
    .click();
  await all.click();
  await expect(row(21)).toContainText('unknown · uncertain · included');
  await expect
    .poll(async () => {
      const data = await account.repository.load();
      const id = data.shots.find(
        (shot) => shot.sessionId === main.sessionId && shot.rowIndex === 21,
      )?.id;
      return data.events.filter((event) => event.shotId === id && !event.undone)
        .length;
    })
    .toBe(0);
  await openFlags.click();
  await expect(row(21)).toBeVisible();
  await expect(row(22)).toBeVisible();
  await reviewed.click();
  await expect(page.getByText('No shots in this view.')).toBeVisible();
});

test('keeps the focused draft through busy, failure and retry states', async ({
  page,
  account,
}) => {
  await seedFocusedReviews(account);
  await login(page, account);
  await nav(page, 'Review');

  const focused = page.getByRole('region', {
    name: 'Focused shot',
    exact: true,
  });
  const contact = page.getByRole('combobox', { name: /^Set contact/ });
  const undo = page.getByRole('button', { name: 'Undo selected', exact: true });
  const save = page.getByRole('button', { name: 'Save review', exact: true });
  const status = page.getByRole('status').filter({ hasText: 'Saving review' });
  const current = focused.locator('.focused-label');
  const today = localToday();
  const row = (n: number) =>
    page
      .locator('.shot')
      .filter({ hasText: `Row ${n} · Shot #${n}` })
      .filter({ hasText: today });

  await row(21).getByRole('checkbox').check();
  await contact.selectOption('typical');
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route('**/rest/v1/rpc/apply_reviews', async (route) => {
    entered();
    await gate;
    await route.continue();
  });
  await save.click();
  await request;
  try {
    await expect(status).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(undo).toBeDisabled();
    await expect(contact).toBeDisabled();
    await expect(
      focused.getByRole('button', { name: 'Next shot' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'All shots' }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(status).toHaveCount(0);
  await expect(current).toContainText('Row 21 · Shot #21');
  await page.getByRole('button', { name: 'All shots', exact: true }).click();
  await expect(row(21)).toContainText('unknown · typical · included');

  // A failed save keeps the draft and the focused target; retry then succeeds.
  await page.unroute('**/rest/v1/rpc/apply_reviews');
  await row(22).getByRole('checkbox').check();
  await contact.selectOption('typical');
  await page.route('**/rest/v1/rpc/apply_reviews', (route) => route.abort());
  await save.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(contact).toHaveValue('typical');
  await expect(current).toContainText('Row 22 · Shot #22');
  await page.unroute('**/rest/v1/rpc/apply_reviews');
  await save.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row(22)).toContainText('unknown · typical · included');

  await row(22).getByRole('checkbox').check();
  await undo.click();
  await expect(row(22)).toContainText('unknown · uncertain · included');
  await expect(current).toContainText('Row 22 · Shot #22');
});

test('imports, reviews, corrects, undoes and syncs without losing originals', async ({
  page,
  browser,
  account,
}, testInfo) => {
  await login(page, account);
  await nav(
    page,
    'Sessions & import'.replace(
      ' & import',
      testInfo.project.name === 'phone-webkit' ? '' : ' & import',
    ),
  );
  await page.getByLabel('Choose CSV files').setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(fixture()),
  });
  await page.getByLabel('Session date', { exact: true }).fill(localToday());
  await page.getByRole('button', { name: 'Import valid files' }).click();
  await expect(
    page.getByText('Imported successfully.', { exact: true }),
  ).toBeVisible();
  const before = await account.repository.load();
  expect(before.shots).toHaveLength(3);
  expect(before.shots.find((s) => s.recordedClub === 'SW')?.review.intent).toBe(
    'unknown',
  );
  expect(
    before.shots
      .filter((s) => s.recordedClub === '7i')
      .every((s) => s.review.intent === 'unknown'),
  ).toBe(true);
  await page.getByRole('link', { name: /3 shots →/ }).click();
  await page.getByLabel('From source row').fill('1');
  await page.getByLabel('To source row').fill('1');
  await page.getByRole('button', { name: 'Select range' }).click();
  await page
    .getByRole('combobox', { name: 'Set contact', exact: true })
    .selectOption('typical');
  await page
    .getByRole('combobox', { name: 'Club decision', exact: true })
    .selectOption('corrected');
  await page.getByLabel('Corrected club').fill('9i');
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(page.getByText('7i → 9i', { exact: true })).toBeVisible();
  const changed = await account.repository.load();
  expect(changed.shots.find((s) => s.rowIndex === 1)?.recordedClub).toBe('7i');
  expect(changed.imports[0]?.fileHash).toBe(before.imports[0]?.fileHash);
  const second = await browser.newContext(
    testInfo.project.name === 'phone-webkit'
      ? { viewport: { width: 1440, height: 900 } }
      : {},
  );
  const other = await second.newPage();
  await login(other, account);
  await expect
    .poll(
      async () =>
        (await account.repository.load()).shots.filter(
          (s) => s.review.contact !== 'uncertain',
        ).length,
    )
    .toBe(1);
  await expect(
    other
      .getByRole('list', { name: 'Your clubs' })
      .getByRole('listitem')
      .filter({ hasText: '9i' }),
  ).toBeVisible();
  await second.close();
  await page.getByRole('button', { name: 'Select range' }).click();
  await page.getByRole('button', { name: 'Undo selected' }).click();
  await expect(page.getByText('7i → 9i', { exact: true })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await account.repository.load()).shots.find((s) => s.rowIndex === 1)
          ?.review.club.kind,
    )
    .toBe('unreviewed');
  await nav(page, 'Settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^shotwise-backup-/);
  const dataset = await account.repository.load();
  const roundTrip = await parseBackup(serializeBackup(dataset));
  expect(roundTrip.shots.map((s) => s.id).sort()).toEqual(
    dataset.shots.map((s) => s.id).sort(),
  );
  await page.screenshot({
    path: testInfo.outputPath('settings.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('preserves drafts through focus refresh, network failure and stale-save conflict', async ({
  page,
  account,
}, testInfo) => {
  await seed(account);
  await login(page, account);
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await page.getByRole('link', { name: /3 shots →/ }).click();
  await page.getByLabel('Notes', { exact: true }).fill('Draft to keep');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Draft to keep',
  );
  await page.route('**/rest/v1/rpc/dataset_version', (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('heading', { name: 'Couldn’t load your data' }),
  ).toBeVisible();
  await page.unroute('**/rest/v1/rpc/dataset_version');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Draft to keep',
  );
  const data = await account.repository.load();
  const session = data.sessions[0];
  if (!session) throw new Error('Missing test session');
  await account.repository.updateSession({
    ...session,
    notes: 'Changed elsewhere',
  });
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another device');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Draft to keep',
  );
  await page
    .getByRole('button', { name: 'Retry my changes', exact: true })
    .click();
  await expect
    .poll(async () => (await account.repository.load()).sessions[0]?.notes)
    .toBe('Draft to keep');
});

test('keeps metadata stable while a save is pending', async ({
  page,
  account,
}, testInfo) => {
  await seed(account);
  await login(page, account);
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await page.getByRole('link', { name: /3 shots →/ }).click();
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Saved without losing edits');
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route('**/rest/v1/rpc/update_session', async (route) => {
    entered();
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await request;
  try {
    await expect(page.getByLabel('Notes', { exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect
    .poll(async () => (await account.repository.load()).sessions[0]?.notes)
    .toBe('Saved without losing edits');
});

test('retries duplicate imports, restores private backup and renders accessible responsive analytics', async ({
  page,
  account,
}, testInfo) => {
  await seed(account);
  const original = await account.repository.load();
  const again = await account.repository.importCsv({
    filename: 'renamed.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: true,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(fixture())),
  });
  expect(again.duplicate).toBe(true);
  await login(page, account);
  const clubPanel = page.getByRole('region', { name: 'Club performance' });
  await expect(clubPanel.getByText('3 shots', { exact: false })).toBeVisible();
  const clubList = page.getByRole('list', { name: 'Your clubs' });
  await expect(
    clubList.getByRole('listitem').filter({ hasText: '7i' }),
  ).toBeVisible();
  await expect(clubList.getByRole('listitem')).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('overview.png'),
    fullPage: true,
  });
  // Per-metric distribution tables sit behind the details disclosure.
  await page.locator('summary', { hasText: 'Distribution details' }).click();
  const tables = page.getByRole('table');
  await expect(tables.first()).toBeVisible();
  await expect(tables.first().getByRole('row')).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await nav(page, 'Progress');
  await expect(
    page.getByRole('heading', { name: 'Performance trend' }),
  ).toBeVisible();
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await page.getByLabel('Choose CSV files').setInputFiles({
    name: 'renamed.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(fixture()),
  });
  await page.getByLabel('Session date', { exact: true }).fill(localToday());
  await page.getByRole('button', { name: 'Import valid files' }).click();
  await expect(
    page.getByText('Duplicate export — already imported.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Session details' }),
  ).toHaveCount(0);
  const duplicateRecap = page.getByRole('link', {
    name: 'View recap',
    exact: true,
  });
  await expect(duplicateRecap).toHaveAttribute(
    'href',
    `#sessions/${again.sessionId}`,
  );
  await duplicateRecap.click();
  await expect(
    page.getByRole('region', { name: 'Session details' }),
  ).toContainText('synthetic.csv');
  const otherEmail = `restore-${crypto.randomUUID()}@example.test`;
  const otherPassword = crypto.randomUUID() + 'Aa1!';
  const otherUser = await admin.auth.admin.createUser({
    email: otherEmail,
    password: otherPassword,
    email_confirm: true,
  });
  if (!otherUser.data.user) throw new Error('Could not create restore user');
  const otherClient = createClient(stack.API_URL, stack.PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  await otherClient.auth.signInWithPassword({
    email: otherEmail,
    password: otherPassword,
  });
  const otherRepo = createRepository(otherClient);
  await otherRepo.restore(await parseBackup(serializeBackup(original)));
  const restored: Dataset = await otherRepo.load();
  expect(restored.shots.map((s) => s.id).sort()).toEqual(
    original.shots.map((s) => s.id).sort(),
  );
  await expect(otherRepo.restore(original)).rejects.toThrow('empty dataset');
  await admin.auth.admin.deleteUser(otherUser.data.user.id);
});

test('keeps the active tab after a reload', async ({ page, account }) => {
  await login(page, account);
  await nav(page, 'Progress');
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#progress');
});

test('shows measured shot shapes with explicit missingness and keyboard-accessible shot inspection', async ({
  page,
  account,
}, testInfo) => {
  await account.repository.importCsv({
    filename: 'shapes.csv',
    date: localToday(),
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture([
          {
            'Launch Direction': '5L',
            Curve: '3R',
            'From Centre (m)': '12R',
            'Flat Carry Dist. Premium (m)': '105',
          },
          {
            'Launch Direction': '0',
            Curve: '0',
            'Flat Carry Dist. Premium (m)': '110',
          },
          { 'Launch Direction': '--', Curve: '2L', 'From Centre (m)': '8L' },
          { 'Launch Direction': '2R', Curve: '--' },
          {
            Club: 'SW',
            'Launch Direction': '4R',
            Curve: '6L',
            'From Centre (m)': '9L',
            'Flat Carry Dist. Premium (m)': '88',
          },
          { Club: 'SW', 'Launch Direction': '--', Curve: '1R' },
        ]),
      ),
    ),
  });
  await login(page, account);
  await nav(page, 'Shot shape');
  const clubSelect = page.getByRole('combobox', { name: 'Club', exact: true });
  const plot = page.getByRole('group', {
    name: '7i recorded shot shapes',
    exact: true,
  });
  const detail7i = page.getByRole('region', {
    name: 'Selected shot measurements for 7i',
    exact: true,
  });
  const detailSw = page.getByRole('region', {
    name: 'Selected shot measurements for SW',
    exact: true,
  });
  const prompt = 'Select a shot to see its recorded measurements.';
  // One club is plotted at a time; the first club in club order is default.
  await expect(clubSelect).toHaveValue('7i');
  await expect(detail7i).toContainText(prompt);
  await expect(plot.getByRole('button')).toHaveCount(2);
  await expect(
    page.getByRole('group', { name: 'SW recorded shot shapes' }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      '2 of 4 shots have both measurements; 2 are absent from the plot.',
      { exact: true },
    ),
  ).toBeVisible();
  await clubSelect.selectOption('SW');
  const swPlot = page.getByRole('group', {
    name: 'SW recorded shot shapes',
    exact: true,
  });
  await expect(swPlot.getByRole('button')).toHaveCount(1);
  await expect(
    page.getByText(
      '1 of 2 shots have both measurements; 1 are absent from the plot.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(detailSw).toContainText(prompt);
  await clubSelect.selectOption('7i');
  const point7i = plot.getByRole('button', { name: /Plot 7i row 1/ });
  await point7i.click();
  await expect(point7i).toHaveAttribute('aria-pressed', 'true');
  await expect(detail7i).toContainText('5.0° left');
  await expect(detail7i).toContainText('3.0 m right');
  await expect(detail7i).toContainText('12.0 m right');
  await expect(detail7i).toContainText('105.0 m');
  await clubSelect.selectOption('SW');
  const pointSw = swPlot.getByRole('button', { name: /Plot SW row 5/ });
  await pointSw.click();
  await expect(pointSw).toHaveAttribute('aria-pressed', 'true');
  await expect(detailSw).toContainText('SW · Row 5');
  await expect(detailSw).toContainText('4.0° right');
  await expect(detailSw).toContainText('6.0 m left');
  await expect(detailSw).toContainText('9.0 m left');
  await expect(detailSw).toContainText('88.0 m');
  await openDisclosure(page, 'Shot measurements (2)');
  const swTable = page.getByRole('table', {
    name: 'SW shot measurements',
    exact: true,
  });
  await swTable
    .getByRole('button', { name: 'Inspect row 6', exact: true })
    .click();
  await expect(detailSw).toContainText('SW · Row 6');
  await expect(detailSw).toContainText('Launch: Missing');
  await clubSelect.selectOption('7i');
  // The SW selection is not part of the 7i club, so 7i shows the prompt again.
  await expect(detail7i).toContainText(prompt);
  await openDisclosure(page, 'Shot measurements (4)');
  const table = page.getByRole('table', {
    name: '7i shot measurements',
    exact: true,
  });
  const inspectZero = table.getByRole('button', {
    name: 'Inspect row 2',
    exact: true,
  });
  await inspectZero.focus();
  await page.keyboard.press('Enter');
  await expect(detail7i).toContainText('0.0° straight');
  await expect(detail7i).toContainText('0.0 m straight');
  await expect(
    table
      .getByRole('row')
      .filter({
        has: page.getByRole('button', { name: 'Inspect row 3', exact: true }),
      })
      .getByRole('cell')
      .nth(2),
  ).toHaveText('Missing');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('shot-shapes.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Premium · flat (estimate)', exact: true })
    .click();
  await expect(detail7i).toContainText('Carry: Missing');
  await expect(plot.getByRole('button')).toHaveCount(2);
  await nav(page, 'Overview');
  await expect(
    page.getByRole('button', { name: 'Range · flat', exact: true }),
  ).toBeVisible();
  await nav(page, 'Shot shape');
  await expect(
    page.getByRole('button', { name: 'Range · flat', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Shot shape', exact: true }),
  ).toBeVisible();
});

test('imports filename dates without confirmation and requires manual dates only when missing', async ({
  page,
  account,
}, testInfo) => {
  await login(page, account);
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await page.getByLabel('Choose CSV files').setInputFiles({
    name: `shots_${localToday()}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(fixture()),
  });
  await expect(page.getByLabel('Session date', { exact: true })).toHaveValue(
    localToday(),
  );
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Import valid files', exact: true })
    .click();
  await expect(
    page.getByText('Imported successfully.', { exact: true }),
  ).toBeVisible();
  expect(
    (await account.repository.load()).shots.every(
      (s) => s.review.intent === 'unknown',
    ),
  ).toBe(true);
  await page.getByLabel('Choose CSV files').setInputFiles({
    name: 'export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvFixture([{ 'Carry Dist. Range (m)': '103' }])),
  });
  const manual = page.locator('.preview').filter({
    has: page.getByRole('heading', { name: 'export.csv', exact: true }),
  });
  await expect(manual.getByLabel('Session date', { exact: true })).toHaveValue(
    '',
  );
  await page
    .getByRole('button', { name: 'Import valid files', exact: true })
    .click();
  await expect(manual).toContainText(
    'Enter a valid session date before importing.',
  );
  expect((await account.repository.load()).sessions).toHaveLength(1);
  await manual
    .getByLabel('Session date', { exact: true })
    .fill(shiftDate(localToday(), -1));
  await page
    .getByRole('button', { name: 'Import valid files', exact: true })
    .click();
  await expect(manual).toContainText('Imported successfully.');
  await page.getByLabel('Choose CSV files').setInputFiles({
    name: `another_${localToday()}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csvFixture([{ 'Carry Dist. Range (m)': '115' }])),
  });
  await page
    .getByRole('button', { name: 'Import valid files', exact: true })
    .click();
  await expect(
    page.getByText('Same-day import requires acknowledgement', { exact: true }),
  ).toBeVisible();
  expect((await account.repository.load()).sessions).toHaveLength(2);
  await page
    .getByLabel('Session date', { exact: true })
    .last()
    .fill(shiftDate(localToday(), -1));
  await expect(
    page.getByRole('button', {
      name: 'Import as a separate session',
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Import valid files', exact: true })
    .click();
  await expect(
    page.getByText('Same-day import requires acknowledgement', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Import as a separate session', exact: true })
    .click();
  await expect(
    page.getByText('Imported successfully.', { exact: true }),
  ).toHaveCount(3);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const saved = (await account.repository.load()).sessions;
  expect(saved).toHaveLength(3);
  const first = saved.find((s) => s.filename === 'export.csv');
  const separate = saved.find(
    (s) => s.filename === `another_${localToday()}.csv`,
  );
  expect(first?.date).toBe(separate?.date);
  expect(first?.id).not.toBe(separate?.id);
  const sameDayRecap = page
    .locator('.preview')
    .last()
    .getByRole('link', { name: 'View recap' });
  await expect(sameDayRecap).toHaveAttribute(
    'href',
    `#sessions/${separate?.id}`,
  );
  await sameDayRecap.click();
  await expect(
    page.getByRole('region', { name: 'Session details' }),
  ).toContainText(separate?.filename ?? 'missing session');
  await page.goBack();
  await expect(sameDayRecap).toBeFocused();
  await manual.getByRole('link', { name: 'View recap' }).click();
  await expect(
    page.getByRole('region', { name: 'Session details' }),
  ).toContainText('export.csv');
});

test('opens saved recaps and supporting shots from imports and the logbook', async ({
  page,
  account,
}, testInfo) => {
  await login(page, account);
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await expect(
    page.getByText('No sessions yet. Import a CSV above to begin.'),
  ).toBeVisible();

  const today = localToday();
  const history = [shiftDate(today, -4), shiftDate(today, -2)];
  const exportFile = (date: string, carries: (number | null)[]) => ({
    name: `recap_${date}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(
      csvFixture(
        carries.map((carry) => ({
          Club: '7i',
          'Flat Carry Dist. Premium (m)': carry === null ? '' : String(carry),
          'Flat Carry Dist. Range (m)': '90',
        })),
      ),
    ),
  });
  const [older, prior] = history.map((date, offset) =>
    exportFile(
      date,
      Array.from({ length: 16 }, (_, i) => 90 + offset + (i % 4) * 4),
    ),
  );
  if (!older || !prior) throw new Error('Missing historical fixtures');
  const recent = exportFile(today, [
    ...Array.from({ length: 12 }, (_, i) => 120 + (i % 4)),
    null,
  ]);
  const picker = page.getByLabel('Choose CSV files');
  const importFiles = page.getByRole('button', { name: 'Import valid files' });
  const recapLink = (filename: string) =>
    page
      .locator('.preview')
      .filter({
        has: page.getByRole('heading', { name: filename, exact: true }),
      })
      .getByRole('link', { name: 'View recap', exact: true });
  const details = page.getByRole('region', { name: 'Session details' });
  const heading = details.getByRole('heading', { name: 'Session details' });
  const recap = details.getByRole('region', { name: 'Session recap' });

  await picker.setInputFiles([older, prior]);
  await importFiles.click();
  await expect(
    page.getByRole('link', { name: 'View recap', exact: true }),
  ).toHaveCount(2);
  await expect(details).toHaveCount(0);
  expect(await recapLink(older.name).getAttribute('href')).not.toBe(
    await recapLink(prior.name).getAttribute('href'),
  );
  await recapLink(older.name).click();
  await expect(heading).toBeFocused();
  await expect(recap).toContainText('Sparse comparable history');
  const olderClub = recap
    .locator('details')
    .filter({ hasText: '7i metric details' });
  await olderClub.locator('summary').click();
  const withheldCarry = olderClub.locator('.ds-metric', {
    hasText: 'Carry vs baseline',
  });
  await expect(withheldCarry).toContainText('Withheld');
  await expect(withheldCarry).not.toContainText('m vs');
  await page.goBack();
  await expect(recapLink(older.name)).toBeFocused();
  await expect(details).toHaveCount(0);

  await picker.setInputFiles(recent);
  await importFiles.click();
  await recapLink(recent.name).click();
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(recap).toContainText('13 recorded · 13 included shots');
  await expect(recap).toContainText('Median carry 25 m longer');
  await expect(recap).toContainText('Carry spread 4.5 m tighter');
  await expect(recap).toContainText('12 measured shots vs');
  await recap.screenshot({ path: testInfo.outputPath('session-recap.png') });

  const club = recap
    .locator('details')
    .filter({ hasText: '7i metric details' });
  await expect(club).not.toHaveAttribute('open', '');
  await club.locator('summary').click();
  // Unreviewed CSV shots are automatically assessed, so the assessed metric
  // uses the resolved full-swing population as its denominator.
  const assessed = club.locator('.ds-metric', {
    hasText: 'Assessed (manual or automatic)',
  });
  await expect(assessed.locator('.ds-metric-value')).toContainText('of 13');
  const carryVsBaseline = club.locator('.ds-metric', {
    hasText: 'Carry vs baseline',
  });
  await expect(carryVsBaseline).toContainText('m vs');
  const broader = club
    .locator('.recap-metric')
    .filter({ hasText: 'Median carry · broader estimate' });
  await expect(broader).toContainText('12 measured, 1 missing');
  await expect(broader).toContainText(
    '32 measured, 0 missing · 2 sessions across 2 dates',
  );
  await expect(broader).toContainText(history[0] ?? 'missing date');
  await expect(broader).toContainText(history[1] ?? 'missing date');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await broader.screenshot({ path: testInfo.outputPath('recap-metric.png') });

  const evidence = details.getByRole('region', { name: 'Supporting shots' });
  const priorEvidence = broader
    .getByRole('listitem')
    .filter({ hasText: history[1] })
    .getByRole('link');
  await priorEvidence.click();
  await expect(
    evidence.getByRole('heading', { name: 'Supporting shots' }),
  ).toBeFocused();
  await expect(
    evidence.getByRole('heading', { name: 'Supporting shots' }),
  ).toBeInViewport();
  await expect(evidence).toContainText(
    `${history[1]} · Premium · flat (estimate) · 16 measured shots`,
  );
  await expect(evidence.getByRole('checkbox')).toHaveCount(16);
  await page.goBack();
  await expect(heading).toBeFocused();
  await expect(club).toHaveAttribute('open', '');

  await recap
    .getByRole('button', { name: 'Premium · flat (estimate)', exact: true })
    .click();
  await expect(
    recap.getByRole('button', { name: 'Range · flat', exact: true }),
  ).toBeVisible();
  await expect(recap).toContainText(
    'No noteworthy changes in the comparable metrics.',
  );
  await nav(page, 'Overview');
  await expect(
    page.getByRole('button', { name: 'Range · flat', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(recap).toContainText(
    'No noteworthy changes in the comparable metrics.',
  );

  await page.reload();
  await expect(heading).toBeFocused();
  await expect(details).toContainText(recent.name);
  const carry = recap
    .locator('.recap-highlights li')
    .filter({ hasText: 'Median carry 25 m longer' });
  await carry.getByRole('link', { name: 'View supporting shots' }).click();
  await expect(
    evidence.getByRole('heading', { name: 'Supporting shots' }),
  ).toBeFocused();
  await expect(evidence.getByRole('checkbox')).toHaveCount(12);
  await evidence.getByLabel('From source row').fill('1');
  await evidence.getByLabel('To source row').fill('3');
  await evidence.getByRole('button', { name: 'Select range' }).click();
  await evidence
    .getByRole('combobox', { name: 'Exclusion', exact: true })
    .selectOption('excluded');
  await evidence.getByLabel('Exclusion reason').fill('Synthetic review');
  await evidence.getByRole('button', { name: 'Save review' }).click();
  await expect(evidence.getByRole('checkbox')).toHaveCount(9);
  await expect(
    evidence.getByRole('region', { name: 'Nearby source rows' }),
  ).toContainText('Row 3 · Shot #3');
  await expect(recap).toContainText('13 recorded · 10 included shots');
  await expect(recap).not.toContainText('Median carry 25 m longer');
  await expect(recap).not.toContainText('Carry spread 4.5 m tighter');
  await page.goBack();
  await expect(heading).toBeFocused();
  await page.getByRole('link', { name: new RegExp(older.name) }).click();
  await expect(recap).toContainText('Sparse comparable history');
  await expect(recap).toContainText('16 recorded · 16 included shots');
});

test('caps next practice at three distinct actions and opens the measured shots for each visit', async ({
  page,
  account,
}, testInfo) => {
  const dates = [shiftDate(localToday(), -2), localToday()];
  const saved = [];
  for (const [index, date] of dates.entries()) {
    const row = (club: string, carry: number, curve = '0') => ({
      Club: club,
      'Flat Carry Dist. Premium (m)': String(carry + index),
      'Flat Carry Dist. Range (m)': String(carry - 10 + index),
      Curve: curve,
    });
    const rows = [
      ...Array.from({ length: 10 }, () => row('D', 220, '3L')),
      ...Array.from({ length: 10 }, () => row('3w', 195, '4R')),
      ...Array.from({ length: 10 }, () => row('5i', 160)),
      ...Array.from({ length: 10 }, () => row('6i', 155)),
      ...Array.from({ length: 12 }, (_, i) => row('7i', i % 2 ? 90 : 130)),
      { Club: '5i', Curve: '0' },
    ];
    saved.push(
      await account.repository.importCsv({
        filename: `practice-${date}.csv`,
        date,
        time: '10:00',
        venue: 'Synthetic range',
        notes: '',
        confirmedFull: false,
        allowSameDay: false,
        preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
      }),
    );
  }

  await login(page, account);
  const practice = page.getByRole('region', { name: 'Next practice' });
  const actions = practice.locator('ol > li');
  await expect(actions).toHaveCount(3);
  const titles = await actions.getByRole('heading').allTextContents();
  expect(new Set(titles).size).toBe(3);
  expect(titles[0]).toBe('5i and 6i · Small median gap');
  await expect(actions.first()).toContainText('2 dates · 40 measured shots');
  await expect(actions.first()).toContainText(
    'Alternate 5i and 6i at the same aim line',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await practice.evaluate((section) =>
    section.scrollIntoView({ block: 'start', behavior: 'instant' }),
  );
  await page.screenshot({ path: testInfo.outputPath('next-practice.png') });

  const evidence = page.getByRole('region', { name: 'Supporting shots' });
  const heading = evidence.getByRole('heading', { name: 'Supporting shots' });
  await actions
    .filter({ hasText: '3w · Repeated right curve' })
    .getByRole('link', { name: 'View latest supporting shots' })
    .click();
  await expect(heading).toBeFocused();
  await expect(evidence).toContainText('Recorded curve · 10 measured shots');
  await expect(evidence.getByText('3w → 3w', { exact: true })).toHaveCount(10);
  await page.goBack();

  await practice.getByRole('link', { name: 'See all in Gapping' }).click();
  await expect(
    page.getByRole('heading', { name: 'Club gapping' }),
  ).toBeFocused();
  const gapping = page.getByRole('region', { name: 'Practice insights' });
  await expect(gapping.locator('ol > li')).toHaveCount(4);
  await page.getByTitle('Change measurement basis').click();
  const gap = gapping.locator('ol > li').first();
  await expect(gap).toContainText(
    '5i median 151 m (10 measured, 1 missing), 6i median 146 m (10 measured)',
  );
  const latest = gap.getByRole('link', {
    name: 'View latest supporting shots',
  });
  await expect(latest).toHaveAttribute(
    'href',
    new RegExp(`#sessions/${saved[1]?.sessionId}\\?`),
  );
  await latest.click();

  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(evidence).toContainText('Range · flat · 20 measured shots');
  await expect(evidence.getByRole('checkbox')).toHaveCount(20);
  await expect(
    evidence.getByText('Flat Carry Dist. Range (m) 151', { exact: true }),
  ).toHaveCount(10);
  await expect(evidence.getByText('6i → 6i', { exact: true })).toHaveCount(10);

  await page.goBack();
  await expect(gap).toContainText('5i median 151 m');
  await gap.getByText('Other supporting visits').click();
  const older = gap.getByRole('link', {
    name: 'View supporting shots',
    exact: true,
  });
  await expect(older).toHaveAttribute(
    'href',
    new RegExp(`#sessions/${saved[0]?.sessionId}\\?`),
  );
  await older.click();
  await page.reload();
  await expect(heading).toBeFocused();
  await expect(evidence).toContainText('Range · flat · 20 measured shots');
  await expect(
    evidence.getByText('Flat Carry Dist. Range (m) 150', { exact: true }),
  ).toHaveCount(10);
  await evidence.getByRole('link', { name: 'View full session recap' }).click();
  await expect(
    page.getByRole('region', { name: 'Session recap' }),
  ).toContainText(dates[0] ?? 'missing date');
});

test('shows exact wedge target groups and keeps unknown swings out of full-swing gapping', async ({
  page,
  account,
}, testInfo) => {
  const date = localToday();
  const row = (
    club: string,
    target: string,
    premium: string,
    range: string,
  ) => ({
    Club: club,
    'Target (m)': target,
    'Flat Carry Dist. Premium (m)': premium,
    'Flat Carry Dist. Range (m)': range,
  });
  await account.repository.importCsv({
    filename: 'wedge-practice.csv',
    date,
    time: '10:00',
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture([
          {
            ...row('SW', '30', '28', '24'),
            'Prox to Hole (m)': '3',
            'Launch Direction': '2L',
            'Ball Speed (kph) Premium': '70',
          },
          {
            ...row('SW', '30', '30', '26'),
            'Prox to Hole (m)': '0',
            'Launch Direction': '0',
          },
          {
            ...row('SW', '30', '34', '30'),
            'Prox to Hole (m)': '5',
            'Launch Direction': '2R',
          },
          { ...row('7i', '30', '32', '28'), 'Launch Direction': '8R' },
          row('SW', '30', '--', '--'),
          row('SW', '30.04', '31', '--'),
          row('SW', '0', '50', '48'),
          row('SW', '--', '65', '64'),
          row('SW', '--', '45', '44'),
          row('7i', '--', '150', '145'),
        ]),
      ),
    ),
  });
  const original = await account.repository.load();
  await account.repository.review(
    original.shots.flatMap((shot) => {
      if (![2, 4, 8, 9].includes(shot.rowIndex)) return [];
      const review = { ...shot.review };
      if (shot.rowIndex === 4) review.club = { kind: 'corrected', club: 'SW' };
      if (shot.rowIndex === 8) review.intent = 'full';
      if (shot.rowIndex === 2 || shot.rowIndex === 9) review.intent = 'partial';
      return [{ shotId: shot.id, expectedRevision: shot.revision, review }];
    }),
  );

  await login(page, account);
  await nav(page, 'Gapping');
  const section = page.getByRole('region', { name: 'Wedge practice' });
  const target = section.getByRole('article', {
    name: 'SW · 30 m target',
    exact: true,
  });
  const sparse = section.getByRole('article', {
    name: 'SW · 30.04 m target',
    exact: true,
  });
  const benchmark = page
    .getByRole('list', { name: 'Club carry distances' })
    .getByRole('listitem')
    .filter({ hasText: 'SW' });

  await expect(section).toContainText(
    '6 of 9 wedge shots have a recorded target',
  );
  await expect(section).toContainText('2 missing target · 1 recorded as 0 m');
  await expect(target).toContainText(
    '5 shots · 1 session · 0 full, 1 partial, 4 unknown intent',
  );
  await expect(target).toContainText(
    'Median carry 31 m · 4 of 5 measured · Middle half spans 3 m',
  );
  await expect(target.locator('.band-iqr')).toHaveCount(1);
  await expect(target.locator('.band-p')).toHaveCount(0);
  await expect(target).toContainText(
    'Median ball speed 70 kph · 1 of 5 measured',
  );
  await expect(target).toContainText(
    'Launch direction · 1 left, 1 centred, 1 right · 3 of 3 measured',
  );
  await expect(sparse).toContainText('Carry spread needs 4 measured shots');
  for (const intent of ['Full', 'Partial', 'Unknown']) {
    await expect(
      section.getByRole('article', {
        name: `SW · ${intent} intent`,
        exact: true,
      }),
    ).toContainText('1 shot');
  }
  await expect(benchmark).toContainText('65 m');

  // The shot-level scatter opens per group and plots the measured carries
  // (the shot with a missing carry is not plotted, never as zero).
  await target.getByRole('button', { name: 'Shot scatter: hidden' }).click();
  const scatter = target.getByRole('group', {
    name: 'SW · 30 m target carry per shot',
  });
  await expect(scatter).toBeVisible();
  await expect(scatter.locator('circle')).toHaveCount(4);

  await page.getByTitle('Change measurement basis').click();
  await expect(section).toContainText('Range · flat');
  await expect(target).toContainText('Median carry 27 m');
  await expect(sparse).toContainText(
    'Median carry unavailable · 0 of 1 measured',
  );
  await target.getByText('View 5 shot rows', { exact: true }).click();
  const evidence = target.getByRole('table', {
    name: 'SW · 30 m target shots',
  });
  await expect(evidence.getByRole('row')).toHaveCount(6);
  await expect(evidence.locator('tbody td:nth-child(4)')).toHaveText(
    Array(5).fill('30 m'),
  );
  await expect(evidence.getByRole('row').nth(1)).toContainText('24 m');
  await expect(evidence.getByRole('row').nth(2)).toContainText('Partial');
  await expect(evidence.getByRole('row').nth(4)).toContainText('28 m');
  await expect(evidence.getByRole('row').nth(5)).toContainText('Missing');
  const shotRows = target.getByRole('region', {
    name: 'SW · 30 m target shot rows',
  });
  await expect
    .poll(() =>
      shotRows.evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await section.evaluate((element) =>
    element.scrollIntoView({ block: 'start', behavior: 'instant' }),
  );
  await page.screenshot({
    path: testInfo.outputPath('wedge-practice.png'),
    animations: 'disabled',
  });
  await shotRows.screenshot({
    path: testInfo.outputPath('wedge-shot-rows.png'),
  });

  await evidence
    .getByRole('link', { name: date + ' · 10:00' })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Session details' }),
  ).toBeFocused();
  await page.getByLabel('From source row').fill('1');
  await page.getByLabel('To source row').fill('1');
  await page.getByRole('button', { name: 'Select range' }).click();
  await page.getByRole('combobox', { name: 'Set intent' }).selectOption('full');
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(
    page.getByText('full · uncertain · included', { exact: true }),
  ).toHaveCount(2);
  await page.goBack();
  await expect(benchmark).toContainText('44 m');
  await expect(target).toContainText('1 full, 1 partial, 3 unknown intent');
});

const CORRECTION_FILENAME = 'consecutive-correction.csv';
const CORRECTION_LABEL = '6i';
const CORRECTION_TIME = '10:00';

async function seedClubCorrection(account: Account) {
  const date = localToday();
  const result = await account.repository.importCsv({
    filename: CORRECTION_FILENAME,
    date,
    time: CORRECTION_TIME,
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(
      new TextEncoder().encode(
        csvFixture(
          Array.from({ length: 14 }, (_, i) => ({
            'Flat Carry Dist. Range (m)': String(100 + (i % 5)),
            'Ball Speed (kph)': String(140 + (i % 5)),
            'Flat Carry Dist. Premium (m)': String(120 + (i % 5)),
          })),
        ),
      ),
    ),
  });
  const data = await account.repository.load();
  const at = (row: number) => {
    const shot = data.shots.find(
      (s) => s.sessionId === result.sessionId && s.rowIndex === row,
    );
    if (!shot) throw new Error(`Missing seeded row ${row}`);
    return shot;
  };
  const reviewedContact = at(1);
  const confirmed = at(2);
  const corrected = at(11);
  // Two pre-reviewed labels inside the 12-row selection; both must be skipped.
  await account.repository.review([
    {
      shotId: reviewedContact.id,
      expectedRevision: reviewedContact.revision,
      review: {
        ...reviewedContact.review,
        intent: 'partial',
        contact: 'typical',
        exclusion: { kind: 'excluded', reason: 'Synthetic exclusion' },
      },
    },
    {
      shotId: confirmed.id,
      expectedRevision: confirmed.revision,
      review: { ...confirmed.review, club: { kind: 'confirmed' } },
    },
    {
      shotId: corrected.id,
      expectedRevision: corrected.revision,
      review: {
        ...corrected.review,
        club: { kind: 'corrected', club: '8i' },
      },
    },
  ]);
  return date;
}

async function openCorrectionSession(
  page: Page,
  account: Account,
  testInfo: TestInfo,
) {
  await login(page, account);
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await page.getByRole('link', { name: /consecutive-correction\.csv/ }).click();
}

async function selectCorrectionRange(page: Page, from: number, to: number) {
  await page.getByLabel('From source row', { exact: true }).fill(String(from));
  await page.getByLabel('To source row', { exact: true }).fill(String(to));
  await page.getByRole('button', { name: 'Select range', exact: true }).click();
}

async function openCorrectionPreview(page: Page, club = CORRECTION_LABEL) {
  await page
    .getByRole('combobox', { name: 'Club decision', exact: true })
    .selectOption('corrected');
  await page.getByLabel('Corrected club', { exact: true }).fill(club);
  await page
    .getByRole('button', { name: 'Preview club correction', exact: true })
    .click();
  return page.getByRole('region', {
    name: 'Club correction preview',
    exact: true,
  });
}

test('previews, applies and exactly undoes a ten-row club correction without touching originals or skipped decisions', async ({
  page,
  account,
}, testInfo) => {
  const date = await seedClubCorrection(account);
  const before = await account.repository.load();
  const appliedIds = new Set(
    before.shots
      .filter(
        (shot) => shot.rowIndex <= 12 && shot.review.club.kind === 'unreviewed',
      )
      .map((shot) => shot.id),
  );
  expect(appliedIds.size).toBe(10);
  await openCorrectionSession(page, account, testInfo);

  // Record writes issued by the page: preview and cancel must be read-only.
  let writes = 0;
  await page.route('**/rest/v1/rpc/apply_reviews', (route) => {
    writes++;
    return route.continue();
  });
  await page.route('**/rest/v1/rpc/undo_reviews', (route) => {
    writes++;
    return route.continue();
  });

  await selectCorrectionRange(page, 1, 12);
  await expect(page.getByText('12 selected', { exact: true })).toBeVisible();
  const preview = await openCorrectionPreview(page);
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('heading')).toBeFocused();
  await expect(preview).toContainText(CORRECTION_FILENAME);
  await expect(preview).toContainText(date);
  await expect(preview).toContainText(CORRECTION_TIME);
  await expect(preview).toContainText('7i'); // old effective label
  await expect(preview).toContainText(CORRECTION_LABEL); // proposed label
  await expect(preview).toContainText('8i'); // corrected row's effective label
  await expect(preview).toContainText(/skip/i); // skipped confirmed + corrected
  await expect(preview).toContainText('10 of 12 selected rows will change');
  await expect(
    page.getByRole('button', { name: 'Save review', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel('Corrected club', { exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    preview.getByRole('button', { name: 'Apply club correction', exact: true }),
  ).toBeVisible();
  const cancel = preview.getByRole('button', {
    name: 'Cancel preview',
    exact: true,
  });
  await expect(cancel).toBeVisible();

  // Native-button keyboard activation; cancelling writes nothing.
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(preview).toHaveCount(0);
  expect(writes).toBe(0);
  expect(await account.repository.load()).toEqual(before);

  // Re-open with the same selection and apply via the keyboard.
  await selectCorrectionRange(page, 1, 12);
  await openCorrectionPreview(page);
  await expect(preview).toBeVisible();
  await preview
    .getByRole('button', { name: 'Apply club correction', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  const undo = page.getByRole('button', { name: 'Undo club correction' });
  await expect(undo).toBeEnabled();
  expect((await account.repository.load()).shots).toEqual(
    before.shots.map((shot) =>
      appliedIds.has(shot.id)
        ? {
            ...shot,
            revision: shot.revision + 1,
            review: {
              ...shot.review,
              club: { kind: 'corrected', club: CORRECTION_LABEL },
            },
          }
        : shot,
    ),
  );
  expect(writes).toBe(1);

  // Change the selection to a different range: undo must still act on the
  // exact applied IDs, not whatever is now selected.
  await selectCorrectionRange(page, 13, 14);
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await undo.click();
  await expect
    .poll(async () => (await account.repository.load()).shots)
    .toEqual(
      before.shots.map((shot) =>
        appliedIds.has(shot.id)
          ? { ...shot, revision: shot.revision + 2 }
          : shot,
      ),
    );
  expect(writes).toBe(2);

  // Rows already carrying the proposed label stay untouched even with opt-in.
  await selectCorrectionRange(page, 1, 12);
  await openCorrectionPreview(page, '7I');
  const apply = preview.getByRole('button', { name: 'Apply club correction' });
  await expect(apply).toBeDisabled();
  await preview
    .getByRole('checkbox', { name: 'Include previously reviewed clubs' })
    .check();
  await expect(preview).toContainText('1 of 12 selected rows will change');
  await cancel.click();
  expect(writes).toBe(2);
});

test('pins previewed revisions so an intervening edit rejects the batch atomically', async ({
  page,
  account,
}, testInfo) => {
  await seedClubCorrection(account);
  await openCorrectionSession(page, account, testInfo);
  await selectCorrectionRange(page, 1, 12);
  const preview = await openCorrectionPreview(page);
  await expect(preview).toBeVisible();

  // A second repository edit advances a later selected row after the preview
  // captured its revision.
  const loaded = await account.repository.load();
  const later = loaded.shots.find((s) => s.rowIndex === 12);
  if (!later) throw new Error('Missing later row');
  await account.repository.review([
    {
      shotId: later.id,
      expectedRevision: later.revision,
      review: { ...later.review, intent: 'full' },
    },
  ]);
  const afterEdit = await account.repository.load();
  expect(afterEdit.shots.find((s) => s.id === later.id)?.review.intent).toBe(
    'full',
  );
  expect(afterEdit.shots.find((s) => s.id === later.id)?.revision).toBe(
    later.revision + 1,
  );

  // Trigger the app's focus refresh; the pinned preview must survive it, and
  // the refreshed data must still show the intervening edit.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(preview).toBeVisible();
  await expect(
    page.locator('.shot').filter({ hasText: 'Row 12 · Shot #12' }),
  ).toContainText('full · uncertain · included');

  await preview
    .getByRole('button', { name: 'Apply club correction', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    /another device|conflict|revision/i,
  );
  // Atomic rejection: no shot changed beyond the external edit.
  expect(await account.repository.load()).toEqual(afterEdit);
});

test('exact undo conflicts and restores zero shots after an intervening edit', async ({
  page,
  account,
}, testInfo) => {
  await seedClubCorrection(account);
  await openCorrectionSession(page, account, testInfo);
  await selectCorrectionRange(page, 1, 12);
  const preview = await openCorrectionPreview(page);
  await preview
    .getByRole('button', { name: 'Apply club correction', exact: true })
    .click();
  const undo = page.getByRole('button', { name: 'Undo club correction' });
  await expect(undo).toBeEnabled();
  const afterApply = await account.repository.load();

  // Advance one touched row's revision after apply, so the pinned undo is stale.
  const touched = afterApply.shots.find((s) => s.rowIndex === 12);
  if (!touched) throw new Error('Missing touched row');
  await account.repository.review([
    {
      shotId: touched.id,
      expectedRevision: touched.revision,
      review: { ...touched.review, intent: 'full' },
    },
  ]);
  const afterEdit = await account.repository.load();
  expect(afterEdit.shots.find((s) => s.id === touched.id)?.review.intent).toBe(
    'full',
  );

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.locator('.shot').filter({ hasText: 'Row 12 · Shot #12' }),
  ).toContainText('full · uncertain · included');
  await undo.click();
  await expect(page.getByRole('alert')).toContainText(
    /another device|conflict|revision/i,
  );
  // Zero shots restored: state is unchanged from the post-edit snapshot.
  expect(await account.repository.load()).toEqual(afterEdit);
});

test('shows derived read-only club profiles that agree with the recap and fit a phone', async ({
  page,
  account,
}, testInfo) => {
  const today = localToday();
  const mid = shiftDate(today, -10);
  const old = shiftDate(today, -100);
  const archivedDate = shiftDate(today, -5);
  const irons = (base: number) =>
    Array.from({ length: 12 }, (_, i) => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': String(base + (i % 4)),
      'Flat Carry Dist. Range (m)': String(base + 10 + (i % 4)),
    }));
  const importSession = async (
    filename: string,
    date: string,
    rows: Record<string, string>[],
  ) =>
    account.repository.importCsv({
      filename,
      date,
      time: null,
      venue: 'Synthetic range',
      notes: '',
      confirmedFull: true,
      allowSameDay: false,
      preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
    });

  await importSession('old.csv', old, irons(100));
  await importSession('mid.csv', mid, irons(110));
  const todayResult = await importSession('today.csv', today, [
    ...irons(120),
    {
      Club: '7i',
      'Flat Carry Dist. Premium (m)': '--',
      'Flat Carry Dist. Range (m)': '--',
    },
    {
      Club: '9i',
      'Flat Carry Dist. Premium (m)': '150',
      'Flat Carry Dist. Range (m)': '160',
    },
    ...Array.from({ length: 3 }, () => ({
      Club: '5i',
      'Flat Carry Dist. Premium (m)': '140',
      'Flat Carry Dist. Range (m)': '150',
    })),
  ]);
  const archivedResult = await importSession('archived.csv', archivedDate, [
    ...Array.from({ length: 5 }, () => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': '999',
    })),
  ]);

  // Review the latest session: typical contact everywhere, and one effective
  // club correction (recorded 9i, corrected to 7i).
  const loaded = await account.repository.load();
  const todaySession = loaded.sessions.find(
    (s) => s.id === todayResult.sessionId,
  );
  if (!todaySession) throw new Error('Missing seeded today session');
  await account.repository.review(
    loaded.shots
      .filter((s) => s.sessionId === todayResult.sessionId)
      .map((shot) => ({
        shotId: shot.id,
        expectedRevision: shot.revision,
        review: {
          ...shot.review,
          contact: 'typical',
          ...(shot.recordedClub === '9i'
            ? { club: { kind: 'corrected', club: '7i' } as const }
            : {}),
        },
      })),
  );
  const archivedSession = loaded.sessions.find(
    (s) => s.id === archivedResult.sessionId,
  );
  if (!archivedSession) throw new Error('Missing seeded archived session');
  await account.repository.updateSession({
    ...archivedSession,
    archived: true,
  });

  // One physical club, so the reference form's equipment metadata can be set.
  const fitted = await account.repository.saveEquipment({
    ...makeEquipment({ name: 'Fitted 7i', inrangeLabel: '7i' }),
    revision: null,
  });

  await login(page, account);

  // Discoverable entry point: the Overview club cards link to the profile.
  await page.getByRole('link', { name: 'Open the full 7i profile' }).click();
  await expect(page).toHaveURL(/#clubs\/7i$/);
  // A deep-linked club shows that one selected full profile, not every one.
  await expect(page.locator('.club-profile')).toHaveCount(1);
  const heading = page.getByRole('heading', { name: '7i', exact: true });
  await expect(heading).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Club profiles', exact: true }),
  ).toBeVisible();

  const card = page
    .locator('.club-profile')
    .filter({ has: page.getByRole('heading', { name: '7i', exact: true }) });
  // Anchor metric lookups on the label so fact rows like "Latest session ·
  // … typical carry from 13 measured shots" never collide with headline tiles.
  const metricTile = (scope: ReturnType<typeof page.locator>, label: string) =>
    scope
      .locator('.ds-metric-label', {
        hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      })
      .locator('xpath=..');
  await expect(card).toContainText('Premium · flat (estimate)');
  await expect(card).toContainText('2 sessions · 26 shots');
  // Compact club selection: the picker deep-links to every profile.
  const picker = page.getByRole('navigation', {
    name: 'Select a club profile',
  });
  await expect(picker.getByRole('link', { name: '7 iron' })).toHaveAttribute(
    'href',
    '#clubs/7i',
  );
  // Prominent overall rating ring in the header, with the readable club name
  // alongside the abbreviated badge.
  await expect(
    card.getByRole('img', { name: /7i overall rating \d+ of 100/ }),
  ).toBeVisible();
  await expect(card.locator('.club-profile-title')).toContainText('7 iron');
  await expect(card.locator('.club-badge').first()).toHaveText('7I');
  // Headline metrics: typical carry and strong-strike potential as metric tiles.
  const typical = metricTile(card, 'Typical carry');
  await expect(typical).toContainText('122');
  await expect(typical).toContainText('m');
  const potential = metricTile(card, 'Strong-strike carry (P80)');
  await expect(potential).toContainText('m');
  // Repetitive coverage explanations live in a contextual popover; the
  // evidence indicators (badges) stay visible.
  const coverage = card.getByRole('button', {
    name: 'Measurement coverage and cohorts',
  });
  await coverage.click();
  const coveragePopover = card.locator('.ds-help-popover');
  await expect(coveragePopover).toContainText(
    'reviewed full swings with typical contact · 13 measured, 1 missing',
  );
  await expect(coveragePopover).toContainText(
    'distance potential when struck well',
  );
  await expect(coveragePopover).toContainText(
    'middle half of 25 measured carries',
  );
  await coverage.click();
  // Distribution plot + spread line stay visible.
  await expect(card.locator('.ds-distribution svg')).toBeVisible();
  await expect(card).toContainText('Carry spread (IQR) 10 m');
  await expect(card).toContainText('middle half of 25 measured carries');
  await expect(card).toContainText('Lower carry tail (P10) 110.4 m');
  // The fixture has no directional measurements: no fabricated direction.
  await expect(card).toContainText('Direction not measured on this basis');
  // Interactive history chart on the Progress cohort, above the table.
  await expect(
    card.getByRole('group', { name: /7i median carry per session/ }),
  ).toBeVisible();
  await expect(
    card
      .getByRole('group', { name: 'History metric' })
      .getByRole('button', { name: 'Spread' }),
  ).toBeVisible();
  // Facts render as compact metric rows (label + value + context with links).
  const longest = metricTile(card, 'Longest carry');
  await expect(longest).toContainText('150');
  await expect(longest).toContainText('m');
  await expect(longest).toContainText('13 measured, 1 missing for 7i');
  await expect(longest).toContainText('100% of full swings contact-reviewed');
  const gapMetric = metricTile(card, 'Gap to the next longer club');
  await expect(gapMetric).toContainText('20');
  await expect(gapMetric).toContainText('m');
  // No personal reference yet: the benchmark section says so instead of a bar.
  await expect(card).toContainText(
    'No personal carry reference for 7i yet — add one below to benchmark this club',
  );

  // Optional external references: collapsed by default, link-out only, with
  // attribution, comparability caveat and a pro badge — never embedded numbers.
  const refs = card.locator('details.benchmark-refs');
  await expect(refs.locator('summary')).toHaveText('External references (1)');
  const refLink = refs.getByRole('link', { name: /TrackMan Tour Averages/ });
  await expect(refLink).toBeHidden();
  await refs.locator('summary').click();
  await expect(refLink).toBeVisible();
  await expect(refLink).toHaveAttribute(
    'href',
    'https://www.trackman.com/golf-tour-averages',
  );
  await expect(refLink).toHaveAttribute('target', '_blank');
  await expect(refs).toContainText('Pro reference — not an amateur target');
  await expect(refs).toContainText('carry distance, mixed venues');
  await expect(refs).toContainText('not directly comparable');
  await expect(refs).toContainText('Linked sources only');
  await expect(refs).toContainText('TrackMan');

  // Category scores (ADR-0003): four raw-metric categories with sample sizes
  // behind the methodology disclosure. The fixture has no launch direction, so
  // directional control must say not enough data rather than invent a number.
  const scores = card.locator('.category-scores');
  const methodology = scores.locator('details');
  await expect(methodology.locator('summary')).toHaveText(
    'How these are scored',
  );
  await methodology.locator('summary').click();
  await expect(methodology).toContainText('Distance potential');
  await expect(methodology).toContainText('Consistency');
  await expect(methodology).toContainText('Directional control');
  await expect(methodology).toContainText('Reliability');
  await expect(methodology).toContainText('from 25 measured shots');
  await expect(
    methodology.locator('ul li').filter({ hasText: 'Directional control' }),
  ).toContainText('not enough data');
  await expect(methodology).toContainText('category-scores-1');
  // Raw category metrics stay, but the composite now lives in the ADR-0005
  // rating breakdown — the disclosure points there instead of denying it.
  await expect(methodology).toContainText('ADR-0005');

  // Normalized ratings (ADR-0005, ratings-2): the breakdown shows the overall
  // composite and the four category bars; the ADR-0004 raw-metric within-bag
  // standings are removed.
  const rating = card.locator('.rating-breakdown');
  await expect(rating.locator('.rating-overall')).toContainText('Overall');
  await expect(rating.locator('.rating-row').first()).toContainText('Distance');
  await expect(rating.locator('.rating-row')).toHaveCount(4);
  // No compatible reference: the distance row names it and links straight to
  // this club's reference editor (?reference=edit), not just the profile.
  await expect(rating.locator('.rating-row').first()).toContainText(
    'no compatible distance reference',
  );
  await expect(
    rating.getByRole('link', { name: 'set a personal reference' }),
  ).toHaveAttribute('href', '#clubs/7i?reference=edit');
  await expect(scores).not.toContainText('clubs in your bag');
  const ratingMethodology = rating.locator('details');
  await ratingMethodology.locator('summary').click();
  await expect(ratingMethodology).toContainText('ratings-2');

  // Personal reference (user-entered): add with validation, persist, edit.
  const personal = card.locator('.personal-reference');
  await expect(personal).toContainText('No personal reference for 7i yet');
  await personal
    .getByRole('button', { name: 'Add personal reference' })
    .click();
  await personal.getByLabel(/Value \(m\)/).fill('0');
  await personal.getByRole('button', { name: 'Save' }).click();
  await expect(personal.locator('.error')).toContainText(
    'positive distance in metres',
  );
  await personal.getByLabel(/Value \(m\)/).fill('142');
  await personal.getByLabel(/Note/).fill('Fitting session');
  await personal.getByRole('button', { name: 'Save' }).click();
  await expect(personal).toContainText(
    'Personal reference (user-entered): 142 m carry',
  );
  await expect(personal).toContainText('Fitting session');
  await personal.getByRole('button', { name: 'Edit' }).click();
  await personal.getByLabel(/Value \(m\)/).fill('145');
  // Rating metadata is editable: type, statistic, recorded-on date and the
  // physical club the reference was measured with.
  await personal.getByLabel(/^Type/).selectOption('observed');
  await personal.getByLabel(/^Statistic/).selectOption('p80');
  await personal.getByLabel(/Recorded on/).fill('2026-11-20');
  await personal.getByLabel(/^Equipment/).selectOption(fitted.id);
  await personal.getByRole('button', { name: 'Save' }).click();
  await expect(personal).toContainText(
    'Personal reference (user-entered): 145 m carry',
  );
  await expect(personal).toContainText('observed personal best');
  await expect(personal).toContainText('P80 statistic');
  await expect(personal).toContainText('recorded 2026-11-20');
  await expect(personal).toContainText('Fitted 7i');
  // A reference with an unknown basis is never silently compared — the
  // benchmark section shows the reason instead of a bar.
  await expect(card).toContainText('Not compared:');

  // The latest-session metric row links to the same numbers as the session recap.
  const latestLine = metricTile(card, 'Latest session');
  await expect(latestLine).toContainText('122');
  await expect(latestLine).toContainText(
    'typical carry from 13 measured shots',
  );
  await latestLine.getByRole('link', { name: 'session recap' }).click();
  await expect(page).toHaveURL(
    new RegExp(`#sessions/${todayResult.sessionId}$`),
  );
  const recap = page.getByRole('region', { name: 'Session recap' });
  await expect(recap).toContainText(`${today} · Synthetic range`);
  const clubDetails = recap
    .locator('details')
    .filter({ hasText: '7i metric details' });
  await clubDetails.locator('summary').click();
  const broader = clubDetails
    .locator('.recap-metric')
    .filter({ hasText: 'Median carry · broader estimate' });
  await expect(broader).toContainText(
    'This session · 122 m · 13 measured, 1 missing',
  );

  await nav(page, 'Clubs');
  // The plain #clubs view lists every profile again after a deep link.
  await expect(page.locator('.club-profile').first()).toBeVisible();
  expect(await page.locator('.club-profile').count()).toBeGreaterThan(1);
  // Sparse club is qualified, archived session stays out of history.
  const five = page
    .locator('.club-profile')
    .filter({ has: page.getByRole('heading', { name: '5i', exact: true }) });
  await expect(metricTile(five, 'Typical carry')).toContainText('140');
  await expect(five).toContainText('Sample limited');
  // The detailed history table sits behind a disclosure.
  await card.locator('summary', { hasText: 'Session table' }).click();
  const history = card.getByRole('table', {
    name: '7i history across sessions',
  });
  await expect(history.getByRole('row')).toHaveCount(4);
  await expect(history).toContainText(old);
  await expect(history).toContainText(mid);
  await expect(history).toContainText(today);
  await expect(history).not.toContainText(archivedDate);
  expect(
    await history
      .getByRole('link', { name: new RegExp(`^${today}`) })
      .getAttribute('href'),
  ).toBe(`#sessions/${todayResult.sessionId}`);
  // The history chart's metric selector swaps the series.
  await card
    .getByRole('group', { name: 'History metric' })
    .getByRole('button', { name: 'Spread' })
    .click();
  await expect(
    card.getByRole('group', { name: /7i carry spread per session/ }),
  ).toBeVisible();
  await card
    .getByRole('group', { name: 'History metric' })
    .getByRole('button', { name: 'Median carry' })
    .click();

  // Basis selection changes the numbers without falling back across bases.
  await page
    .getByRole('button', { name: 'Premium · flat (estimate)', exact: true })
    .click();
  await expect(card).toContainText('Range · flat');
  await expect(metricTile(card, 'Typical carry')).toContainText('132');

  // Range-ball bases never get an external benchmark overlay (no external
  // source measures limited-flight range balls); premium bases do.
  await expect(card.locator('details.benchmark-refs')).toHaveCount(0);
  await page.getByRole('button', { name: 'Range · flat', exact: true }).click();
  await expect(card).toContainText('Premium (estimate)');
  await expect(card.locator('details.benchmark-refs')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Premium (estimate)', exact: true })
    .click();
  // 'range' is a range-ball basis too: still no overlay.
  await expect(card.locator('details.benchmark-refs')).toHaveCount(0);

  // All-time window includes the older session; history stays all-time.
  await page.getByRole('button', { name: 'All-time', exact: true }).click();
  await expect(card).toContainText('3 sessions · 38 shots');
  await expect(history.getByRole('row')).toHaveCount(4);

  // Phone-width layout: no horizontal page overflow.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('club-profiles.png'),
    fullPage: true,
  });
});

test('wraps the club profile context on a full-width row at phone widths', async ({
  page,
  browser,
  account,
}, testInfo) => {
  test.setTimeout(150000);
  const rows = Array.from({ length: 12 }, (_, i) => ({
    Club: '7i',
    'Flat Carry Dist. Premium (m)': String(120 + (i % 4)),
    'Flat Carry Dist. Range (m)': String(130 + (i % 4)),
  }));
  await account.repository.importCsv({
    filename: 'profile-phone.csv',
    date: localToday(),
    time: null,
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: true,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  const isPhone = testInfo.project.name === 'phone-webkit';
  const contexts: BrowserContext[] = [];
  let loggedIn = false;
  try {
    for (const width of [320, 390]) {
      let target = page;
      if (isPhone) {
        const context = await browser.newContext({
          ...devices['iPhone 13'],
          viewport: { width, height: 700 },
        });
        contexts.push(context);
        target = await context.newPage();
        await login(target, account);
      } else {
        await page.setViewportSize({ width, height: 700 });
        if (!loggedIn) {
          await login(page, account);
          loggedIn = true;
        }
      }
      await target.evaluate(() => {
        window.location.hash = 'clubs/7i';
      });
      const card = target.locator('.club-profile').first();
      await expect(card).toBeVisible();
      // All-time gives the longest scope text.
      const allTime = target.getByRole('button', { name: 'All-time', exact: true });
      if (await allTime.count()) await allTime.click();
      const head = card.locator('.club-profile-head');
      const context = card.locator('.club-profile-title .context');
      const heading = card.getByRole('heading', { name: '7i', exact: true });
      await expect(context).toContainText('All-time');
      const headBox = (await head.boundingBox())!;
      const contextBox = (await context.boundingBox())!;
      const headingBox = (await heading.boundingBox())!;
      // The context wraps on a full-width row instead of a narrow sliver
      // (the old fixed-basis layout squeezed it to ~47px wide and ~540px
      // tall at 320px).
      expect(contextBox.width).toBeGreaterThanOrEqual(headBox.width - 8);
      expect(contextBox.width).toBeGreaterThan(200);
      expect(contextBox.height).toBeLessThanOrEqual(160);
      expect(contextBox.y).toBeGreaterThan(headingBox.y);
      // The club name keeps a readable column.
      expect(headingBox.width).toBeGreaterThan(60);
      // Display and rating bases stay separately identifiable.
      await expect(context).toContainText(/Premium|Range/);
      await expect(card.locator('.club-profile-ring-basis')).toContainText(
        /^rating ·/,
      );
      // The first metrics come right after the wrapped metadata, without a
      // viewport full of it in between.
      const metric = card
        .locator('.ds-metric-label', { hasText: 'Typical carry' })
        .locator('xpath=..');
      const metricBox = (await metric.boundingBox())!;
      expect(metricBox.y - contextBox.y).toBeLessThan(400);
      await expect
        .poll(() =>
          target.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      if (isPhone) await contexts.pop()?.close();
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  }
});

test('compares two same-day visits from both entry points with stable, swappable selections', async ({
  page,
  account,
}, testInfo) => {
  const today = localToday();
  const rows = (club: string, prefix: number) =>
    Array.from({ length: 10 }, (_, i) => ({
      Club: club,
      'Flat Carry Dist. Premium (m)': String(prefix + i * 2),
      'Flat Carry Dist. Range (m)': String(prefix + i * 2 - 10),
    }));
  const importer = async (
    filename: string,
    time: string,
    venue: string,
    clubRows: Record<string, string>[],
  ) =>
    account.repository.importCsv({
      filename,
      date: today,
      time,
      venue,
      notes: '',
      confirmedFull: true,
      allowSameDay: true,
      preview: await parseCsv(new TextEncoder().encode(csvFixture(clubRows))),
    });
  const few = (club: string, carry: number) =>
    Array.from({ length: 4 }, () => ({
      Club: club,
      'Flat Carry Dist. Premium (m)': String(carry),
    }));

  const morning = await importer(
    'compare-morning.csv',
    '08:00',
    'Morning range',
    [...rows('7i', 118), ...few('9i', 150), ...few('PW', 75)],
  );
  const evening = await importer(
    'compare-evening.csv',
    '17:00',
    'Evening range',
    [...rows('7i', 110), ...few('SW', 30), ...few('PW', 70)],
  );
  const solo = await importer(
    'compare-alone.csv',
    '19:00',
    'Night range',
    few('3w', 200),
  );

  await login(page, account);
  const sessionsNav =
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import';
  const reference = page.getByRole('combobox', { name: 'Reference session' });
  const comparison = page.getByRole('combobox', { name: 'Comparison session' });
  const compare = page.getByRole('region', { name: 'Compare sessions' });

  // Entry point 1: the logbook link opens Compare.
  await nav(page, sessionsNav);
  await page.getByLabel('Choose CSV files').setInputFiles({
    name: 'pending-visit.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvFixture([{ Club: '6i' }])),
  });
  const draft = page.getByRole('heading', { name: 'pending-visit.csv' });
  await expect(draft).toBeVisible();
  await page.getByRole('link', { name: 'Compare sessions' }).click();
  await expect(page).toHaveURL(/#sessions\/compare/);
  await expect(
    page.getByRole('heading', { name: 'Compare sessions' }),
  ).toBeFocused();
  await expect(draft).toBeHidden();
  await page.goBack();
  await expect(draft).toBeVisible();
  await page.getByRole('link', { name: 'Compare sessions' }).click();

  await reference.selectOption(morning.sessionId);
  await comparison.selectOption(evening.sessionId);
  await expect(page).toHaveURL(
    new RegExp(
      `#sessions/compare\\?reference=${morning.sessionId}&comparison=${evening.sessionId}`,
    ),
  );
  await expect(reference.locator('option:checked')).toHaveText(
    new RegExp(`${today}.*08:00.*Morning range.*compare-morning\\.csv`),
  );
  await expect(comparison.locator('option:checked')).toHaveText(
    new RegExp(`${today}.*17:00.*Evening range.*compare-evening\\.csv`),
  );
  await expect(compare.getByText(/Only in reference.*9i/)).toBeVisible();
  await expect(compare.getByText(/Only in comparison.*SW/)).toBeVisible();
  const iron = compare.locator('summary').filter({ hasText: /^7i\b/ });
  await expect(iron).toContainText('127 m / 119 m');
  await iron.click();
  const median = compare.getByRole('row', { name: /^Median carry/ });
  const spread = compare.getByRole('row', { name: /^Carry IQR/ });
  await expect(median.getByRole('cell')).toHaveText(['127 m', '119 m', '-8 m']);
  await expect(spread.getByRole('cell')).toHaveText(['9 m', '9 m', '+0 m']);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await compare.locator('summary').filter({ hasText: /^PW\b/ }).click();
  await expect(compare.locator('details[open]')).toHaveCount(1);

  // Shared intent and measurement-basis controls are exposed.
  const intent = compare.getByRole('combobox', {
    name: 'Shot intent',
    exact: true,
  });
  await intent.selectOption({ label: 'Partial swings' });
  await expect(compare.getByText(/No clubs in common/)).toBeVisible();
  await intent.selectOption({ label: 'All intents' });
  await page.getByTitle('Change measurement basis').click();
  await expect(iron).toContainText('117 m / 109 m');

  // Swap is exposed and keeps the pair visible.
  await page.getByRole('button', { name: 'Swap sessions' }).click();
  await expect(reference).toHaveValue(evening.sessionId);
  await expect(comparison).toHaveValue(morning.sessionId);
  await expect(page).toHaveURL(
    new RegExp(
      `#sessions/compare\\?reference=${evening.sessionId}&comparison=${morning.sessionId}`,
    ),
  );

  // Reload and Back preserve the exact pair.
  await page.reload();
  await expect(reference).toHaveValue(evening.sessionId);
  await expect(comparison).toHaveValue(morning.sessionId);
  await page.goBack();
  await expect(reference).toHaveValue(morning.sessionId);
  await expect(comparison).toHaveValue(evening.sessionId);

  // No overlap: a different club on each side yields the empty-state wording.
  await comparison.selectOption(solo.sessionId);
  await expect(compare.getByText(/No clubs in common/)).toBeVisible();

  // Entry point 2: the session-detail link preselects that visit as Reference.
  await nav(page, sessionsNav);
  await page.getByRole('link', { name: /compare-morning\.csv/ }).click();
  await page.evaluate((sessionHash) => {
    document.addEventListener('focusin', ({ target }) => {
      if (target instanceof HTMLAnchorElement && target.hash === sessionHash) {
        document.documentElement.dataset.logbookRowRefocused = 'true';
      }
    });
  }, `#sessions/${morning.sessionId}`);
  await page
    .getByRole('link', { name: 'Compare with another session' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`#sessions/compare\\?reference=${morning.sessionId}`),
  );
  await expect(
    page.getByRole('heading', { name: 'Compare sessions' }),
  ).toBeFocused();
  await expect(reference).toHaveValue(morning.sessionId);
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-logbook-row-refocused',
    'true',
  );
});

test('hides Compare on archived logbook cards and flags archived compare URLs immediately', async ({
  page,
  account,
}, testInfo) => {
  const today = localToday();
  const rows = (carry: number) =>
    Array.from({ length: 6 }, () => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': String(carry),
    }));
  // Distinct carry values keep the exports distinct for import idempotency.
  const importer = async (
    filename: string,
    date: string,
    time: string | null,
    carry: number,
    allowSameDay: boolean,
  ) =>
    account.repository.importCsv({
      filename,
      date,
      time,
      venue: 'Synthetic range',
      notes: '',
      confirmedFull: true,
      allowSameDay,
      preview: await parseCsv(new TextEncoder().encode(csvFixture(rows(carry)))),
    });
  const first = await importer('first.csv', today, '08:00', 150, false);
  const second = await importer('second.csv', today, '09:00', 148, true);
  const archived = await importer('old.csv', shiftDate(today, -3), null, 140, false);
  const loaded = await account.repository.load();
  const old = loaded.sessions.find((s) => s.id === archived.sessionId);
  if (!old) throw new Error('Missing seeded session');
  await account.repository.updateSession({ ...old, archived: true });

  await login(page, account);
  await nav(page, testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import');
  const cards = page.locator('.session-card');
  const archivedCard = cards.filter({ hasText: 'Archived' });
  const activeCard = cards.filter({ hasText: 'first.csv' });
  await expect(archivedCard).toHaveCount(1);
  await expect(activeCard).toHaveCount(1);
  // Archived cards offer no Compare action; active cards still do.
  await expect(archivedCard.locator('.session-card-compare')).toHaveCount(0);
  await expect(activeCard.locator('.session-card-compare')).toHaveCount(1);

  // A valid entry point still prefills the reference selection.
  await activeCard.locator('.session-card-compare').click();
  await expect(page).toHaveURL(
    new RegExp(`#sessions/compare\\?reference=${first.sessionId}`),
  );
  const reference = page.getByRole('combobox', { name: 'Reference session' });
  const comparison = page.getByRole('combobox', { name: 'Comparison session' });
  await expect(reference).toHaveValue(first.sessionId);

  // A saved URL naming the archived visit shows its unavailable state
  // immediately, before any second selection.
  await page.evaluate(
    (id) => {
      window.location.hash = `sessions/compare?reference=${id}`;
    },
    archived.sessionId,
  );
  await expect(
    page.getByText(
      'The reference session is archived or unavailable. Choose another reference session.',
    ),
  ).toBeVisible();
  await page.evaluate(
    ([a, b]) => {
      window.location.hash = `sessions/compare?reference=${a}&comparison=${b}`;
    },
    [archived.sessionId, second.sessionId] as const,
  );
  await expect(
    page.getByText(
      'The reference session is archived or unavailable. Choose another reference session.',
    ),
  ).toBeVisible();
  await page.evaluate(
    ([a, b]) => {
      window.location.hash = `sessions/compare?reference=${a}&comparison=${b}`;
    },
    [first.sessionId, archived.sessionId] as const,
  );
  await expect(
    page.getByText(
      'The comparison session is archived or unavailable. Choose another comparison session.',
    ),
  ).toBeVisible();

  // A saved URL naming two valid sessions still prefills both selections and
  // never shows the unavailable state.
  await page.evaluate(
    ([a, b]) => {
      window.location.hash = `sessions/compare?reference=${a}&comparison=${b}`;
    },
    [first.sessionId, second.sessionId] as const,
  );
  await expect(reference).toHaveValue(first.sessionId);
  await expect(comparison).toHaveValue(second.sessionId);
  await expect(page.getByText(/archived or unavailable/)).toHaveCount(0);
});

test('compares shared cohorts, flight and direction details with neutral deltas across bases', async ({
  page,
  account,
}, testInfo) => {
  const importer = async (evening: boolean) => {
    const start = evening ? ['2L', '0', '2R', '2R'] : ['2L', '2L', '0', '2R'];
    const curve = evening ? ['1L', '1L', '0', '1R'] : ['1L', '0', '0', '1R'];
    const typical = Array.from({ length: 12 }, (_, index) => ({
      Club: '7i',
      'Flat Carry Dist. Premium (m)': evening ? '132' : '120',
      'Flat Carry Dist. Range (m)': evening ? '121' : '110',
      'Ball Speed (kph) Premium': evening ? '117' : '130',
      'Ball Speed (kph)': evening ? '108' : '120',
      'Launch Angle (deg) Premium': evening ? '22' : '20',
      'Apex (m) Premium': evening ? '14' : '15',
      'Launch Direction': start[index % start.length] ?? '0',
      Curve: curve[index % curve.length] ?? '0',
      'From Centre (m)': curve[index % curve.length] ?? '0',
    }));
    const mishit = {
      Club: '7i',
      'Flat Carry Dist. Premium (m)': '60',
      'Flat Carry Dist. Range (m)': '55',
    };
    const thin = [0, 2, 4].map((offset) => ({
      Club: '5i',
      'Flat Carry Dist. Premium (m)': String((evening ? 160 : 150) + offset),
      'Flat Carry Dist. Range (m)': String((evening ? 150 : 140) + offset),
    }));
    return account.repository.importCsv({
      filename: evening ? 'detail-evening.csv' : 'detail-morning.csv',
      date: localToday(),
      time: evening ? '17:00' : '08:00',
      venue: evening ? 'Evening range' : 'Morning range',
      notes: '',
      confirmedFull: true,
      allowSameDay: true,
      preview: await parseCsv(
        new TextEncoder().encode(csvFixture([...typical, mishit, ...thin])),
      ),
    });
  };
  const morning = await importer(false);
  const evening = await importer(true);
  const data = await account.repository.load();
  await account.repository.review(
    data.shots.map((shot) => {
      const carry = shot.measurements.flatCarryPremium;
      return {
        shotId: shot.id,
        expectedRevision: shot.revision,
        review: {
          ...shot.review,
          intent: 'full',
          contact:
            shot.recordedClub === '7i' && carry === 60
              ? 'mishit'
              : shot.recordedClub === '5i' && (carry === 154 || carry === 164)
                ? 'uncertain'
                : 'typical',
        },
      };
    }),
  );

  await login(page, account);
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await page.getByRole('link', { name: 'Compare sessions' }).click();
  const reference = page.getByRole('combobox', { name: 'Reference session' });
  const comparison = page.getByRole('combobox', { name: 'Comparison session' });
  const compare = page.getByRole('region', { name: 'Compare sessions' });
  await reference.selectOption(morning.sessionId);
  await comparison.selectOption(evening.sessionId);

  const club = (label: RegExp) =>
    compare
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: label }) });
  const iron = club(/^7i\b/);
  const five = club(/^5i\b/);
  await iron.locator('summary').click();
  const cells = (label: string, details = iron) =>
    details
      .getByRole('row')
      .filter({
        has: page.getByRole('rowheader', { name: label, exact: true }),
      })
      .getByRole('cell');

  await expect(iron).toContainText('reviewed full swings with typical contact');
  await expect(cells('Typical carry · reviewed typical')).toHaveText([
    '120 m',
    '132 m',
    '+12 m',
  ]);
  await expect(cells('Typical carry · measured').first()).toHaveText(
    '12 measured, 0 missing',
  );
  await expect(cells('Relative carry change').last()).toHaveText('+10%');
  await expect(cells('Ball speed')).toHaveText([
    '130 kph',
    '117 kph',
    '-13 kph',
  ]);
  await expect(cells('Ball speed · relative').last()).toHaveText('-10%');
  await expect(cells('Launch angle').last()).toHaveText('+2°');
  await expect(cells('Apex').last()).toHaveText('-1 m');
  await expect(cells('Start direction · measured').first()).toHaveText(
    '12 measured, 1 missing',
  );
  await expect(cells('Start direction · left')).toHaveText([
    '50% (6/12)',
    '25% (3/12)',
    '-25 pp',
  ]);
  await expect(cells('Curve · left')).toHaveText([
    '25% (3/12)',
    '50% (6/12)',
    '+25 pp',
  ]);
  await expect(cells('Lateral offset · straight').last()).toHaveText('-25 pp');
  await expect(cells('Confirmed mishits').first()).toContainText(
    '1 of 13 reviewed full swings',
  );
  await expect(cells('Full swings reviewed').first()).toContainText(
    '13 of 13 full swings',
  );

  await page.getByTitle('Change measurement basis').click();
  await expect(iron).toHaveAttribute('open', '');
  await expect(iron).toContainText('Range · flat');
  await expect(cells('Typical carry · reviewed typical')).toHaveText([
    '110 m',
    '121 m',
    '+11 m',
  ]);
  await expect(cells('Ball speed').last()).toHaveText('-12 kph');
  await expect(cells('Apex · measured').first()).toHaveText(
    '0 measured, 13 missing',
  );

  await five.locator('summary').click();
  await expect(five).toContainText('broader recap cohort');
  await expect(five).toContainText('Carry IQR needs at least 4 measured shots');
  await expect(five).toContainText('Review coverage is thin');
  await expect(five).toContainText('2 of 3 full swings');
  await expect(cells('Typical carry · broader cohort', five)).toHaveText([
    '142 m',
    '152 m',
    '+10 m',
  ]);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

async function openBag(page: Page) {
  await nav(page, 'Clubs');
  await page.getByRole('button', { name: 'Manage bag', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manage bag' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Manage bag' })).toBeVisible();
}

function editClub(page: Page, name: string) {
  return page.getByRole('button', { name: `Edit ${name}`, exact: true });
}

async function equipmentNamed(account: Account, name: string) {
  return (await account.repository.load()).equipment.find(
    (item) => item.name === name,
  );
}

test('registers, edits and retires bag clubs with overlapping labels and round-trips through reload and v2 backup', async ({
  page,
  account,
}) => {
  await login(page, account);
  await openBag(page);

  const add = page.getByRole('button', { name: 'Add club', exact: true });
  const label = page.getByLabel('Inrange label', { exact: true });
  const name = page.getByLabel('Display name', { exact: true });
  const manufacturer = page.getByLabel('Manufacturer', { exact: true });
  const loft = page.getByLabel('Loft', { exact: true });
  const status = page.getByRole('combobox', { name: /^Status/ });
  const acquired = page.getByLabel('Acquired on', { exact: true });
  const retired = page.getByLabel('Retired on', { exact: true });
  const save = page.getByRole('button', { name: 'Save club', exact: true });

  // Register a physical club.
  await add.click();
  await label.fill('7i');
  await name.fill('Primary 7i');
  await manufacturer.fill('Titleist');
  await loft.fill('34');
  await status.selectOption({ label: 'In bag' });
  await acquired.fill('2026-01-10');
  await save.click();
  await expect
    .poll(() => equipmentNamed(account, 'Primary 7i'))
    .toEqual(
      expect.objectContaining({
        inrangeLabel: '7i',
        name: 'Primary 7i',
        manufacturer: 'Titleist',
        loft: '34',
        status: 'in-bag',
        acquiredOn: '2026-01-10',
        retiredOn: null,
        revision: 0,
      }),
    );

  // A second club may share the label and overlap in ownership.
  await add.click();
  await label.fill('7i');
  await name.fill('Backup 7i');
  await status.selectOption({ label: 'Retired' });
  await acquired.fill('2026-01-01');
  await retired.fill('2026-03-01');
  await save.click();
  await expect
    .poll(() => equipmentNamed(account, 'Backup 7i'))
    .toEqual(
      expect.objectContaining({
        inrangeLabel: '7i',
        name: 'Backup 7i',
        status: 'retired',
        acquiredOn: '2026-01-01',
        retiredOn: '2026-03-01',
        revision: 0,
      }),
    );

  const primary = await equipmentNamed(account, 'Primary 7i');
  const backup = await equipmentNamed(account, 'Backup 7i');
  if (!primary || !backup) throw new Error('Missing seeded equipment');
  expect(primary.id).not.toBe(backup.id);
  expect(primary.inrangeLabel).toBe(backup.inrangeLabel);

  // Edit and retire the first club; the other fields survive the edit.
  await editClub(page, 'Primary 7i').click();
  await name.fill('Primary 7i v2');
  await manufacturer.fill('Titleist');
  await loft.fill('33');
  await status.selectOption({ label: 'Retired' });
  await acquired.fill('2026-01-10');
  await retired.fill('2026-06-01');
  await save.click();
  await expect
    .poll(() => equipmentNamed(account, 'Primary 7i v2'))
    .toEqual(
      expect.objectContaining({
        id: primary.id,
        inrangeLabel: '7i',
        name: 'Primary 7i v2',
        manufacturer: 'Titleist',
        loft: '33',
        status: 'retired',
        acquiredOn: '2026-01-10',
        retiredOn: '2026-06-01',
        revision: 1,
      }),
    );

  // Reload from persistence and reopen the bag.
  await page.reload();
  await openBag(page);
  await expect(editClub(page, 'Primary 7i v2')).toBeVisible();
  await expect(editClub(page, 'Backup 7i')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);

  await nav(page, 'Settings');
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download backup', exact: true })
    .click();
  const backupText = await readFile(await (await downloaded).path(), 'utf8');
  const dataset = await account.repository.load();
  expect(JSON.parse(backupText).version).toBe(2);
  const roundTrip = await parseBackup(backupText);
  expect(roundTrip.equipment).toEqual(dataset.equipment);
  expect(roundTrip.equipmentAssignments).toEqual(dataset.equipmentAssignments);
});

test('keeps an equipment edit draft after a conflicting save and reconciles to the latest revision', async ({
  page,
  account,
}) => {
  const seeded = await account.repository.saveEquipment({
    ...makeEquipment({ name: 'Original club' }),
    revision: null,
  });
  await login(page, account);
  await openBag(page);
  await editClub(page, 'Original club').click();
  const name = page.getByLabel('Display name', { exact: true });
  await name.fill('My edited club');

  // Deterministic conflict: another device saves the same record after the
  // draft opened, so the app's pinned revision is now stale.
  await account.repository.saveEquipment({ ...seeded, name: 'External edit' });

  await page.getByRole('button', { name: 'Save club', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(name).toHaveValue('My edited club');
  const useLatest = page.getByRole('button', {
    name: 'Use latest revision',
    exact: true,
  });
  await expect(useLatest).toBeVisible();

  await useLatest.click();
  await expect(name).toHaveValue('My edited club');
  expect((await equipmentNamed(account, 'External edit'))?.id).toBe(seeded.id);
  const save = page.getByRole('button', { name: 'Save club', exact: true });
  await save.click();

  await expect
    .poll(async () => {
      const data = await account.repository.load();
      return data.equipment.find((item) => item.id === seeded.id)?.name;
    })
    .toBe('My edited club');
  const final = (await account.repository.load()).equipment.find(
    (item) => item.id === seeded.id,
  );
  if (!final) throw new Error('Missing equipment after reconciliation');
  expect(final.revision).toBe(seeded.revision + 2);
});

test('persists a seeded historical equipment assignment and exposes its visit', async ({
  page,
  account,
}) => {
  await seed(account);
  const equipment = await account.repository.saveEquipment({
    ...makeEquipment({ name: 'Historical 7i', status: 'retired' }),
    revision: null,
  });
  const data = await account.repository.load();
  const session = data.sessions[0];
  if (!session) throw new Error('Missing seeded session');
  const shotIds = data.shots
    .filter(
      (shot) => shot.sessionId === session.id && effectiveClub(shot) === '7i',
    )
    .map((shot) => shot.id);
  expect(shotIds.length).toBeGreaterThan(0);

  await account.repository.assignEquipment({
    expectedVersion: data.version,
    sessionId: session.id,
    clubLabel: '7i',
    equipmentId: equipment.id,
    shotIds,
  });

  const after = await account.repository.load();
  expect(
    after.equipmentAssignments
      .filter((item) => item.equipmentId === equipment.id)
      .map((item) => item.shotId)
      .sort(),
  ).toEqual([...shotIds].sort());

  await login(page, account);
  await openBag(page);
  await page.reload();
  await openBag(page);
  const persisted = await account.repository.load();
  expect(persisted.equipmentAssignments).toEqual(after.equipmentAssignments);
  await expect(editClub(page, 'Historical 7i')).toBeVisible();
  const history = page.getByRole('table', {
    name: 'Assignment history for Historical 7i',
  });
  await expect(
    history.getByRole('link', { name: session.date }),
  ).toHaveAttribute('href', `#sessions/${session.id}`);
});

function sessionsNav(testInfo: TestInfo) {
  return testInfo.project.name === 'phone-webkit'
    ? 'Sessions'
    : 'Sessions & import';
}

async function seedEquipmentVisit(
  account: Account,
  filename: string,
  date = localToday(),
  carry = 120,
  rowCount = 8,
) {
  const preview = await parseCsv(
    new TextEncoder().encode(
      csvFixture(
        Array.from({ length: rowCount }, (_, index) => ({
          Club: index === 3 ? 'PW' : '7i',
          'Flat Carry Dist. Premium (m)': String(carry + index),
        })),
      ),
    ),
  );
  return account.repository.importCsv({
    filename,
    date,
    time: '10:00',
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: true,
    allowSameDay: false,
    preview,
  });
}

function equipmentShotIds(
  data: Dataset,
  sessionId: string,
  from = 1,
  to = Infinity,
) {
  return data.shots
    .filter(
      (shot) =>
        shot.sessionId === sessionId &&
        effectiveClub(shot) === '7i' &&
        shot.rowIndex >= from &&
        shot.rowIndex <= to,
    )
    .map((shot) => shot.id)
    .sort();
}

async function registerEquipment(account: Account, name: string) {
  return account.repository.saveEquipment({
    ...makeEquipment({ name }),
    revision: null,
  });
}

async function openEquipmentVisit(
  page: Page,
  account: Account,
  testInfo: TestInfo,
  sessionId: string,
) {
  await login(page, account);
  await nav(page, sessionsNav(testInfo));
  await page.locator('a[href="#sessions/' + sessionId + '"]').click();
  return page.getByRole('region', { name: 'Assign equipment', exact: true });
}

async function previewEquipment(
  region: Locator,
  equipmentId: string | null,
  range?: { first: number; last: number },
) {
  await region
    .getByRole('combobox', { name: 'Club label', exact: true })
    .selectOption('7i');
  const club = region.getByRole('combobox', {
    name: 'Physical club',
    exact: true,
  });
  await club.selectOption(equipmentId ?? { label: 'Clear assignment' });
  await region
    .getByLabel('First source row', { exact: true })
    .fill(range ? String(range.first) : '');
  await region
    .getByLabel('Last source row', { exact: true })
    .fill(range ? String(range.last) : '');
  await region
    .getByRole('button', { name: 'Preview assignment', exact: true })
    .click();
}

test('assigns, replaces and clears exact equipment groups and source-row ranges', async ({
  page,
  account,
}, testInfo) => {
  const recent = await seedEquipmentVisit(
    account,
    'equipment-session.csv',
    localToday(),
    120,
    54,
  );
  const old = await seedEquipmentVisit(
    account,
    'backdated-7i.csv',
    shiftDate(localToday(), -120),
    110,
  );
  const primary = await registerEquipment(account, 'Primary 7i');
  const backup = await registerEquipment(account, 'Backup 7i');
  const seeded = await account.repository.load();
  const excluded = seeded.shots.find(
    (shot) => shot.sessionId === recent.sessionId && shot.rowIndex === 8,
  );
  if (!excluded) throw new Error('Missing seeded shot');
  await account.repository.review([
    {
      shotId: excluded.id,
      expectedRevision: excluded.revision,
      review: {
        ...excluded.review,
        exclusion: { kind: 'excluded', reason: 'Fixture' },
      },
    },
  ]);
  const before = await account.repository.load();
  const group = equipmentShotIds(before, recent.sessionId);
  const swap = equipmentShotIds(before, recent.sessionId, 3, 5);
  expect(group).toHaveLength(53);
  expect(swap).toHaveLength(2);

  const region = await openEquipmentVisit(
    page,
    account,
    testInfo,
    recent.sessionId,
  );
  const assignedTo = async (clubId: string) =>
    (await account.repository.load()).equipmentAssignments
      .filter((item) => item.equipmentId === clubId)
      .map((item) => item.shotId)
      .sort();

  const confirm = region.getByRole('button', {
    name: 'Confirm assignment',
    exact: true,
  });
  await previewEquipment(region, primary.id);
  const preview = region.getByRole('table', {
    name: 'Exact shots in this assignment preview',
  });
  await expect(preview.locator('tbody tr')).toHaveCount(50);
  await region.getByRole('button', { name: 'Next preview page' }).click();
  await expect(preview.locator('tbody td:first-child')).toHaveText([
    '52',
    '53',
    '54',
  ]);
  const visit = before.sessions.find(
    (session) => session.id === recent.sessionId,
  );
  if (!visit) throw new Error('Missing seeded visit');
  await account.repository.updateSession({
    ...visit,
    notes: 'Saved elsewhere',
  });
  await confirm.click();
  await expect(region.getByRole('alert')).toContainText('preview is stale');
  expect(await assignedTo(primary.id)).toEqual([]);

  await region
    .getByRole('button', { name: 'Preview assignment', exact: true })
    .click();
  await confirm.click();
  await expect.poll(() => assignedTo(primary.id)).toEqual(group);
  await previewEquipment(region, backup.id);
  await confirm.click();
  await expect.poll(() => assignedTo(backup.id)).toEqual(group);
  await expect.poll(() => assignedTo(primary.id)).toEqual([]);

  const range = { first: 3, last: 5 };
  await previewEquipment(region, primary.id, { first: 4, last: 4 });
  await expect(confirm).toBeDisabled();
  await region.getByRole('button', { name: 'Revise', exact: true }).click();
  await previewEquipment(region, primary.id, range);
  await expect(preview.locator('tbody tr')).toHaveCount(2);
  await expect(preview.locator('tbody td:first-child')).toHaveText(['3', '5']);
  await confirm.click();
  await expect.poll(() => assignedTo(primary.id)).toEqual(swap);
  const remainder = group.filter((id) => !swap.includes(id));
  await expect.poll(() => assignedTo(backup.id)).toEqual(remainder);

  await previewEquipment(region, null, range);
  await confirm.click();
  await expect.poll(() => assignedTo(primary.id)).toEqual([]);
  const after = await account.repository.load();
  expect(after.equipmentAssignments.map((item) => item.shotId).sort()).toEqual(
    remainder,
  );
  expect(
    after.equipmentAssignments.every((item) => item.clubLabel === '7i'),
  ).toBe(true);
  expect(after.shots).toEqual(before.shots);
  expect(after.imports).toEqual(before.imports);

  await page
    .getByRole('link', { name: 'Compare with another session' })
    .click();
  await page
    .getByRole('combobox', { name: 'Comparison session' })
    .selectOption(old.sessionId);
  const compare = page.getByRole('region', { name: 'Compare sessions' });
  await compare.locator('summary').filter({ hasText: /^7i\b/ }).click();
  const equipmentRow = compare.getByRole('row', {
    name: /^Assigned equipment/,
  });
  await expect(equipmentRow).toContainText(
    '50/52 assigned · mixed · Backup 7i',
  );
  await expect(equipmentRow).toContainText('0/7 assigned · unknown');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await nav(page, 'Clubs');
  const profile = page.getByRole('region', { name: '7i', exact: true });
  await expect(profile).toContainText('50 of 52 shots assigned · mixed');
});

test('retains the prior equipment when a club correction needs review and restores compatibility on undo', async ({
  page,
  account,
}, testInfo) => {
  const visit = await seedEquipmentVisit(account, 'equipment-review.csv');
  const club = await registerEquipment(account, 'Historical 7i');
  const before = await account.repository.load();
  const shot = before.shots.find(
    (item) => item.sessionId === visit.sessionId && item.rowIndex === 1,
  );
  if (!shot) throw new Error('Missing seeded shot');
  const assignment = { shotId: shot.id, equipmentId: club.id, clubLabel: '7i' };
  await account.repository.assignEquipment({
    expectedVersion: before.version,
    sessionId: visit.sessionId,
    clubLabel: '7i',
    equipmentId: club.id,
    shotIds: [shot.id],
  });
  await account.repository.review([
    {
      shotId: shot.id,
      expectedRevision: shot.revision,
      review: { ...shot.review, club: { kind: 'corrected', club: '9i' } },
    },
  ]);
  const corrected = await account.repository.load();
  expect(corrected.equipmentAssignments).toEqual([assignment]);

  const region = await openEquipmentVisit(
    page,
    account,
    testInfo,
    visit.sessionId,
  );
  await region
    .getByRole('combobox', { name: 'Club label', exact: true })
    .selectOption('9i');
  await expect(region.getByText('Needs review', { exact: true })).toBeVisible();
  await expect(
    region.getByText('Historical 7i (7i)', { exact: false }),
  ).toBeVisible();
  await openBag(page);
  const history = page.getByRole('table', {
    name: 'Assignment history for Historical 7i',
  });
  const reviewCount = history
    .getByRole('row')
    .filter({
      has: page.getByRole('link', { name: /10:00/ }),
    })
    .getByRole('cell')
    .last();
  await expect(reviewCount).toHaveText('1');

  const latest = corrected.shots.find((item) => item.id === shot.id);
  if (!latest) throw new Error('Missing corrected shot');
  await account.repository.undo([
    { shotId: latest.id, expectedRevision: latest.revision },
  ]);
  expect((await account.repository.load()).equipmentAssignments).toEqual([
    assignment,
  ]);
  await page.reload();
  await openBag(page);
  await expect(reviewCount).toHaveText('—');
});

// --- Ball-flight explorer (roadmap row 6) ---------------------------------

type ExplorerVisit = { sessionId: string; filename: string };

function explorerRow(
  club: string,
  speed: string,
  rangeSpeed: string,
  carry: string,
  rangeCarry: string,
) {
  return {
    Club: club,
    'Ball Speed (kph) Premium': speed,
    'Ball Speed (kph)': rangeSpeed,
    'Flat Carry Dist. Premium (m)': carry,
    'Flat Carry Dist. Range (m)': rangeCarry,
    'Carry Dist. Range (m)': rangeCarry,
    'Flat Total Dist. Premium (m)':
      carry === '--' ? '--' : String(Number(carry) + 10),
    'Flat Total Dist. Range (m)':
      rangeCarry === '--' ? '--' : String(Number(rangeCarry) + 10),
    'Launch Angle (deg) Premium': '20°',
    'Apex (m) Premium': '15',
  };
}

async function importExplorerVisit(
  account: Account,
  filename: string,
  date: string,
  rows: Record<string, string>[],
): Promise<ExplorerVisit> {
  const result = await account.repository.importCsv({
    filename,
    date,
    time: '10:00',
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview: await parseCsv(new TextEncoder().encode(csvFixture(rows))),
  });
  return { sessionId: result.sessionId, filename };
}

async function seedExplorer(account: Account) {
  const today = localToday();
  const recent = await importExplorerVisit(
    account,
    'explorer-recent.csv',
    today,
    [
      explorerRow('7i', '130', '120', '100', '90'),
      explorerRow('7i', '130', '120', '100', '90'), // exact overlapping pair
      explorerRow('7i', '120', '110', '110', '100'),
      explorerRow('7i', '--', '108', '105', '95'), // missing speed on premium basis
      explorerRow('7i', '125', '115', '--', '--'), // missing carry on both bases
      explorerRow('7i', '0', '0', '0', '0'), // zero is a measurement, not missing
      explorerRow('9i', '110', '100', '130', '120'),
      explorerRow('9i', '115', '105', '135', '125'),
    ],
  );
  const old = await importExplorerVisit(
    account,
    'explorer-old.csv',
    shiftDate(today, -90),
    [
      explorerRow('7i', '100', '90', '70', '60'),
      explorerRow('7i', '102', '92', '72', '62'),
    ],
  );
  return { recent, old };
}

async function openExplorer(page: Page) {
  await nav(page, 'Explorer');
  return page.getByRole('region', {
    name: 'Ball-flight explorer',
    exact: true,
  });
}

test('Explorer keeps axis choices across clubs and honours scope, basis and paired counts', async ({
  page,
  account,
}) => {
  const { old } = await seedExplorer(account);
  await login(page, account);
  const explorer = await openExplorer(page);

  const club = explorer.getByRole('combobox', {
    name: /^(Effective club|Club)$/,
  });
  const xAxis = explorer.getByRole('combobox', { name: 'X axis', exact: true });
  const yAxis = explorer.getByRole('combobox', { name: 'Y axis', exact: true });
  const swap = explorer.getByRole('button', { name: 'Swap axes', exact: true });
  const scope = explorer.getByRole('group', {
    name: 'Time scope',
    exact: true,
  });
  const session = explorer.getByRole('combobox', {
    name: 'Session',
    exact: true,
  });
  const points = explorer.getByRole('button', { name: /^Plot / });

  // The explorer is the active secondary destination (sub-nav on phones,
  // sidebar item on desktop).
  await expect(
    page
      .getByRole('button', { name: 'Explorer', exact: true })
      .or(page.getByRole('button', { name: 'Ball-flight explorer', exact: true })),
  ).toHaveAttribute('aria-current', 'page');

  await expect(xAxis.locator('option:checked')).toContainText('Ball speed');
  await expect(yAxis.locator('option:checked')).toContainText('Carry');
  const x = await xAxis.inputValue();
  const y = await yAxis.inputValue();
  await club.selectOption('7i');
  await swap.click();
  await club.selectOption('9i');
  await expect(xAxis).toHaveValue(y);
  await expect(yAxis).toHaveValue(x);
  await expect(points).toHaveCount(2);
  await club.selectOption('7i');

  // Recent excludes the 90-day visit; All-time includes it; a named session isolates it.
  await expect(explorer).toContainText('4 of 6');
  await scope.getByRole('button', { name: 'All-time', exact: true }).click();
  await expect(points).toHaveCount(6);
  await expect(explorer).toContainText('6 of 8');
  await scope.getByRole('button', { name: 'Session', exact: true }).click();
  await session.selectOption(old.sessionId);
  await expect(session.locator('option:checked')).toContainText(old.filename);
  await expect(points).toHaveCount(2);

  // The shared basis button still applies here and changes the measured counts.
  await scope.getByRole('button', { name: 'Recent', exact: true }).click();
  const basis = page.getByTitle('Change measurement basis');
  await expect(basis).toHaveText('Premium · flat (estimate)');
  await expect(explorer).toContainText('4 of 6');
  await basis.click();
  await expect(basis).toHaveText('Range · flat');
  await expect(explorer).toContainText('5 of 6');
  expect(await explorer.textContent()).toMatch(/missing/i);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test('Explorer keyboard table targets an exact overlapping shot and opens its review', async ({
  page,
  account,
}, testInfo) => {
  const { recent } = await seedExplorer(account);
  const data = await account.repository.load();
  const shots = data.shots.filter(
    (shot) => shot.sessionId === recent.sessionId,
  );
  const first = shots.find((shot) => shot.rowIndex === 1);
  const overlapping = shots.find((shot) => shot.rowIndex === 2);
  if (!first || !overlapping) throw new Error('Missing overlapping shots');
  expect(overlapping.measurements.speedPremium).toBe(
    first.measurements.speedPremium,
  );
  expect(overlapping.measurements.flatCarryPremium).toBe(
    first.measurements.flatCarryPremium,
  );

  await login(page, account);
  const explorer = await openExplorer(page);
  await explorer
    .getByRole('combobox', { name: /^(Effective club|Club)$/ })
    .selectOption('7i');
  const points = explorer.getByRole('button', { name: /^Plot / });
  const table = explorer.getByRole('table', { name: /shots?/i }).first();
  const detail = explorer
    .getByRole('region', { name: /Selected shot|Shot detail/i })
    .first();

  // Both overlapping shots are plotted, but only the table can target one by row.
  await expect(points).toHaveCount(4);
  const thirdPoint = explorer.getByRole('button', {
    name: /^Plot .*\brow 3\b/i,
  });
  if (testInfo.project.name === 'phone-webkit') await thirdPoint.tap();
  else await thirdPoint.click();
  await expect(detail).toContainText('Row 3');

  const inspect = table.getByRole('button', {
    name: new RegExp(`\\b(?:row|shot)\\s+${overlapping.rowIndex}\\b`, 'i'),
  });
  await expect(inspect).toHaveCount(1);
  await inspect.focus();
  await page.keyboard.press('Enter');
  await expect(detail).toContainText(`Row ${overlapping.rowIndex}`);
  await expect(detail).toContainText(recent.filename);
  await expect(detail).toContainText('130.0');
  await expect(detail).toContainText('100.0');

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);

  const review = detail.getByRole('link', { name: 'Review shot', exact: true });
  await expect(review).toHaveAttribute('href', new RegExp(recent.sessionId));
  await expect(review).toHaveAttribute('href', new RegExp(overlapping.id));
  await review.click();
  await expect(page).toHaveURL(new RegExp(overlapping.id));
  const supportingShots = page.getByRole('region', {
    name: 'Supporting shots',
  });
  await expect(supportingShots).toContainText(`Row ${overlapping.rowIndex}`);
  await expect(supportingShots.locator('.shot-list .shot')).toHaveCount(1);

  await page.goBack();
  await table.getByRole('button', { name: /^Inspect row 5\b/ }).click();
  await expect(detail).toContainText('Carry: Missing');
  await review.click();
  await expect(supportingShots).toContainText('Row 5');
  await expect(supportingShots).not.toContainText('measured shots');
});

test('Explorer keeps large plots on one tab stop and pages the full shot table', async ({
  page,
  account,
}) => {
  const visit = await importExplorerVisit(
    account,
    'explorer-long.csv',
    localToday(),
    Array.from({ length: 51 }, (_, index) =>
      explorerRow('7i', '130', '120', String(100 + index), '90'),
    ),
  );
  await login(page, account);
  const explorer = await openExplorer(page);
  await explorer.getByRole('button', { name: 'Session', exact: true }).click();
  await explorer
    .getByRole('combobox', { name: 'Session', exact: true })
    .selectOption(visit.sessionId);
  const points = explorer.getByRole('button', { name: /^Plot / });
  await expect(points).toHaveCount(51);
  const tabStop = explorer.locator('circle[tabindex="0"]');
  await expect(tabStop).toHaveCount(1);
  await tabStop.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabStop).toBeFocused();
  await expect(tabStop).toHaveAccessibleName(/^Plot 7i row 2\b/);

  const table = explorer.getByRole('table', { name: '7i explorer shots' });
  const inspect = table.getByRole('button', { name: /^Inspect row / });
  await expect(inspect).toHaveCount(50);
  await explorer.getByRole('button', { name: 'Next shot page' }).click();
  await expect(inspect).toHaveCount(1);
  await inspect.click();
  await expect(
    explorer.getByRole('region', { name: /^Selected shot/ }),
  ).toContainText('Row 51');
  await explorer.getByRole('button', { name: 'Previous shot page' }).click();
  await expect(inspect).toHaveCount(50);
});
