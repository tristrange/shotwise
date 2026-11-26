import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { csvFixture } from '../src/domain/fixtures';
import { parseCsv } from '../src/domain/csv';
import { parseBackup, serializeBackup } from '../src/domain/backup';
import { localToday, shiftDate } from '../src/domain/model';
import { createRepository } from '../src/data/repository';
import type { Database } from '../src/data/database.types';
import { localStack } from '../tests/local';

/**
 * A1 heavy verification (release-readiness finding A1): drives the normal
 * authenticated PostgREST RPCs through the repository adapter, under the
 * authenticated role's default 8 s statement timeout, with the realistic
 * fixtures from the release review:
 *   1. import a deterministic 3,000-shot / ~218 KB Inrange CSV (must succeed,
 *      and re-importing must report the duplicate),
 *   2. build a 105-visit history from ordinary 120-shot visits,
 *   3. export the backup through the normal snapshot path,
 *   4. restore it into a fresh account and verify counts, original bytes,
 *      hashes, reviews and version.
 * Synthetic data only; both accounts are deleted at the end. Requires a local
 * Supabase stack (env SHOTWISE_API_URL / SHOTWISE_PUBLISHABLE_KEY /
 * SHOTWISE_SERVICE_ROLE_KEY override `npx supabase status`).
 *
 * Usage: npm run verify:import-restore
 */

const stack =
  process.env.SHOTWISE_API_URL &&
  process.env.SHOTWISE_PUBLISHABLE_KEY &&
  process.env.SHOTWISE_SERVICE_ROLE_KEY
    ? {
        API_URL: process.env.SHOTWISE_API_URL,
        PUBLISHABLE_KEY: process.env.SHOTWISE_PUBLISHABLE_KEY,
        SERVICE_ROLE_KEY: process.env.SHOTWISE_SERVICE_ROLE_KEY,
      }
    : localStack();

const admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const mkRows = (carry: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    Club: '7i',
    'Flat Carry Dist. Premium (m)': String(carry + (i % 3) - 1),
    'Flat Carry Dist. Range (m)': String(carry - 3 + (i % 3) - 1),
    'Ball Speed (kph) Premium': String(210 + (i % 3)),
    'Ball Speed (kph)': String(205 + (i % 3)),
    'Launch Angle (deg) Premium': '16',
    'Launch Angle (deg)': '16',
    'Apex (m) Premium': '23',
    'Launch Direction': '1R',
    Curve: '2R',
    'From Centre (m)': '4R',
  }));

const log = (tag: string, value: unknown) =>
  console.log(tag, JSON.stringify(value));
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const today = localToday();
const password = randomUUID() + 'Aa1!';
const email = (label: string) =>
  `shotwise-a1-${label}-${randomUUID()}@example.test`;

