import { makeSession, makeShot } from '../src/domain/fixtures';
import { resolveShots } from '../src/domain/assessment';
import { clubRatings } from '../src/domain/ratings';
import type { Dataset, Session, Shot } from '../src/domain/model';

/**
 * Performance smoke check (roadmap §13, item A11): resolves synthetic histories
 * of increasing size and prints cold (first call) and warm (cached) timings,
 * plus the ADR-0005 ratings pass (ratings-2) over the same synthetic dataset.
 * Synthetic data only — no personal exports. The resolve cache is per shots
 * array, so each size gets a fresh dataset for the cold measurement.
 *
 * Usage: npm run verify:performance
 */

const CLUBS = ['D', '3w', '5w', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW'];

function dataset(totalShots: number): { sessions: Session[]; shots: Shot[] } {
  const sessionCount = Math.max(1, Math.round(totalShots / 30));
  const sessions = Array.from({ length: sessionCount }, (_, v) =>
    makeSession({
      id: `perf-${v}`,
      date: `2026-${String(1 + (v % 12)).padStart(2, '0')}-${String(1 + (v % 27)).padStart(2, '0')}`,
      time: `${String(8 + (v % 10)).padStart(2, '0')}:00`,
    }),
  );
  const shots: Shot[] = [];
  for (let i = 0; i < totalShots; i++) {
    const session = sessions[i % sessions.length]!;
    shots.push(
      makeShot({
        sessionId: session.id,
        recordedClub: CLUBS[i % CLUBS.length]!,
        rowIndex: Math.floor(i / sessions.length) + 1,
        measurements: {
          flatCarryRange: 70 + ((i * 7) % 120),
          speedRange: 110 + (i % 60),
          launchRange: 10 + (i % 8),
          apexRange: 20 + (i % 15),
          flatTotalRange: 90 + ((i * 7) % 140),
        },
      }),
    );
  }
  return { sessions, shots };
}

const TODAY = '2026-11-25';

for (const size of [500, 3000, 6000, 12000]) {
  const { sessions, shots } = dataset(size);
  const coldStart = performance.now();
  const resolved = resolveShots(shots, sessions, 'premium-flat');
  const coldMs = performance.now() - coldStart;
  const warmStart = performance.now();
  resolveShots(shots, sessions, 'range-flat'); // different display basis: cached
  const warmMs = performance.now() - warmStart;
  const data: Dataset = {
    version: 1,
    sessions,
    shots,
    imports: [],
    events: [],
    equipment: [],
    equipmentAssignments: [],
    userReferenceValues: [],
  };
  const ratingStart = performance.now();
  const ratings = clubRatings(data, {
    mode: 'recent',
    today: TODAY,
    intent: 'all',
    contact: 'all',
  });
  const ratingMs = performance.now() - ratingStart;
  console.log(
    `${String(size).padStart(6)} shots  cold ${coldMs.toFixed(1).padStart(8)} ms  warm ${warmMs.toFixed(2).padStart(7)} ms  resolved ${resolved.size}` +
      `  ratings ${ratingMs.toFixed(1).padStart(8)} ms  clubs ${ratings.length}`,
  );
}
