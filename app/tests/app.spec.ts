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
    page.getByRole('heading', { name: 'Overview', exact: true }),
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
  const driver = page
    .getByRole('table')
    .first()
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'D', exact: true }) });
  const pitchingWedge = page
    .getByRole('table')
    .first()
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'PW', exact: true }) });
  await expect(driver.getByRole('cell').nth(2)).toHaveText('25');
  const toggle = page.getByRole('button', {
    name: 'Hide likely mishits',
    exact: true,
  });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(driver.getByRole('cell').nth(2)).toHaveText('20');
  await expect(pitchingWedge.getByRole('cell').nth(2)).toHaveText('23');
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
    page.getByRole('list', { name: 'Club carry distances' }),
  ).toContainText('small median gap');
  await nav(page, 'Progress');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('table', { name: 'D session details', exact: true }),
  ).toContainText('20 / 0');
  await nav(page, 'Shot shape');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.context')).toContainText('63 shots');
  await nav(page, 'Overview');
  await toggle.click();
  await expect(driver.getByRole('cell').nth(2)).toHaveText('25');
  expect(await account.repository.load()).toEqual(original);
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
  await expect(
    page.getByRole('table').first().getByRole('row').nth(1),
  ).toContainText('120.0 m');
  await nav(page, 'Gapping');
  const gapping = page.getByRole('list', { name: 'Club carry distances' });
  await expect(gapping).toContainText('Median 120 m');
  await expect(
    page.getByText(/No recurring practice patterns yet/),
  ).toBeVisible();
  await window.getByRole('button', { name: 'All-time' }).click();
  await expect(gapping).toContainText('Median 70 m');
  await expect(
    page.getByText(/No recurring practice patterns yet/),
  ).toBeVisible();

  await nav(page, 'Overview');
  await expect(window.getByRole('button', { name: 'All-time' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('table').first().getByRole('row').nth(1),
  ).toContainText('70.0 m');
  await basis.click();
  await expect(basis).toHaveText('Range · flat');

  await nav(page, 'Gapping');
  await expect(basis).toHaveText('Range · flat');
  await expect(gapping).toContainText('Median 80 m');

  await nav(page, 'Progress');
  await expect(
    page.getByRole('heading', { name: 'Carry over time' }),
  ).toBeVisible();
  await expect(window.getByRole('button', { name: 'All-time' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(3);
  await window.getByRole('button', { name: 'Recent' }).click();

  await nav(page, 'Overview');
  await expect(window.getByRole('button', { name: 'Recent' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('table').first().getByRole('row').nth(1),
  ).toContainText('130.0 m');
  await nav(page, 'Gapping');
  await expect(gapping).toContainText('Median 130 m');
});

test('shows separate carry and consistency charts per club with sparse and missing data', async ({
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
  const median = page.getByRole('region', {
    name: '7i median carry chart',
    exact: true,
  });
  const spread = page.getByRole('region', {
    name: '7i carry spread chart',
    exact: true,
  });
  await expect(median).toBeVisible();
  await expect(spread).toBeVisible();
  await expect(median.locator('svg')).toContainText('105.0');
  await expect(median.locator('svg')).toContainText('117.5');
  await expect(spread.locator('svg')).toContainText('15.0');
  await expect(spread.locator('svg')).toContainText('7.5');
  await expect(median.locator('rect')).toHaveCount(2);
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
  await expect(
    page.getByRole('table', { name: '9i session details', exact: true }),
  ).toContainText('60.0 m');
  await expect(details).toContainText('Sample limited');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (
    await median.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    )
  ) {
    await median.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => median.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  }
  await page.screenshot({
    path: testInfo.outputPath('club-progress.png'),
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
  await expect(rows.nth(1)).toContainText('Median 123 m');
  await expect(rows.nth(1)).toContainText('Middle 80%: 110–136 m');
  await expect(rows.nth(1)).toContainText('Gap: 25 m');
  await expect(rows.nth(1)).not.toContainText('bands overlap');
  await expect(rows.nth(2)).toContainText('Spread needs 10 shots');
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
  await expect(focused.locator('.focused-label')).toContainText('Row 21 · Shot #21');
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
      .getByRole('table')
      .first()
      .getByRole('row')
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
  await expect(page.getByText('3 shots', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('table').first().getByRole('row').filter({ hasText: '7i' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('overview.png'),
    fullPage: true,
  });
  const tables = page.getByRole('table');
  await expect(tables.first()).toBeVisible();
  await expect(tables.first().getByRole('row')).toHaveCount(3);
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
        ]),
      ),
    ),
  });
  await login(page, account);
  await nav(page, 'Shot shape');
  const plot = page.getByRole('group', {
    name: '7i recorded shot shapes',
    exact: true,
  });
  await expect(plot.getByRole('button')).toHaveCount(2);
  await expect(
    page.getByText(
      '2 of 4 shots have both measurements; 2 are absent from the plot.',
      { exact: true },
    ),
  ).toBeVisible();
  await plot.getByRole('button', { name: /Plot 7i row 1/ }).click();
  const detail = page.getByRole('region', {
    name: 'Selected shot measurements',
    exact: true,
  });
  await expect(detail).toContainText('5.0° left');
  await expect(detail).toContainText('3.0 m right');
  await expect(detail).toContainText('12.0 m right');
  await expect(detail).toContainText('105.0 m');
  await page.getByText('Shot measurements (4)', { exact: true }).click();
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
  await expect(detail).toContainText('0.0° straight');
  await expect(detail).toContainText('0.0 m straight');
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
  await expect(detail).toContainText('Carry: Missing');
  await expect(plot.getByRole('button')).toHaveCount(2);
  await nav(page, 'Overview');
  await expect(page.getByRole('button', { name: 'Range · flat', exact: true })).toBeVisible();
  await nav(page, 'Shot shape');
  await expect(page.getByRole('button', { name: 'Range · flat', exact: true })).toBeVisible();
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
  const manual = page
    .locator('.preview')
    .filter({
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
  await page.getByLabel('Session date', { exact: true }).last().fill(shiftDate(localToday(), -1));
  await expect(page.getByRole('button', { name: 'Import as a separate session', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Import valid files', exact: true }).click();
  await expect(page.getByText('Same-day import requires acknowledgement', { exact: true })).toBeVisible();
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
  await expect(benchmark).toContainText('Median 65 m');

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
  await expect(benchmark).toContainText('Median 44 m');
  await expect(target).toContainText('1 full, 1 partial, 3 unknown intent');
});