async function makeAccount(label: string) {
  const user = email(label);
  const created = await admin.auth.admin.createUser({
    email: user,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const client = createClient<Database>(stack.API_URL, stack.PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  const login = await client.auth.signInWithPassword({
    email: user,
    password,
  });
  if (login.error) throw login.error;
  return {
    id: created.data.user.id,
    repository: createRepository(client),
  };
}

const importCsv = async (
  repository: ReturnType<typeof createRepository>,
  filename: string,
  date: string,
  time: string | null,
  rows: Record<string, string>[],
) => {
  const bytes = new TextEncoder().encode(csvFixture(rows));
  const preview = await parseCsv(bytes);
  const start = performance.now();
  const result = await repository.importCsv({
    filename,
    date,
    time,
    venue: 'Synthetic range',
    notes: '',
    confirmedFull: false,
    allowSameDay: true,
    preview,
  });
  return {
    result,
    ms: Math.round(performance.now() - start),
    bytes: bytes.byteLength,
  };
};

const source = await makeAccount('source');
const bigDate = shiftDate(today, -7);
let backupText = '';
try {
  // 1. The 3,000-shot deterministic Inrange CSV from the release review.
  const big = await importCsv(
    source.repository,
    `perf-3000-${bigDate}.csv`,
    bigDate,
    null,
    mkRows(135, 3000),
  );
  assert(big.result.duplicate === false, '3,000-shot import was not accepted');
  log('import-3000', big);
  const again = await importCsv(
    source.repository,
    `perf-3000-${bigDate}.csv`,
    bigDate,
    null,
    mkRows(135, 3000),
  );
  assert(
    again.result.duplicate === true &&
      again.result.sessionId === big.result.sessionId,
    're-import did not converge on the same session as a duplicate',
  );
  log('import-3000-duplicate', { ms: again.ms });

  // 2. A realistic 105-visit history from ordinary 120-shot visits.
  const visitsStart = performance.now();
  const visitMs: number[] = [];
  for (let i = 0; i < 105; i++) {
    const r = await importCsv(
      source.repository,
      `backup-synthetic-${i}.csv`,
      shiftDate(today, -25 - i),
      '09:00',
      mkRows(120 + i / 100, 120),
    );
    visitMs.push(r.ms);
  }
  log('visits-105', {
    totalMs: Math.round(performance.now() - visitsStart),
    min: Math.min(...visitMs),
    max: Math.max(...visitMs),
  });

  // 3. Export the backup through the normal snapshot path.
  const exportStart = performance.now();
  const dataset = await source.repository.load();
  backupText = serializeBackup(dataset);
  const backupFile = join(tmpdir(), `shotwise-a1-verify-${randomUUID()}.json`);
  await writeFile(backupFile, backupText);
  log('backup-export', {
    bytes: Buffer.byteLength(backupText),
    shots: dataset.shots.length,
    sessions: dataset.sessions.length,
    imports: dataset.imports.length,
    exportMs: Math.round(performance.now() - exportStart),
    file: backupFile,
  });
  assert(dataset.shots.length === 3000 + 105 * 120, 'unexpected shot count');
  assert(dataset.sessions.length === 106, 'unexpected session count');

  // 4. Restore into a fresh account through the authenticated API.
  const destination = await makeAccount('restore');
  try {
    const parsed = await parseBackup(backupText);
    const restoreStart = performance.now();
    await destination.repository.restore(parsed);
    const restoreMs = Math.round(performance.now() - restoreStart);
    const restored = await destination.repository.load();
    log('backup-restore', { ms: restoreMs });
    assert(restored.version === 1, 'restored version');
    assert(restored.sessions.length === 106, 'restored session count');
    assert(restored.shots.length === 3000 + 105 * 120, 'restored shot count');
    assert(restored.imports.length === 106, 'restored import count');
    assert(
      restored.shots.every((shot) => shot.review && shot.revision === 0),
      'restored shots lost reviews',
    );
    const sourceHashes = new Set(dataset.imports.map((i) => i.fileHash));
    const restoredHashes = new Set(restored.imports.map((i) => i.fileHash));
    assert(
      sourceHashes.size === restoredHashes.size &&
        [...sourceHashes].every((hash) => restoredHashes.has(hash)),
      'restored original file hashes differ from the source backup',
    );
    const sourceBytes = new Set(dataset.imports.map((i) => i.originalBase64));
    assert(
      restored.imports.every((i) => sourceBytes.has(i.originalBase64)),
      'restored original bytes differ from the source backup',
    );
    const digest = (value: string) =>
      createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
    assert(
      restored.imports.every((i) => digest(i.originalBase64) === i.fileHash),
      'restored file hash does not match its original bytes',
    );
    log('restore-verify', {
      shots: restored.shots.length,
      sessions: restored.sessions.length,
      imports: restored.imports.length,
      version: restored.version,
    });
  } finally {
    await admin.auth.admin.deleteUser(destination.id);
  }
  console.log('A1 heavy verification passed.');
} finally {
  await admin.auth.admin.deleteUser(source.id);
}
