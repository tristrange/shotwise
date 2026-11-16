import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const url =
  process.env.SHOTWISE_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host))
  throw new Error('Database tests must target a local database.');
const sql = fileURLToPath(new URL('../tests/db.sql', import.meta.url));
const result = spawnSync(
  'psql',
  [url, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sql],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const query = (statement) =>
  new Promise((resolve, reject) => {
    const child = spawn('psql', [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr }),
    );
    child.stdin.end(statement);
  });
const literal = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const asOwner = (owner, statement) =>
  `set role authenticated; set request.jwt.claim.sub='${owner}'; ${statement}`;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const requireResult = (result, label) => {
  if (!result.ok) throw new Error(`${label}: ${result.stderr}`);
  return result.stdout;
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture(name) {
  const headers = ['Shot #', 'Club', 'Carry Dist. Range (m)'];
  const distance = name === 'first' ? '1' : '2';
  const raw = { 'Shot #': '1', Club: '7i', 'Carry Dist. Range (m)': distance };
  const sorted = [...headers].sort();
  const bytes = Buffer.from(
    `Shot #,Club,Carry Dist. Range (m)\n1,7i,${distance}`,
  );
  const measurements = Object.fromEntries(
    [
      'carryRange',
      'flatCarryRange',
      'carryPremium',
      'flatCarryPremium',
      'totalRange',
      'flatTotalRange',
      'totalPremium',
      'flatTotalPremium',
      'apexRange',
      'apexPremium',
      'speedRange',
      'speedPremium',
      'launchRange',
      'launchPremium',
      'launchDirection',
      'fromCentre',
      'curve',
      'proximity',
      'target',
      'strokesGained',
    ].map((key) => [key, null]),
  );
  measurements.carryRange = Number(distance);
  return {
    filename: `${name}.csv`,
    date: '2026-11-16',
    time: null,
    venue: '',
    notes: '',
    confirmedFull: true,
    allowSameDay: false,
    preview: {
      originalBase64: bytes.toString('base64'),
      fileHash: digest(bytes),
      contentHash: digest(
        JSON.stringify([sorted, [sorted.map((h) => raw[h])]]),
      ),
      parserVersion: 'inrange-1',
      headers,
      warnings: [],
      shots: [
        {
          rowIndex: 1,
          sourceNumber: '1',
          recordedClub: '7i',
          raw,
          measurements,
        },
      ],
    },
  };
}

function parseWithClient(csv) {
  const code = `import { parseCsv } from './src/domain/csv.ts'; const bytes=Buffer.from(process.argv[1],'base64'); console.log(JSON.stringify(await parseCsv(bytes)));`;
  const parsed = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      code,
      Buffer.from(csv).toString('base64'),
    ],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
  );
  if (parsed.status !== 0)
    throw new Error(`Frontend parser fixture: ${parsed.stderr}`);
  return JSON.parse(parsed.stdout);
}
const owner = randomUUID(),
  raceOwner = randomUUID(),
  sourceOwner = randomUUID(),
  backupOwner = randomUUID();
