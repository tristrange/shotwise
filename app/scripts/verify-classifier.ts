import assert from 'node:assert/strict';
import { classifierScenarios } from '../src/domain/evaluationScenarios';
import {
  evaluateClassifierScenarios,
  type DimensionReport,
  type EvaluationReport,
} from '../src/domain/evaluation';

/**
 * Representative classifier evaluation (roadmap §5.8): runs the versioned
 * automatic layers over labelled synthetic scenarios and prints coverage,
 * accuracy on assessed shots, false positives and false negatives per
 * dimension, then asserts the safeguard thresholds. Synthetic fixtures only —
 * personal shot exports are never committed or evaluated here.
 *
 * Usage: npm run verify:classifier
 */

const reports = evaluateClassifierScenarios(classifierScenarios());

const pct = (value: number | null) =>
  value === null ? '  —  ' : `${(value * 100).toFixed(0).padStart(3)}%`;

function dimension(report: EvaluationReport, name: DimensionReport['dimension']) {
  const found = report.automatic.find((d) => d.dimension === name);
  assert(found, `missing ${name}`);
  return found;
}

for (const report of reports) {
  console.log(
    `\n${report.scenario}  (${report.classifierVersion} + ${report.ruleVersion}, basis ${report.basis})`,
  );
  console.log('  dimension  eligible  assessed  abstained  coverage  accuracy  FP  FN');
  for (const d of report.automatic) {
    console.log(
      `  ${d.dimension.padEnd(9)} ${String(d.eligible).padStart(8)} ${String(d.assessed).padStart(9)} ${String(d.abstained).padStart(10)} ${pct(d.coverage)} ${pct(d.accuracyOnAssessed)} ${String(d.falsePositives).padStart(4)} ${String(d.falseNegatives).padStart(4)}`,
    );
  }
}

const byName = new Map(reports.map((report) => [report.scenario, report]));

// Safeguard thresholds (roadmap §5.4 safeguards, §5.8 evaluation).
const alternating = dimension(byName.get('alternating-clubs')!, 'club');
assert.equal(alternating.falsePositives, 0, 'alternating clubs raised wrong-club flags');

const switchReport = dimension(byName.get('forgotten-switch')!, 'club');
assert.equal(switchReport.falseNegatives, 0, 'forgotten switch was not detected');
assert.equal(switchReport.falsePositives, 0, 'forgotten switch flagged extra shots');

const sparse = dimension(byName.get('sparse-history')!, 'contact');
assert.equal(sparse.assessed, 0, 'classifier guessed on sparse history');
assert.equal(sparse.falsePositives, 0, 'sparse history produced false positives');

const mishits = dimension(byName.get('mishits')!, 'contact');
assert.equal(mishits.falsePositives, 0, 'normal shots flagged as mishits');
assert.ok(
  (mishits.labels.find((l) => l.label === 'mishit')?.truePositives ?? 0) >= 2,
  'mishits were not detected',
);

const partials = dimension(byName.get('partial-wedges')!, 'intent');
assert.equal(partials.falsePositives, 0, 'full swings labelled partial');
assert.ok(
  (partials.labels.find((l) => l.label === 'partial')?.truePositives ?? 0) >= 6,
  'partial wedges were not detected',
);

const improving = dimension(byName.get('improving-golfer')!, 'contact');
assert.equal(
  improving.labels.find((l) => l.label === 'mishit')?.falsePositives ?? 0,
  0,
  'an improving golfer was flagged as mishits',
);

const override = byName.get('manual-override')!;
const resolvedContact = override.resolved.find((d) => d.dimension === 'contact');
assert(resolvedContact, 'missing resolved contact');
assert.equal(resolvedContact.falsePositives, 0, 'manual review did not win in the resolved view');

console.log('\nAll classifier evaluation thresholds hold.');
