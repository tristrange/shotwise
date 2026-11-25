import { resolveShots, resolvedClub } from './assessment';
import { assessShots, CLASSIFIER_VERSION, type ContactValue, type IntentValue } from './classify';
import { effectiveClub, isUnknownClub, type Basis, type Session, type Shot } from './model';
import { assessSequences, SEQUENCE_RULE_VERSION } from './sequence';

/**
 * Classifier evaluation methodology (roadmap §5.8). Assesses the automatic
 * layers (`intent-contact-2`, `sequence-2`) against representative labelled
 * scenarios — not only shots the algorithm flagged, to avoid selection bias —
 * and reports false positives, false negatives, abstentions and coverage per
 * dimension. Ground truth is supplied explicitly per scenario; manual reviews
 * in the fixtures double as truth where present.
 */

/** Expected classification of a shot, for the dimensions under test. */
export type GroundTruth = {
  intent?: IntentValue;
  contact?: ContactValue;
  club?: string;
};

/**
 * The evaluation task a scenario exercises. Missing-label, wrong-label and
 * alternative-club inference are scored as separate tasks so a strong overall
 * number cannot hide a weak one.
 */
export type EvaluationTask = 'intent-contact' | 'missing-label' | 'wrong-label';

export type ClassifierScenario = {
  name: string;
  description: string;
  task?: EvaluationTask;
  sessions: Session[];
  shots: Shot[];
  truth: Map<string, GroundTruth>;
  basis?: Basis;
};

export type LabelMetrics = {
  label: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
};

export type DimensionReport = {
  dimension: 'intent' | 'contact' | 'club';
  /** Shots with ground truth for this dimension. */
  eligible: number;
  /** Shots the automatic layer classified (non-abstaining). */
  assessed: number;
  abstained: number;
  /** Assessed share of eligible shots; null when nothing is eligible. */
  coverage: number | null;
  /** Correct classifications over assessed shots; null when nothing was assessed. */
  accuracyOnAssessed: number | null;
  /**
   * End-to-end recall over all eligible shots: abstained shots with a truth
   * label count as misses, so this can never exceed accuracyOnAssessed.
   */
  recallEndToEnd: number | null;
  /** Abstentions broken down by the shot's truth label. */
  abstainedByTruth: { label: string; count: number }[];
  falsePositives: number;
  falseNegatives: number;
  labels: LabelMetrics[];
};

export type EvaluationReport = {
  scenario: string;
  task: EvaluationTask;
  basis: Basis;
  classifierVersion: typeof CLASSIFIER_VERSION;
  ruleVersion: typeof SEQUENCE_RULE_VERSION;
  /** The raw automatic layers, scored directly so manual review cannot inflate them. */
  automatic: DimensionReport[];
  /** The resolved view analytics actually consume (manual > automatic > recorded). */
  resolved: DimensionReport[];
};

type Prediction = { value: string; abstained: boolean };

