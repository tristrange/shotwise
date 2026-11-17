import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fromBase64, parseCsv, suggestDate } from '../src/domain/csv';
import { makeSession, makeShot } from '../src/domain/fixtures';
import {
  assessUnusualShots,
  UNUSUAL_SHOT_RULE,
} from '../src/domain/unusualShots';

const directory = process.argv[2];
assert(directory, 'Usage: npm run verify:unusual -- /absolute/path/to/exports');
const filenames = (await readdir(directory)).filter((name) =>
  name.endsWith('.csv'),
);
assert(filenames.length, 'No CSV exports found');
const exports = await Promise.all(
  filenames.map(async (filename) => {
    const date = suggestDate(filename);
    assert(date, 'Each export needs an unambiguous date in its filename');
    const bytes = new Uint8Array(await readFile(join(directory, filename)));
    const parsed = await parseCsv(bytes);
    assert.deepEqual(fromBase64(parsed.originalBase64), bytes);
    const session = makeSession({ date });
    return {
      session,
      shots: parsed.shots.map((shot) =>
        makeShot({ ...shot, sessionId: session.id }),
      ),
      warnings: parsed.warnings.length,
    };
  }),
);
exports.sort((a, b) => a.session.date.localeCompare(b.session.date));
const sessions = exports.map((entry) => entry.session);
const shots = exports.flatMap((entry) => entry.shots);
const original = structuredClone(shots);
const assessments = assessUnusualShots(shots, sessions);
assert.deepEqual(shots, original, 'Assessment changed imported shots');
assert.deepEqual(
  assessUnusualShots([...shots].reverse(), [...sessions].reverse()),
  assessments,
  'Assessment depends on input array order',
);
for (let i = 1; i <= exports.length; i++) {
  const prefix = exports.slice(0, i);
  const earlier = assessUnusualShots(
    prefix.flatMap((entry) => entry.shots),
    prefix.map((entry) => entry.session),
  );
  for (const [id, assessment] of earlier) {
    assert.deepEqual(
      assessments.get(id),
      assessment,
      'Later sessions changed an earlier assessment',
    );
  }
}
const values = [...assessments.values()];
console.info(
  JSON.stringify(
    {
      rule: UNUSUAL_SHOT_RULE,
      files: exports.length,
      shots: shots.length,
      warnings: exports.reduce((n, entry) => n + entry.warnings, 0),
      eligibleIrons: values.length,
      assessed: values.filter((a) => a.kind === 'assessed').length,
      abstained: values.filter((a) => a.kind === 'abstained').length,
      flagged: values.filter((a) => a.kind === 'assessed' && a.unusual).length,
      originalBytesAndShotsPreserved: true,
      futureSessionInvariant: true,
      note: 'Filename dates are assumed for this local check. No contact or intent ground truth; flag counts do not measure accuracy.',
    },
    null,
    2,
  ),
);
