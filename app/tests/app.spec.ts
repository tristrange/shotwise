import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localStack } from './local';
import { csvFixture } from '../src/domain/fixtures';
import { localToday, shiftDate, type Dataset } from '../src/domain/model';
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
    page.getByRole('heading', { name: 'Your overview' }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole('button', { name, exact: true })
    .filter({ visible: true })
    .click();
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
        bar: color('--accent'),
        grid: color('--surface-subtle'),
        label: color('--text-muted'),
      };
      probe.remove();
      return result;
    });
    await expect(page.locator('.gap-dot').first()).toHaveCSS(
      'background-color',
      colors.bar,
    );
    await expect(page.locator('.gap-track').first()).toHaveCSS(
      'background-color',
      colors.grid,
    );
    await expect(page.locator('.gap-n').first()).toHaveCSS(
      'color',
      colors.label,
    );
  }
  await page.screenshot({
    path: testInfo.outputPath('dark-overview.png'),
    fullPage: true,
  });
});

test('shares the analysis window, basis and review filters across pages', async ({
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
  const data = await account.repository.load();
  const recent = data.sessions.find(
    (session) => session.filename === 'recent.csv',
  );
  await account.repository.review(
    data.shots
      .filter((shot) => shot.sessionId === recent?.id)
      .slice(0, 5)
      .map((shot) => ({
        shotId: shot.id,
        expectedRevision: shot.revision,
        review: { ...shot.review, intent: 'full', contact: 'typical' },
      })),
  );
  await login(page, account);
  await expect(
    page.getByRole('table').first().getByRole('row').nth(1),
  ).toContainText('120.0 m');
  await nav(page, 'Gapping');
  const gapping = page.getByRole('list', { name: 'Club carry distances' });
  await expect(gapping).toContainText('Median 120 m');
  await expect(page.getByText(/7i shots tend to curve right/)).toBeVisible();
  await page
    .getByRole('combobox', { name: 'View', exact: true })
    .selectOption('all');
  await expect(gapping).toContainText('Median 70 m');
  await expect(page.getByText(/7i shots tend to curve left/)).toBeVisible();
  await nav(page, 'Overview');
  await expect(
    page.getByRole('combobox', { name: 'View', exact: true }),
  ).toHaveValue('all');
  await expect(
    page.getByRole('table').first().getByRole('row').nth(1),
  ).toContainText('70.0 m');
  await page
    .getByRole('combobox', { name: 'Measurement basis', exact: true })
    .selectOption('range-flat');
  await nav(page, 'Gapping');
  await expect(
    page.getByRole('combobox', { name: 'Measurement basis', exact: true }),
  ).toHaveValue('range-flat');
  await expect(gapping).toContainText('Median 80 m');
  await page
    .getByRole('combobox', { name: 'Contact', exact: true })
    .selectOption('typical');
  await page
    .getByRole('combobox', { name: 'Intent', exact: true })
    .selectOption('full');
  await expect(gapping).toContainText('Median 130 m');
  await expect(gapping).toContainText('5');
  await nav(page, 'Progress');
  await expect(
    page.getByRole('heading', { name: 'Carry over time' }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Contact', exact: true }),
  ).toHaveValue('typical');
  await expect(
    page.getByRole('combobox', { name: 'Intent', exact: true }),
  ).toHaveValue('full');
  await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(2);
  await expect(
    page.getByRole('table').first().getByRole('row').nth(1),
  ).toContainText('130.0 m');
  await page
    .getByRole('combobox', { name: 'View', exact: true })
    .selectOption('recent');
  await nav(page, 'Overview');
  await expect(
    page.getByRole('combobox', { name: 'View', exact: true }),
  ).toHaveValue('recent');
  await expect(
    page.getByRole('table').first().getByRole('row').nth(1),
  ).toContainText('130.0 m');
  await nav(page, 'Gapping');
  await page
    .getByRole('combobox', { name: 'Intent', exact: true })
    .selectOption('unknown');
  await expect(
    page.getByText('No comparable shots for these filters.'),
  ).toBeVisible();
});

test('shows readable gapping values and distinguishes overlapping carry bands', async ({
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
          { Club: 'SW', 'Flat Carry Dist. Premium (m)': '60' },
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
  await expect(rows.nth(1)).toContainText('Median 123 m');
  await expect(rows.nth(1)).toContainText('Middle 80%: 110–136 m');
  await expect(rows.nth(1)).toContainText('Gap: 25 m');
  await expect(rows.nth(1)).toContainText('bands overlap');
  await expect(rows.nth(2)).toContainText('Spread needs 10 shots');
  await expect(page.getByText(/6i and 7i carry bands overlap/)).toBeVisible();
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
  await page
    .getByRole('combobox', { name: 'Measurement basis', exact: true })
    .selectOption('range-flat');
  await expect(
    page.getByText('No comparable shots for these filters.'),
  ).toBeVisible();
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
  await expect(
    page.getByText('Unusual shot · experimental', { exact: false }),
  ).toBeVisible();
  const target = page.locator('.shot').filter({ hasText: 'Row 21 · Shot #21' });
  await expect(target).toContainText('40.0 m');
  await expect(target).toContainText('90.0 kph');
  await expect(target).toContainText('20 earlier paired shots');
  await expect(target).toContainText('102.0 m');
  await expect(target).toContainText('142.0 kph');
  await expect(target).toContainText('81.6 m');
  await expect(target).toContainText('127.8 kph');
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
  await expect(target).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse all', exact: true }).click();
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
  await page.getByRole('button', { name: 'Flagged only', exact: true }).click();
  await expect(target).toContainText('Unusual shot · experimental');
  const restored = await account.repository.load();
  expect(restored.shots.map((shot) => ({ ...shot, revision: 0 }))).toEqual(
    before.shots.map((shot) => ({ ...shot, revision: 0 })),
  );
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
  await page.getByLabel('I confirm this session date').check();
  await page
    .getByLabel('Mark non-wedge shots as full swings.', { exact: false })
    .check();
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
      .every((s) => s.review.intent === 'full'),
  ).toBe(true);
  await page.getByRole('button', { name: /3 shots →/ }).click();
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
  await other
    .getByRole('combobox', { name: 'Contact', exact: true })
    .selectOption('typical');
  await expect(
    other.getByText('Contact reviewed 1/3', { exact: false }),
  ).toBeVisible();
  await other.getByRole('button', { name: '9i', exact: true }).click();
  await expect(other.getByRole('heading', { name: '9i shots' })).toBeVisible();
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
  await page.getByRole('button', { name: /3 shots →/ }).click();
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
  await page.getByRole('button', { name: /3 shots →/ }).click();
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
  await page
    .getByRole('combobox', { name: 'Club', exact: true })
    .selectOption('7i');
  await expect(page.getByRole('heading', { name: '7i shots' })).toBeVisible();
  await expect(
    page.getByRole('table').last().getByRole('row').nth(1),
  ).toContainText('1 / 1');
  await page.screenshot({
    path: testInfo.outputPath('overview.png'),
    fullPage: true,
  });
  const tables = page.getByRole('table');
  await expect(tables.first()).toBeVisible();
  await expect(tables.first().getByRole('row')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await nav(page, 'Progress');
  await expect(
    page.getByRole('heading', { name: 'Carry over time' }),
  ).toBeVisible();
  await nav(
    page,
    testInfo.project.name === 'phone-webkit' ? 'Sessions' : 'Sessions & import',
  );
  await page
    .getByLabel('Choose CSV files')
    .setInputFiles({
      name: 'renamed.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(fixture()),
    });
  await page.getByLabel('Session date', { exact: true }).fill(localToday());
  await page.getByLabel('I confirm this session date').check();
  await page.getByRole('button', { name: 'Import valid files' }).click();
  await expect(
    page.getByText('Duplicate export — already imported.', { exact: true }),
  ).toBeVisible();
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
