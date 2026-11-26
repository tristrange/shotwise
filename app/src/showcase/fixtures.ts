import {
  initialReview,
  shiftDate,
  localToday,
  type Dataset,
  type Measurements,
  type Session,
  type Shot,
} from '../domain/model';

/**
 * Deterministic synthetic dataset for the dev-only showcase. No real user
 * data, no runtime randomness: a fixed seed drives every "random" value, so
 * screenshots and tests are reproducible. The fixtures are shaped to show
 * every rating state: a well-supported full 4/4 composite (D, 7i), an early
 * small-sample composite (5i), a provisional 3/4 composite with
 * launch-only direction (PW), and no rating at all (9i, <10 shots).
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller from the seeded uniform RNG.
function makeGaussian(rand: () => number) {
  return (mean: number, sd: number) => {
    const u = Math.max(rand(), 1e-9);
    const v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

let idCounter = 0;
/** Deterministic UUID-shaped id (fixtures only need uniqueness + shape). */
function fixtureId(): string {
  idCounter += 1;
  const hex = idCounter.toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${hex.padEnd(12, '0')}`;
}

const ALL_METRIC_KEYS = [
  'carryRange', 'flatCarryRange', 'carryPremium', 'flatCarryPremium',
  'totalRange', 'flatTotalRange', 'totalPremium', 'flatTotalPremium',
  'apexRange', 'apexPremium', 'speedRange', 'speedPremium',
  'launchRange', 'launchPremium', 'launchDirection', 'fromCentre',
  'curve', 'proximity', 'target', 'strokesGained',
] as const;

function measurements(overrides: Partial<Measurements>): Measurements {
  const base = Object.fromEntries(ALL_METRIC_KEYS.map((k) => [k, null])) as Measurements;
  return { ...base, ...overrides };
}

type ClubSpec = {
  club: string;
  /** flatCarryPremium mean / sd in metres */
  carryMean: number;
  carrySd: number;
  sessions: number;
  perSession: number;
  /** shots flagged as likely mishits (short + slow) per session */
  mishitsPerSession?: number;
  /** no finishing-position data — direction falls back to launch-only */
  noLateral?: boolean;
  reference?: number;
};

const CLUB_SPECS: ClubSpec[] = [
  { club: 'D', carryMean: 208, carrySd: 7, sessions: 8, perSession: 12, mishitsPerSession: 1, reference: 232 },
  { club: '7i', carryMean: 149, carrySd: 4.5, sessions: 8, perSession: 12, mishitsPerSession: 2, reference: 160 },
  // 20 shots over 2 visits: every category rates (the first 10 shots per
  // club are unassessed while the classifier baseline builds, so reliability
  // rests on 10) and the weakest evidence level is 'early'.
  { club: '5i', carryMean: 161, carrySd: 5, sessions: 2, perSession: 10, reference: 172 },
  { club: 'PW', carryMean: 106, carrySd: 4, sessions: 8, perSession: 10, noLateral: true, reference: 120 },
  { club: '9i', carryMean: 133, carrySd: 4, sessions: 1, perSession: 6 },
];

export function syntheticDataset(): Dataset {
  const rand = mulberry32(20261126);
  const gauss = makeGaussian(rand);
  const today = localToday();
  const sessions: Session[] = [];
  const shots: Shot[] = [];
  // 8 weekly-ish visits inside the last 50 days so the Recent window sees them.
  const sessionDates = Array.from({ length: 8 }, (_, i) => shiftDate(today, -(49 - i * 7)));
  sessionDates.forEach((date, sIndex) => {
    sessions.push({
      id: fixtureId(),
      date,
      time: `18:${String(10 + sIndex).padStart(2, '0')}`,
      venue: 'Driving range',
      notes: '',
      archived: false,
      filename: `synthetic-${date}.csv`,
      revision: 0,
    });
  });
  const sessionByIndex = new Map(sessions.map((s, i) => [i, s]));

  for (const spec of CLUB_SPECS) {
    for (let s = 0; s < spec.sessions; s++) {
      const session = sessionByIndex.get(s)!;
      for (let k = 0; k < spec.perSession; k++) {
        const mishit = (spec.mishitsPerSession ?? 0) > k;
        // Well below the classifier's 0.65 × carryP75 mishit threshold.
        const carry = mishit
          ? spec.carryMean * 0.62 - rand() * 4
          : gauss(spec.carryMean, spec.carrySd);
        const speed = mishit
          ? carry * 0.85 - 8 - rand() * 3
          : carry * 0.92 + gauss(0, 1.5);
        const launch = gauss(mishit ? 8.5 : 14, 1.1);
        const apex = carry * 0.16 + gauss(0, 1);
        const lateral = spec.noLateral ? null : gauss(0, carry * 0.055);
        shots.push({
          id: fixtureId(),
          sessionId: session.id,
          rowIndex: k + 1,
          sourceNumber: String(k + 1),
          recordedClub: spec.club,
          raw: {},
          review: { ...initialReview },
          revision: 0,
          measurements: measurements({
            flatCarryPremium: carry,
            carryPremium: carry + 3,
            flatCarryRange: carry - 4,
            carryRange: carry - 1,
            flatTotalPremium: carry + 26,
            totalPremium: carry + 29,
            flatTotalRange: carry + 22,
            totalRange: carry + 25,
            speedPremium: speed,
            speedRange: speed - 2,
            launchPremium: launch,
            launchRange: launch - 0.4,
            apexPremium: apex,
            apexRange: apex - 0.8,
            launchDirection: gauss(0, 1.1),
            fromCentre: lateral,
            curve: gauss(0, 3),
            target: null,
            proximity: null,
            strokesGained: null,
          }),
        });
      }
    }
  }

  return {
    version: 0,
    sessions,
    shots,
    imports: [],
    events: [],
    equipment: [],
    equipmentAssignments: [],
    userReferenceValues: CLUB_SPECS.filter((c) => c.reference !== undefined).map((c) => ({
      id: fixtureId(),
      club: c.club,
      metric: 'carry' as const,
      valueM: c.reference!,
      note: 'Fitting target',
      basis: 'premium-flat' as const,
      source: 'fitting' as const,
      referenceType: 'goal' as const,
      statistic: 'p80' as const,
      recordedOn: shiftDate(today, -120),
      equipmentId: null,
      revision: 0,
    })),
  };
}