function labelMetrics(
  pairs: { predicted: string; truth: string }[],
): LabelMetrics[] {
  const labels = [...new Set([...pairs.map((p) => p.predicted), ...pairs.map((p) => p.truth)])];
  return labels
    .map((label) => ({
      label,
      truePositives: pairs.filter((p) => p.predicted === label && p.truth === label).length,
      falsePositives: pairs.filter((p) => p.predicted === label && p.truth !== label).length,
      falseNegatives: pairs.filter((p) => p.truth === label && p.predicted !== label).length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function dimensionReport(
  dimension: DimensionReport['dimension'],
  predictions: Prediction[],
  truth: (string | undefined)[],
): DimensionReport {
  const eligiblePairs: { predicted: string; truth: string }[] = [];
  const abstainedCounts = new Map<string, number>();
  let eligible = 0;
  let assessed = 0;
  let abstained = 0;
  predictions.forEach((prediction, i) => {
    const expected = truth[i];
    if (expected === undefined) return;
    eligible++;
    if (prediction.abstained) {
      // Abstentions are tracked separately from false negatives, and by truth
      // class so a dimension cannot hide misses behind its abstentions.
      abstained++;
      abstainedCounts.set(expected, (abstainedCounts.get(expected) ?? 0) + 1);
      return;
    }
    assessed++;
    eligiblePairs.push({ predicted: prediction.value, truth: expected });
  });
  const labels = labelMetrics(eligiblePairs);
  const falsePositives = labels.reduce((sum, l) => sum + l.falsePositives, 0);
  const falseNegatives = labels.reduce((sum, l) => sum + l.falseNegatives, 0);
  const truePositives = labels.reduce((sum, l) => sum + l.truePositives, 0);
  return {
    dimension,
    eligible,
    assessed,
    abstained,
    coverage: eligible ? assessed / eligible : null,
    accuracyOnAssessed: assessed ? truePositives / assessed : null,
    recallEndToEnd: eligible ? truePositives / eligible : null,
    abstainedByTruth: [...abstainedCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    falsePositives,
    falseNegatives,
    labels,
  };
}

function scoreDimensions(
  shots: Shot[],
  truth: Map<string, GroundTruth>,
  predict: (shot: Shot) => {
    intent: Prediction;
    contact: Prediction;
    club: Prediction;
  },
): DimensionReport[] {
  const intentPredictions: Prediction[] = [];
  const contactPredictions: Prediction[] = [];
  const clubPredictions: Prediction[] = [];
  const intentTruth: (string | undefined)[] = [];
  const contactTruth: (string | undefined)[] = [];
  const clubTruth: (string | undefined)[] = [];
  for (const shot of shots) {
    const expected = truth.get(shot.id) ?? {};
    const prediction = predict(shot);
    intentPredictions.push(prediction.intent);
    contactPredictions.push(prediction.contact);
    clubPredictions.push(prediction.club);
    intentTruth.push(expected.intent);
    contactTruth.push(expected.contact);
    clubTruth.push(expected.club);
  }
  return [
    dimensionReport('intent', intentPredictions, intentTruth),
    dimensionReport('contact', contactPredictions, contactTruth),
    dimensionReport('club', clubPredictions, clubTruth),
  ];
}

/**
 * Run the automatic layers over a labelled scenario and score every dimension
 * against the supplied truth — both the raw automatic layer (so manual review
 * cannot inflate the score) and the resolved view analytics consume.
 */
export function evaluateScenario(scenario: ClassifierScenario): EvaluationReport {
  const { shots, sessions } = scenario;
  const basis = scenario.basis ?? 'premium-flat';
  const automatic = assessShots(shots, sessions, basis);
  const sequences = assessSequences(shots, sessions, basis);
  const resolved = resolveShots(shots, sessions, basis);

  const automaticDimensions = scoreDimensions(shots, scenario.truth, (shot) => {
    const auto = automatic.get(shot.id);
    const sequence = sequences.get(shot.id);
    const clubClaim =
      sequence?.kind === 'suspected-wrong-club'
        ? sequence.suspectedClub
        : sequence?.kind === 'inferred-club'
          ? sequence.club
          : effectiveClub(shot);
    return {
      intent: {
        value: auto?.intent.value ?? 'unknown',
        abstained: (auto?.intent.value ?? 'unknown') === 'unknown',
      },
      contact: {
        value: auto?.contact.value ?? 'uncertain',
        abstained: (auto?.contact.value ?? 'uncertain') === 'uncertain',
      },
      club: { value: clubClaim, abstained: isUnknownClub(clubClaim) },
    };
  });

  const resolvedDimensions = scoreDimensions(shots, scenario.truth, (shot) => {
    const r = resolved.get(shot.id);
    const club = r ? resolvedClub(r) : effectiveClub(shot);
    return {
      intent: { value: r?.intent ?? 'unknown', abstained: (r?.intent ?? 'unknown') === 'unknown' },
      contact: { value: r?.contact ?? 'uncertain', abstained: (r?.contact ?? 'uncertain') === 'uncertain' },
      club: { value: club, abstained: isUnknownClub(club) },
    };
  });

  return {
    scenario: scenario.name,
    task: scenario.task ?? 'intent-contact',
    basis,
    classifierVersion: CLASSIFIER_VERSION,
    ruleVersion: SEQUENCE_RULE_VERSION,
    automatic: automaticDimensions,
    resolved: resolvedDimensions,
  };
}

/** Evaluate every scenario and collect the reports. */
export function evaluateClassifierScenarios(
  scenarios: ClassifierScenario[],
): EvaluationReport[] {
  return scenarios.map(evaluateScenario);
}
