import { describe, expect, it } from 'vitest';
import { classifierScenarios } from './evaluationScenarios';
import {
  evaluateClassifierScenarios,
  evaluateScenario,
  type DimensionReport,
  type EvaluationReport,
} from './evaluation';

const reports = evaluateClassifierScenarios(classifierScenarios());
const byName = new Map(reports.map((report) => [report.scenario, report]));

function dimension(report: EvaluationReport, name: DimensionReport['dimension'], layer: 'automatic' | 'resolved') {
  const found = report[layer].find((d) => d.dimension === name);
  if (!found) throw new Error(`Missing ${layer} ${name} in ${report.scenario}`);
  return found;
}

describe('classifier evaluation methodology (roadmap §5.8)', () => {
  it('covers the representative safeguard scenarios', () => {
    expect(reports.map((r) => r.scenario)).toEqual([
      'mishits',
      'partial-wedges',
      'unknown-labels',
      'forgotten-switch',
      'alternating-clubs',
      'sparse-history',
      'improving-golfer',
      'manual-override',
    ]);
    for (const report of reports) {
      expect(report.classifierVersion).toBe('intent-contact-1');
      expect(report.ruleVersion).toBe('sequence-1');
      for (const layer of ['automatic', 'resolved'] as const) {
        for (const d of report[layer]) {
          expect(d.eligible).toBeGreaterThan(0);
          expect(d.assessed + d.abstained).toBe(d.eligible);
        }
      }
    }
  });

  it('detects mishits without false positives on normal shots', () => {
    const report = byName.get('mishits')!;
    const contact = dimension(report, 'contact', 'automatic');
    // Only shots with >= 10 earlier same-club shots are assessed: the whole
    // late session plus the last two history rows.
    expect(contact.assessed).toBe(6);
    expect(contact.abstained).toBe(10);
    expect(contact.falsePositives).toBe(0);
    expect(contact.falseNegatives).toBe(0);
    expect(contact.accuracyOnAssessed).toBe(1);
    const mishit = contact.labels.find((l) => l.label === 'mishit');
    expect(mishit).toMatchObject({ truePositives: 2, falsePositives: 0, falseNegatives: 0 });
  });

  it('classifies partial wedges as partial and typically struck', () => {
    const report = byName.get('partial-wedges')!;
    const intent = dimension(report, 'intent', 'automatic');
    expect(intent.falsePositives).toBe(0);
    expect(intent.falseNegatives).toBe(0);
    const partial = intent.labels.find((l) => l.label === 'partial');
    expect(partial?.truePositives).toBe(6);
    const contact = dimension(report, 'contact', 'automatic');
    // No partial is ever predicted or labelled a mishit.
    expect(contact.labels.find((l) => l.label === 'mishit')?.falsePositives ?? 0).toBe(0);
  });

  it('infers unknown labels from the surrounding run', () => {
    const report = byName.get('unknown-labels')!;
    const club = dimension(report, 'club', 'automatic');
    expect(club.falsePositives).toBe(0);
    expect(club.falseNegatives).toBe(0);
    const inferred = club.labels.find((l) => l.label === '7i');
    expect(inferred?.truePositives).toBe(25); // 12 history + 10 labelled late + 3 unknown
  });

  it('flags a forgotten club switch and keeps the recorded label out of the truth score', () => {
    const report = byName.get('forgotten-switch')!;
    const club = dimension(report, 'club', 'automatic');
    expect(club.falsePositives).toBe(0);
    expect(club.falseNegatives).toBe(0);
    expect(club.labels.find((l) => l.label === '8i')?.truePositives).toBe(22); // 12 history + 10 switched
  });

  it('raises no wrong-club flags when clubs intentionally alternate', () => {
    const report = byName.get('alternating-clubs')!;
    const club = dimension(report, 'club', 'automatic');
    expect(club.falsePositives).toBe(0);
    expect(club.falseNegatives).toBe(0);
    expect(club.accuracyOnAssessed).toBe(1);
  });

  it('abstains conservatively on sparse history instead of guessing', () => {
    const report = byName.get('sparse-history')!;
    const contact = dimension(report, 'contact', 'automatic');
    expect(contact.assessed).toBe(0);
    expect(contact.coverage).toBe(0);
    expect(contact.abstained).toBe(contact.eligible);
    expect(contact.falsePositives).toBe(0);
  });

  it('does not mistake an improving golfer for mishits inside the recent window', () => {
    const report = byName.get('improving-golfer')!;
    const contact = dimension(report, 'contact', 'automatic');
    expect(contact.labels.find((l) => l.label === 'mishit')?.falsePositives ?? 0).toBe(0);
    // Every session's last rows plus the whole current session are assessed
    // (12 current + 2 mid + 2 old with >= 10 earlier same-session shots); the
    // rest abstain. The old session's baseline window excludes nothing here,
    // but the key check is above: no current shot is flagged a mishit.
    expect(contact.assessed).toBe(16);
    expect(contact.abstained).toBe(20);
  });

  it('lets a manual review override an automatic mishit in the resolved view', () => {
    const report = byName.get('manual-override')!;
    const automaticContact = dimension(report, 'contact', 'automatic');
    // The raw classifier does flag the punch-like shot: this is exactly why
    // manual review must stay authoritative.
    expect(automaticContact.falsePositives).toBe(1);
    const resolvedContact = dimension(report, 'contact', 'resolved');
    expect(resolvedContact.falsePositives).toBe(0);
    expect(resolvedContact.falseNegatives).toBe(0);
    expect(resolvedContact.accuracyOnAssessed).toBe(1);
  });

  it('is deterministic under input order reversal', () => {
    for (const scenario of classifierScenarios()) {
      const reversed = {
        ...scenario,
        shots: [...scenario.shots].reverse(),
        sessions: [...scenario.sessions].reverse(),
      };
      expect(evaluateScenario(reversed)).toEqual(evaluateScenario(scenario));
    }
  });
});
