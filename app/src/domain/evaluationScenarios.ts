import { makeSession, makeShot } from './fixtures';
import type { ClassifierScenario, GroundTruth } from './evaluation';
import type { Review, Session, Shot } from './model';

/**
 * Representative labelled scenarios for the classifier evaluation methodology
 * (roadmap §5.8): mishits, partial wedges, unknown labels, forgotten club
 * switches, alternating clubs, sparse history, an improving golfer and
 * manual overrides. Every scenario carries explicit ground truth, so the
 * evaluation never scores only the shots the algorithm happened to flag.
 */

const TODAY = '2026-11-16';

type Spec = {
  id: string;
  club?: string;
  carry?: number | null;
  speed?: number | null;
  review?: Partial<Review>;
};

function run(session: Session, startRow: number, specs: Spec[]): Shot[] {
  return specs.map((spec, i) =>
    makeShot({
      id: spec.id,
      sessionId: session.id,
      rowIndex: startRow + i,
      recordedClub: spec.club ?? '7i',
      measurements: {
        flatCarryPremium: spec.carry ?? 150,
        speedPremium: spec.speed ?? 200,
      },
      review: spec.review,
    }),
  );
}

const repeat = (n: number, value: number) => Array.from({ length: n }, () => value);

function history(session: Session, club: string, carry: number, speed: number, n = 12): Shot[] {
  return run(
    session,
    1,
    repeat(n, carry).map((c, i) => ({
      id: `${session.id}-${club}-${i}`,
      club,
      carry: c,
      speed,
    })),
  );
}

function truthFor(shots: Shot[], truth: GroundTruth): Map<string, GroundTruth> {
  return new Map(shots.map((shot) => [shot.id, truth]));
}

