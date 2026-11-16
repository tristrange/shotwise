import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { parseCsv, fromBase64 } from '../src/domain/csv';

const filename = process.argv[2];
if (!filename)
  throw new Error('Usage: npm run verify:csv -- /absolute/path/to/export.csv');
const bytes = new Uint8Array(await readFile(filename));
const preview = await parseCsv(bytes);
assert.deepEqual(fromBase64(preview.originalBase64), bytes);
assert.deepEqual(
  preview.shots.map((s) => s.rowIndex),
  Array.from({ length: preview.shots.length }, (_, i) => i + 1),
);
const result = {
  rows: preview.shots.length,
  columns: preview.headers.length,
  clubs: new Set(preview.shots.map((s) => s.recordedClub)).size,
  warnings: preview.warnings.length,
  missingDirection: preview.shots.filter(
    (s) => s.measurements.launchDirection === null,
  ).length,
  missingLateral: preview.shots.filter(
    (s) => s.measurements.fromCentre === null,
  ).length,
  missingTarget: preview.shots.filter((s) => s.measurements.target === null)
    .length,
  missingProximity: preview.shots.filter(
    (s) => s.measurements.proximity === null,
  ).length,
};
if (process.argv.includes('--sample-acceptance'))
  assert.deepEqual(result, {
    rows: 123,
    columns: 22,
    clubs: 9,
    warnings: 0,
    missingDirection: 86,
    missingLateral: 86,
    missingTarget: 98,
    missingProximity: 98,
  });
if (process.argv.includes('--database')) {
  const url =
    process.env.SHOTWISE_DB_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  assert(
    ['127.0.0.1', 'localhost'].includes(new URL(url).hostname),
    'CSV acceptance requires a local database',
  );
  const input = JSON.stringify({
    filename: basename(filename),
    date: '2026-11-05',
    time: null,
    venue: '',
    notes: '',
    confirmedFull: false,
    allowSameDay: false,
    preview,
  }).replaceAll("'", "''");
  execFileSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin; set local role authenticated; set local request.jwt.claim.sub='${crypto.randomUUID()}'; select public.commit_import('${input}'::jsonb); rollback;`,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
console.info(
  JSON.stringify(
    {
      ...result,
      originalBytesPreserved: true,
      orderPreserved: true,
      databaseValidated: process.argv.includes('--database'),
    },
    null,
    2,
  ),
);
