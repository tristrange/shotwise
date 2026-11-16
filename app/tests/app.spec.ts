import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localStack } from './local';
import { csvFixture } from '../src/domain/fixtures';
import { localToday, type Dataset } from '../src/domain/model';
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