export function classifierScenarios(): ClassifierScenario[] {
  const scenarios: ClassifierScenario[] = [];

  // 1. Mishits: two clearly weak strikes among normal 7i shots.
  {
    const early = makeSession({ id: 'mis-early', date: '2026-11-01' });
    const late = makeSession({ id: 'mis-late', date: TODAY });
    const shots = [
      ...history(early, '7i', 150, 200),
      ...run(late, 1, [
        { id: 'mis-ok-1', carry: 150, speed: 200 },
        { id: 'mis-ok-2', carry: 152, speed: 202 },
        { id: 'mis-bad-1', carry: 50, speed: 80 },
        { id: 'mis-bad-2', carry: 55, speed: 85 },
      ]),
    ];
    const truth = new Map<string, GroundTruth>();
    for (const shot of shots) truth.set(shot.id, { intent: 'full', contact: 'typical', club: '7i' });
    truth.set('mis-bad-1', { intent: 'full', contact: 'mishit', club: '7i' });
    truth.set('mis-bad-2', { intent: 'full', contact: 'mishit', club: '7i' });
    scenarios.push({
      name: 'mishits',
      description: 'Weak carry+speed among normal iron shots are labelled mishits.',
      sessions: [early, late],
      shots,
      truth,
    });
  }

  // 2. Partial wedges: deliberate distance control below the full median.
  {
    const early = makeSession({ id: 'pw-early', date: '2026-11-01' });
    const late = makeSession({ id: 'pw-late', date: TODAY });
    const shots = [
      ...history(early, 'SW', 100, 160),
      ...run(late, 1, [
        ...repeat(6, 100).map((c, i) => ({ id: `pw-full-${i}`, club: 'SW', carry: c, speed: 160 })),
        ...repeat(6, 60).map((c, i) => ({ id: `pw-part-${i}`, club: 'SW', carry: c, speed: 160 })),
      ]),
    ];
    const truth = new Map<string, GroundTruth>();
    for (const shot of shots) truth.set(shot.id, { intent: 'full', contact: 'typical', club: 'SW' });
    for (let i = 0; i < 6; i++) truth.set(`pw-part-${i}`, { intent: 'partial', contact: 'typical', club: 'SW' });
    scenarios.push({
      name: 'partial-wedges',
      description: 'Low-carry wedges are partials, still typically struck.',
      sessions: [early, late],
      shots,
      truth,
    });
  }

  // 3. Unknown labels inside a same-club run.
  {
    const early = makeSession({ id: 'unk-early', date: '2026-11-01' });
    const late = makeSession({ id: 'unk-late', date: TODAY });
    const labelled = (prefix: string, n: number) =>
      repeat(n, 150).map((c, i) => ({ id: `${prefix}-${i}`, carry: c, speed: 200 }));
    const unknown = repeat(3, 150).map((c, i) => ({
      id: `unk-mid-${i}`,
      club: '?',
      carry: c,
      speed: 200,
    }));
    const shots = [
      ...history(early, '7i', 150, 200),
      ...run(late, 1, [...labelled('unk-a', 5), ...unknown, ...labelled('unk-b', 5)]),
    ];
    const truth = truthFor(shots, { club: '7i', intent: 'full', contact: 'typical' });
    scenarios.push({
      name: 'unknown-labels',
      description: 'Unknown labels in a 7i run are inferred as 7i.',
      sessions: [early, late],
      shots,
      truth,
    });
  }

  // 4. Forgotten club switch: a long 9i-labelled run that measures like 8i.
  {
    const early = makeSession({ id: 'sw-early', date: '2026-11-01' });
    const late = makeSession({ id: 'sw-late', date: TODAY });
    const shots = [
      ...history(early, '8i', 140, 190),
      ...history(early, '9i', 120, 170),
      ...run(
        late,
        1,
        repeat(10, 140).map((c, i) => ({ id: `sw-${i}`, club: '9i', carry: c, speed: 190 })),
      ),
    ];
    const truth = new Map<string, GroundTruth>();
    for (const shot of shots)
      truth.set(shot.id, { club: shot.recordedClub, intent: 'full', contact: 'typical' });
    for (let i = 0; i < 10; i++) truth.set(`sw-${i}`, { club: '8i', intent: 'full', contact: 'typical' });
    scenarios.push({
      name: 'forgotten-switch',
      description: 'A 10-shot 9i-labelled block matching 8i is flagged as a suspected wrong club.',
      sessions: [early, late],
      shots,
      truth,
    });
  }

  // 5. Alternating clubs: intentional alternation must not raise wrong-club flags.
  {
    const early = makeSession({ id: 'alt-early', date: '2026-11-01' });
    const late = makeSession({ id: 'alt-late', date: TODAY });
    const alternating = Array.from({ length: 20 }, (_, i) => ({
      id: `alt-${i}`,
      club: i % 2 ? '8i' : '7i',
      carry: i % 2 ? 140 : 150,
      speed: i % 2 ? 190 : 200,
    }));
    const shots = [
      ...history(early, '7i', 150, 200, 6),
      ...history(early, '8i', 140, 190, 6),
      ...run(late, 1, alternating),
    ];
    const truth = truthFor(shots, { intent: 'full', contact: 'typical' });
    for (const shot of shots) truth.set(shot.id, { club: shot.recordedClub, intent: 'full', contact: 'typical' });
    scenarios.push({
      name: 'alternating-clubs',
      description: 'Alternating 7i/8i shots keep their labels with zero wrong-club flags.',
      sessions: [early, late],
      shots,
      truth,
    });
  }

  // 6. Sparse history: a new golfer's first few shots abstain conservatively.
  {
    const only = makeSession({ id: 'new', date: TODAY });
    const shots = [
      ...run(only, 1, [
        { id: 'new-7i-0', club: '7i', carry: 150, speed: 200 },
        { id: 'new-7i-1', club: '7i', carry: 151, speed: 201 },
        { id: 'new-7i-2', club: '7i', carry: 149, speed: 199 },
        { id: 'new-8i-0', club: '8i', carry: 140, speed: 190 },
        { id: 'new-8i-1', club: '8i', carry: 141, speed: 191 },
        { id: 'new-8i-2', club: '8i', carry: 139, speed: 189 },
      ]),
    ];
    const truth = truthFor(shots, { intent: 'full', contact: 'typical' });
    for (const shot of shots) truth.set(shot.id, { club: shot.recordedClub, intent: 'full', contact: 'typical' });
    scenarios.push({
      name: 'sparse-history',
      description: 'Fewer than 10 earlier shots per club: the classifier abstains.',
      sessions: [only],
      shots,
      truth,
    });
  }

  // 7. Improving golfer: recent gains within the 60-day window are not mishits.
  {
    const old = makeSession({ id: 'imp-old', date: '2026-08-01' });
    const mid = makeSession({ id: 'imp-mid', date: '2026-10-07' });
    const current = makeSession({ id: 'imp-now', date: TODAY });
    const shots = [
      ...history(old, 'D', 140, 180),
      ...history(mid, 'D', 160, 190),
      ...history(current, 'D', 180, 200),
    ];
    const truth = truthFor(shots, { intent: 'full', contact: 'typical', club: 'D' });
    scenarios.push({
      name: 'improving-golfer',
      description: 'A 40 m carry gain over old history is typical, not a mishit, inside the recent window.',
      sessions: [old, mid, current],
      shots,
      truth,
    });
  }

  // 8. Manual override: a reviewed typical strike that looks like a mishit.
  {
    const early = makeSession({ id: 'ov-early', date: '2026-11-01' });
    const late = makeSession({ id: 'ov-late', date: TODAY });
    const shots = [
      ...history(early, '7i', 150, 200),
      ...run(late, 1, [
        { id: 'ov-shot', carry: 50, speed: 80, review: { intent: 'full', contact: 'typical' } },
      ]),
    ];
    // Ground truth follows the human: a deliberate punch, well struck.
    const truth = truthFor(shots, { intent: 'full', contact: 'typical', club: '7i' });
    scenarios.push({
      name: 'manual-override',
      description: 'The automatic layer may flag it, but the manual review wins in the resolved view.',
      sessions: [early, late],
      shots,
      truth,
    });
  }

  return scenarios;
}