try {
  const input = fixture('first');
  const importSql = `select public.commit_import(${literal(input)});`;
  const imports = await Promise.all([
    query(asOwner(owner, importSql)),
    query(asOwner(owner, importSql)),
  ]);
  const importResults = imports.map((r, index) =>
    JSON.parse(requireResult(r, `concurrent import ${index + 1}`)),
  );
  assert(
    importResults[0].sessionId === importResults[1].sessionId &&
      importResults.filter((r) => r.duplicate).length === 1,
    'Concurrent imports did not converge on one session',
  );
  const snapshotSql = `select jsonb_build_object('version',public.dataset_version(),'sessions',public.dataset_page('sessions',0,100),'shots',public.dataset_page('shots',0,100),'imports',public.dataset_page('imports',0,100),'events',public.dataset_page('events',0,100));`;
  let dataset = JSON.parse(
    requireResult(
      await query(asOwner(owner, snapshotSql)),
      'read imported data',
    ),
  );
  assert(
    dataset.sessions.length === 1 &&
      dataset.shots.length === 1 &&
      dataset.imports.length === 1,
    'Concurrent imports left partial or duplicate data',
  );
  const shot = dataset.shots[0];
  const change = {
    shotId: shot.id,
    expectedRevision: shot.revision,
    review: { ...shot.review, contact: 'typical' },
  };
  const reviewSql = `select public.apply_reviews(${literal([change])});`;
  const reviews = await Promise.all([
    query(asOwner(owner, reviewSql)),
    query(asOwner(owner, reviewSql)),
  ]);
  assert(
    reviews.filter((r) => r.ok).length === 1 &&
      reviews.filter((r) => !r.ok && r.stderr.includes('Review conflict'))
        .length === 1,
    'Concurrent reviews did not produce one success and one conflict',
  );
  dataset = JSON.parse(
    requireResult(
      await query(asOwner(owner, snapshotSql)),
      'read reviewed data',
    ),
  );
  assert(
    dataset.shots[0].revision === 1 && dataset.events.length === 1,
    'Concurrent reviews left an unexpected revision or event count',
  );
  const restoreSql = `select public.restore_backup(${literal(dataset)});`;
  const competingImport = `select public.commit_import(${literal(fixture('second'))});`;
  const race = await Promise.all([
    query(asOwner(raceOwner, restoreSql)),
    query(asOwner(raceOwner, competingImport)),
  ]);
  assert(
    race.filter((r) => r.ok).length === 1,
    'Concurrent restore and import must have exactly one winner',
  );
  const final = JSON.parse(
    requireResult(
      await query(asOwner(raceOwner, snapshotSql)),
      'read restore/import race',
    ),
  );
  assert(
    final.sessions.length === 1 &&
      final.shots.length === 1 &&
      final.imports.length === 1 &&
      final.version === 1,
    'Concurrent restore/import left partial data',
  );
  if (race[0].ok) {
    assert(
      race[1].stderr.includes('Same-day import requires acknowledgement'),
      'Import failed for an unexpected reason',
    );
    assert(
      final.sessions[0].id === dataset.sessions[0].id &&
        final.events.length === 1,
      'Restore winner did not preserve its snapshot',
    );
  } else {
    assert(
      race[0].stderr.includes('Restore requires empty dataset'),
      'Restore failed for an unexpected reason',
    );
    assert(
      final.sessions[0].filename === 'second.csv' && final.events.length === 0,
      'Import winner did not preserve its data',
    );
  }
  const sourceCsv =
    '\ufeffShot #,Club,Carry Dist. Range (m),Launch Direction,Curve,Notes\r\n1," 7i ",0,12 L,-3 R,"comma, quote ""yes""\r\nsecond line"\r\n\r\n2,PW,--,invalid,91°,"  "\r\n';
  const sourcePreview = parseWithClient(sourceCsv);
  const sourceInput = { ...fixture('source'), preview: sourcePreview };
  const invalid = async (candidate, label) => {
    const r = await query(
      asOwner(
        sourceOwner,
        `select public.commit_import(${literal(candidate)});`,
      ),
    );
    assert(!r.ok, `${label} was accepted`);
    const state = JSON.parse(
      requireResult(
        await query(asOwner(sourceOwner, snapshotSql)),
        `read ${label} state`,
      ),
    );
    assert(
      state.version === 0 && state.sessions.length === 0,
      `${label} left partial state`,
    );
  };
  const wrongVersion = clone(sourceInput);
  wrongVersion.preview.parserVersion = 'test';
  await invalid(wrongVersion, 'wrong parser version');
  for (const [label, text] of [
    ['original bytes mismatch', sourceCsv.replace('1," 7i ",0', '1," 7i ",1')],
    ['missing CSV header', 'Shot #,Club\n1,7i'],
    ['unclosed quoted field', 'Shot #,Club,Carry Dist. Range (m)\n1,7i,"0'],
  ]) {
    const bad = clone(sourceInput);
    const bytes = Buffer.from(text);
    bad.preview.originalBase64 = bytes.toString('base64');
    bad.preview.fileHash = digest(bytes);
    await invalid(bad, label);
  }
  const wrongRaw = clone(sourceInput);
  wrongRaw.preview.shots[0].raw.Notes = 'changed';
  const sorted = [...wrongRaw.preview.headers].sort();
  wrongRaw.preview.contentHash = digest(
    JSON.stringify([
      sorted,
      wrongRaw.preview.shots.map((s) => sorted.map((h) => s.raw[h])),
    ]),
  );
  await invalid(wrongRaw, 'CSV cell mismatch');
  const wrongMeasurement = clone(sourceInput);
  wrongMeasurement.preview.shots[0].measurements.curve = 999;
  await invalid(wrongMeasurement, 'measurement mismatch');
  requireResult(
    await query(
      asOwner(
        sourceOwner,
        `select public.commit_import(${literal(sourceInput)});`,
      ),
    ),
    'valid client CSV with BOM, quotes, embedded newline and malformed cells',
  );
  const sourceDataset = JSON.parse(
    requireResult(
      await query(asOwner(sourceOwner, snapshotSql)),
      'read source dataset',
    ),
  );
  assert(
    sourceDataset.shots.length === 2 &&
      sourceDataset.shots.some((s) => s.measurements.curve === 3) &&
      sourceDataset.shots.some((s) => s.measurements.launchDirection === null),
    'valid source measurements differ',
  );
  const badBackup = clone(sourceDataset);
  badBackup.shots[0].measurements.carryRange = 999;
  const rejected = await query(
    asOwner(
      backupOwner,
      `select public.restore_backup(${literal(badBackup)});`,
    ),
  );
  assert(!rejected.ok, 'backup with inconsistent measurements was accepted');
  const emptyBackup = JSON.parse(
    requireResult(
      await query(asOwner(backupOwner, snapshotSql)),
      'read rejected backup state',
    ),
  );
  assert(
    emptyBackup.version === 0 && emptyBackup.sessions.length === 0,
    'invalid backup left partial data',
  );
  requireResult(
    await query(
      asOwner(
        backupOwner,
        `select public.restore_backup(${literal(sourceDataset)});`,
      ),
    ),
    'restore validated source',
  );
  console.log(
    'Concurrent import, review, restore/import, and CSV provenance tests passed.',
  );
} finally {
  const owners = `'${owner}','${raceOwner}','${sourceOwner}','${backupOwner}'`;
  const cleanup = await query(
    `delete from public.review_events where owner_id in (${owners}); delete from public.reviews where owner_id in (${owners}); delete from public.shots where owner_id in (${owners}); delete from public.imports where owner_id in (${owners}); delete from public.sessions where owner_id in (${owners}); delete from private.versions where owner_id in (${owners});`,
  );
  requireResult(cleanup, 'clean up concurrent test data');
}
