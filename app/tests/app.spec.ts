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

test('toggles automatic mishits across stats without changing reviews and recommends median gaps', async ({
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
    page.getByText(/Work on 5i: median carry is 111 m versus 109 m for 6i/),
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
  await expect(page.getByText(/7i shots tend to curve right/)).toBeVisible();
  await window.getByRole('button', { name: 'All-time' }).click();
  await expect(gapping).toContainText('Median 70 m');
  await expect(page.getByText(/7i shots tend to curve left/)).toBeVisible();

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
  await expect(rows.nth(1)).not.toContainText('bands overlap');
  await expect(rows.nth(2)).toContainText('Spread needs 10 shots');
  await expect(page.getByText(/Work on 6i/)).toHaveCount(0);
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
  await expect(target).toContainText('Likely mishit · experimental');
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
  await expect(recap).toContainText('13 recorded · 10 included shots');
  await expect(recap).not.toContainText('Median carry 25 m longer');
  await expect(recap).not.toContainText('Carry spread 4.5 m tighter');
  await page.goBack();
  await expect(heading).toBeFocused();
  await page.getByRole('link', { name: new RegExp(older.name) }).click();
  await expect(recap).toContainText('Sparse comparable history');
  await expect(recap).toContainText('16 recorded · 16 included shots');
});
