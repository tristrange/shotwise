import {
  clubGaps,
  metricStats,
  reviewCoverage,
  selectCohort,
  type AnalysisQuery,
  type ClubGap,
} from './analytics';
import {
  BASES,
  clubOrder,
  isUnknownClub,
  shiftDate,
  type Basis,
  type Dataset,
  type Session,
} from './model';
import { clubProgress } from './progress';
import {
  clubShotGroups,
  recapCohorts,
  sessionRecap,
  type ClubRecap,
} from './recap';

/** Mirrors the recap's carry small-sample guard when choosing the typical cohort. */
const MIN_TYPICAL_SHOTS = 10;
/** Mirrors the recap's lower-tail guard. */
const MIN_TAIL_SHOTS = 20;

export type ProfileWindow = {
  mode: 'recent' | 'all';
  start: string | null;
  end: string;
  sessions: number;
  shots: number;
  firstDate: string | null;
  lastDate: string | null;
};
export type ProfileRecent = {
  typical: {
    cohort: 'reviewed' | 'broader';
    median: number | null;
    n: number;
    missing: number;
  };
  spread: { iqr: number | null; n: number; missing: number };
  lowerTail: { p10: number | null; n: number };
  contact: ReturnType<typeof reviewCoverage>;
};
export type ProfileHistoryPoint = {
  session: Session;
  n: number;
  missing: number;
  median: number | null;
  iqr: number | null;
};
export type ProfileBest = {
  value: number;
  shotId: string;
  session: Session;
  n: number;
  missing: number;
  reviewedShare: number | null;
  mishit: boolean;
};
export type ClubProfile = {
  club: string;
  basis: Basis;
  basisLabel: string;
  window: ProfileWindow;
  recent: ProfileRecent;
  /** The newest session for this club, with the exact recap club entry. */
  latest: { session: Session; recap: ClubRecap } | null;
  /** Per-session trend on the shared Progress cohort, all non-archived sessions. */
  history: ProfileHistoryPoint[];
  gap: ClubGap | null;
  best: ProfileBest | null;
};

function compareSessionsDesc(a: Session, b: Session) {
  return (
    b.date.localeCompare(a.date) ||
    (b.time ?? '').localeCompare(a.time ?? '') ||
    b.id.localeCompare(a.id)
  );
}

/**
 * Read-only club profiles derived from the existing calculations: the recent
 * window uses the shared analysis cohort with the recap's review cohorts, the
 * latest session reuses the session recap verbatim, history reuses Progress,
 * and the gap reuses Gapping. Archived sessions, excluded shots and unknown
 * clubs never contribute; effective (corrected) club labels are used.
 */
export function clubProfiles(
  data: Dataset,
  basis: Basis,
  query: AnalysisQuery,
): ClubProfile[] {
  const key = BASES[basis].carry;
  const sessionMap = new Map(data.sessions.map((s) => [s.id, s]));
  const groups = clubShotGroups(data);

  const clubs = [...new Set([...groups.values()].flatMap((perClub) => [...perClub.keys()]))]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b));

  const historyByClub = new Map(
    clubProgress(data, basis, { ...query, mode: 'all' }).map((row) => [
      row.club,
      row.sessions,
    ]),
  );
  const gapsByClub = new Map(clubGaps(data, basis, query).map((row) => [row.club, row]));
  const recaps = new Map<string, ReturnType<typeof sessionRecap>>();
  const recapFor = (sessionId: string) => {
    let recap = recaps.get(sessionId);
    if (recap === undefined) {
      recap = sessionRecap(data, sessionId, basis);
      recaps.set(sessionId, recap);
    }
    return recap;
  };

  return clubs.map((club) => {
    const selected = selectCohort(data.shots, data.sessions, { ...query, club });
    const windowShots = query.hideLikelyMishits
      ? selectCohort(data.shots, data.sessions, {
          ...query,
          club,
          hideLikelyMishits: false,
        })
      : selected;
    const reliability = windowShots.filter(recapCohorts.reliability);
    const broaderStats = metricStats(
      selected.filter(recapCohorts.broader),
      key,
    );
    const reviewedStats = metricStats(
      selected.filter(recapCohorts.reviewed),
      key,
    );
    const reliabilityStats = metricStats(reliability, key);
    const typical =
      reviewedStats.n >= MIN_TYPICAL_SHOTS
        ? {
            cohort: 'reviewed' as const,
            median: reviewedStats.median,
            n: reviewedStats.n,
            missing: reviewedStats.missing,
          }
        : {
            cohort: 'broader' as const,
            median: broaderStats.median,
            n: broaderStats.n,
            missing: broaderStats.missing,
          };
    const dates = windowShots
      .map((shot) => sessionMap.get(shot.sessionId)?.date)
      .filter((date): date is string => Boolean(date))
      .sort();

    const sessionsWithClub = [...groups.entries()]
      .filter(([, perClub]) => perClub.has(club))
      .map(([sessionId]) => sessionMap.get(sessionId))
      .filter((session): session is Session => Boolean(session))
      .sort(compareSessionsDesc);

    let latest: ClubProfile['latest'] = null;
    const latestSession = sessionsWithClub[0];
    if (latestSession) {
      const recap = recapFor(latestSession.id)?.clubs.find(
        (item) => item.club === club,
      );
      if (recap) latest = { session: latestSession, recap };
    }

    let best: ProfileBest | null = null;
    for (const session of [...sessionsWithClub].reverse()) {
      const shots = groups.get(session.id)?.get(club) ?? [];
      const stats = metricStats(shots, key);
      const coverage = reviewCoverage(shots.filter(recapCohorts.reliability));
      const full = coverage.fullReviewed + coverage.unassessed;
      for (const shot of shots) {
        if (shot.review.intent === 'partial') continue;
        const value = shot.measurements[key];
        if (value === null || (best !== null && value <= best.value)) continue;
        best = {
          value,
          shotId: shot.id,
          session,
          n: stats.n,
          missing: stats.missing,
          reviewedShare: full ? coverage.fullReviewed / full : null,
          mishit: shot.review.contact === 'mishit',
        };
      }
    }

    return {
      club,
      basis,
      basisLabel: BASES[basis].label,
      window: {
        mode: query.mode,
        start: query.mode === 'recent' ? shiftDate(query.today, -59) : null,
        end: query.today,
        sessions: new Set(windowShots.map((shot) => shot.sessionId)).size,
        shots: windowShots.length,
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
      },
      recent: {
        typical,
        spread: {
          iqr: reliabilityStats.iqr,
          n: reliabilityStats.n,
          missing: reliabilityStats.missing,
        },
        lowerTail: {
          p10:
            reliabilityStats.n >= MIN_TAIL_SHOTS ? reliabilityStats.p10 : null,
          n: reliabilityStats.n,
        },
        contact: reviewCoverage(reliability),
      },
      latest,
      history: (historyByClub.get(club) ?? []).map((point) => ({
        session: point.session,
        n: point.n,
        missing: point.missing,
        median: point.median,
        iqr: point.iqr,
      })),
      gap: gapsByClub.get(club) ?? null,
      best,
    };
  });
}
