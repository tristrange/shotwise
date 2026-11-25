import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseCsv, suggestDate } from '../src/domain/csv';
import { makeSession, makeShot } from '../src/domain/fixtures';
import { evaluateScenario, type GroundTruth } from '../src/domain/evaluation';
import type { Session, Shot } from '../src/domain/model';

/**
 * Opt-in real-world evaluation pilot (roadmap §13, item B2). Runs the versioned
 * automatic layers over a real Inrange export and scores them against an
 * optional hand-labelled subset. Lightweight by design: label only the shots
 * you care about (mishits, partials, forgotten switches), not the whole file.
 *
 * The export and labels never leave this machine: nothing is written back,
 * committed or uploaded. Synthetic verification stays in verify:classifier.
 *
 * Usage:
 *   npm run verify:realworld -- /abs/export1.csv [/abs/export2.csv ...] --labels /abs/labels.json
 *
 * labels.json maps "<filename>#<rowIndex>" to ground truth, e.g.:
 *   { "session-a.csv#12": { "intent": "full", "contact": "mishit", "club": "7i" } }
 */

const args = process.argv.slice(2);
const labelFlag = args.indexOf('--labels');
const files =
  labelFlag >= 0
    ? args.filter((_, i) => i !== labelFlag && i !== labelFlag + 1)
    : args;
const labelsPath = labelFlag >= 0 ? args[labelFlag + 1] : undefined;
if (files.length === 0)
  throw new Error(
    'Usage: npm run verify:realworld -- /abs/export.csv [...] --labels /abs/labels.json',
  );

type LabelFile = Record<string, GroundTruth>;
const labels: LabelFile = labelsPath
  ? JSON.parse(await readFile(labelsPath, 'utf8'))
  : {};

const sessions: Session[] = [];
const shots: Shot[] = [];
const truth = new Map<string, GroundTruth>();

for (const file of files) {
  const bytes = new Uint8Array(await readFile(file));
  const preview = await parseCsv(bytes);
  const name = basename(file);
  const date = suggestDate(name);
  if (!date)
    throw new Error(
      `${name}: no recognizable date in the filename — rename it like 'session-2026-11-16.csv' or pass a dated export, otherwise session chronology cannot be determined`,
    );
  const session = makeSession({
    id: `pilot-${name}-${preview.fileHash.slice(0, 8)}`,
    date,
    filename: name,
  });
  sessions.push(session);
  for (const parsed of preview.shots) {
    const shot = makeShot({ ...parsed, sessionId: session.id });
    shots.push(shot);
    const expected = labels[`${name}#${parsed.rowIndex}`];
    if (expected) truth.set(shot.id, expected);
  }
  console.log(
    `${name}: ${preview.shots.length} shots, ${preview.warnings.length} parser warnings`,
  );
}

if (truth.size === 0)
  console.log(
    'No labels matched any "<filename>#<rowIndex>" key — reporting coverage only.',
  );

const report = evaluateScenario({
  name: 'realworld-pilot',
  description: 'Opt-in local pilot over real Inrange exports',
  sessions,
  shots,
  truth,
});

// Input-order invariance on real data: reversing the export must not change
// the scores.
const reversed = evaluateScenario({
  name: 'realworld-pilot-reversed',
  description: 'Same export, reversed input order',
  sessions: [...sessions].reverse(),
  shots: [...shots].reverse(),
  truth,
});
const invariant = JSON.stringify(reversed.automatic) === JSON.stringify(report.automatic);
console.log(`input-order invariance: ${invariant ? 'ok' : 'MISMATCH'}`);

const pct = (v: number | null) => (v === null ? '  —  ' : `${(v * 100).toFixed(1)}%`);
for (const d of report.automatic) {
  console.log(
    `${d.dimension.padEnd(8)} eligible ${d.eligible}  assessed ${d.assessed}  abstained ${d.abstained}` +
      `  coverage ${pct(d.coverage)}  acc(assessed) ${pct(d.accuracyOnAssessed)}  recall(e2e) ${pct(d.recallEndToEnd)}` +
      `  FP ${d.falsePositives}  FN ${d.falseNegatives}` +
      (d.abstainedByTruth.length
        ? `  abstained-by-truth ${d.abstainedByTruth.map((a) => `${a.label}:${a.count}`).join(', ')}`
        : ''),
  );
}
console.log(
  `classifier ${report.classifierVersion} · sequence ${report.ruleVersion} · ` +
    `${shots.length} shots, ${truth.size} labelled`,
);
