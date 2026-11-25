import { z } from 'zod';
import {
  isUnknownClub,
  referenceMetricSchema,
  userReferenceValueSchema,
  type Basis,
  type ReferenceBasis,
  type UserReferenceValueRecord,
} from './model';

/**
 * Source-aware external benchmark data model (roadmap §7, Phase 5 PR 16;
 * research in docs/external-benchmark-sources.md).
 *
 * Licensing finding: no researched source permits embedding its dataset in
 * the app, so every registry entry is `link-only` — the app links out with
 * full attribution and never stores third-party numbers. An entry may only
 * become `embedded-with-license` with a written license reference in
 * `licenseEvidence`. Comparisons are carry-to-carry and total-to-total only;
 * on-course totals are never overlaid on Inrange range carry (§7.4).
 */
export const BENCHMARK_MODEL_VERSION = 'benchmark-1';

export type BenchmarkLicense = 'link-only' | 'embedded-with-license';
export type BenchmarkMetric = 'carry' | 'total';
export type BenchmarkVenue = 'range' | 'course' | 'mixed';
export type BenchmarkAudience = 'amateur' | 'professional';

export type BenchmarkSource = {
  id: string;
  name: string;
  publisher: string;
  /** Primary URL of the source or its publication. */
  url: string;
  /** ISO publication date of the data, when stated. */
  publicationDate: string | null;
  license: BenchmarkLicense;
  /** Required when license is 'embedded-with-license': the written license reference. */
  licenseEvidence?: string;
  metric: BenchmarkMetric;
  venue: BenchmarkVenue;
  audience: BenchmarkAudience;
  population: string;
  /** Normalized club keys this source covers, e.g. ['driver']. */
  clubs: string[];
  /** Human-readable sample size where published. */
  sampleSize?: string;
  /** ISO date the URL was last verified. */
  retrievedAt: string;
};

/** What the UI links out to for one club. */
export type BenchmarkReference = {
  sourceId: string;
  club: string;
  label: string;
  url: string;
  /** Metric/venue caveat shown with the link, e.g. "on-course total, not range carry". */
  caveat: string;
  audience: BenchmarkAudience;
};

/**
 * A user-entered reference value (e.g. from a fitting session). Always kept
 * separate from imported measurements and labelled as user-entered — never
 * mixed into analytics cohorts. The persisted record adds id and revision.
 */
export type UserReferenceValue = Omit<
  z.input<typeof userReferenceValueSchema>,
  'id' | 'revision' | 'note'
> & {
  note?: string | null;
};

/**
 * Link-only benchmark registry. Entries cite primary URLs; see
 * docs/external-benchmark-sources.md for the full licensing research.
 */
export const BENCHMARK_SOURCES: readonly BenchmarkSource[] = [
  {
    id: 'arccos-ddr-2026',
    name: 'Arccos Annual Driving Distance Report, 2026 edition',
    publisher: 'Arccos Golf',
    url: 'https://www.arccosgolf.com/blogs/community/arccos-golf-releases-largest-ever-annual-driving-distance-report-leveraging-data-from-25-million-rounds-to-deliver-eight-year-trend-analysis-across-age-gender-and-skill-level',
    publicationDate: '2026-05-06',
    license: 'link-only',
    metric: 'total',
    venue: 'course',
    audience: 'amateur',
    population: 'Arccos members (amateur), 160+ countries',
    clubs: ['driver'],
    sampleSize: '~10M driver tee shots across >5M rounds (2025)',
    retrievedAt: '2026-11-25',
  },
  {
    id: 'trackman-tour-averages',
    name: 'TrackMan Tour Averages (PGA TOUR / LPGA)',
    publisher: 'TrackMan',
    url: 'https://www.trackman.com/golf-tour-averages',
    publicationDate: null,
    license: 'link-only',
    metric: 'carry',
    venue: 'mixed',
    audience: 'professional',
    population: 'PGA TOUR and LPGA Tour players',
    clubs: ['driver', '3-wood', '5-wood', 'hybrid', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'pw'],
    sampleSize: '200+ male and 150+ female Tour players',
    retrievedAt: '2026-11-25',
  },
  {
    id: 'pgatour-stats-driving',
    name: 'PGA TOUR Stats — driving distance (stat 101)',
    publisher: 'PGA TOUR',
    url: 'https://www.pgatour.com/stats/stat.101.html',
    publicationDate: null,
    license: 'link-only',
    metric: 'total',
    venue: 'course',
    audience: 'professional',
    population: 'PGA TOUR players (competition rounds)',
    clubs: ['driver'],
    retrievedAt: '2026-11-25',
  },
  {
    id: 'usga-r22-01-launch-conditions',
    name: 'USGA/R&A research R22-01 — launch conditions by skill level',
    publisher: 'USGA / R&A',
    url: 'https://www.usga.org/equipment-standards/distance-insights.html',
    publicationDate: '2022',
    license: 'link-only',
    metric: 'carry',
    venue: 'range',
    audience: 'amateur',
    population: 'Amateur golfers grouped by skill level (launch-monitor study)',
    clubs: ['driver'],
    sampleSize: 'Small lab sample — see publication',
    retrievedAt: '2026-11-25',
  },
];

/**
 * Normalize a recorded club label to a registry key: 'D'/'DR'/'1w' ->
 * 'driver', '3w' -> '3-wood', '4h'/'hybrid' -> 'hybrid', '7i' -> '7i'.
 */
export function normalizeBenchmarkClub(club: string): string {
  const value = club.trim().toLowerCase();
  if (['d', 'dr', 'driver', '1w'].includes(value)) return 'driver';
  const wood = value.match(/^(\d+)w$/);
  if (wood) return `${wood[1]}-wood`;
  if (/^(hybrid|hy)$/.test(value)) return 'hybrid';
  const hybrid = value.match(/^(\d+)h$/);
  if (hybrid) return 'hybrid';
  const iron = value.match(/^(\d+)i$/);
  if (iron) return `${iron[1]}i`;
  if (value === 'pw') return 'pw';
  return value;
}

const METRIC_LABEL: Record<BenchmarkMetric, string> = {
  carry: 'carry distance',
  total: 'total distance (carry + rollout)',
};
const VENUE_LABEL: Record<BenchmarkVenue, string> = {
  range: 'range',
  course: 'on-course',
  mixed: 'mixed venues',
};

/** Attribution string shown next to any benchmark link. */
export function attributionFor(source: BenchmarkSource): string {
  const date = source.publicationDate ? ` (${source.publicationDate})` : '';
  return `Reference: ${source.name}${date} — ${source.publisher}. ${METRIC_LABEL[source.metric]}, ${VENUE_LABEL[source.venue]}, ${source.population}. Linked source; data not embedded (${source.license === 'link-only' ? 'link-only license' : 'licensed'}).`;
}

/**
 * Range-ball bases measure the limited-flight range ball itself; no external
 * source measures range balls, so range-ball measurements never get a
 * benchmark overlay (docs/external-benchmark-sources.md §7.4).
 */
export function isRangeBallBasis(basis: Basis): boolean {
  return basis === 'range' || basis === 'range-flat';
}

/**
 * Link-out references for a recorded club label. Only link-only sources are
 * returned; professional-audience entries are flagged so the UI can show the
 * "professional reference — not an amateur target" badge. Pass the active
 * measurement basis: range-ball bases return no references at all.
 */
export function benchmarkReferencesForClub(
  club: string,
  basis?: Basis,
): BenchmarkReference[] {
  if (isUnknownClub(club)) return [];
  if (basis && isRangeBallBasis(basis)) return [];
  const key = normalizeBenchmarkClub(club);
  return BENCHMARK_SOURCES.filter(
    (source) => source.license === 'link-only' && source.clubs.includes(key),
  ).map((source) => ({
    sourceId: source.id,
    club: key,
    label: source.name,
    url: source.url,
    caveat: `${METRIC_LABEL[source.metric]}, ${VENUE_LABEL[source.venue]} — not directly comparable to every Inrange basis`,
    audience: source.audience,
  }));
}

/**
 * Basis compatibility for personal-reference comparisons (roadmap §13, C2):
 * a range-ball reference only compares with range-ball measurements and a
 * premium reference only with premium estimates. An 'unknown' basis (legacy
 * rows) is never silently compared — the reference is shown, the comparison
 * is withheld with a reason.
 */
export function referenceBasisCompatible(
  referenceBasis: ReferenceBasis,
  basis: Basis,
): boolean {
  if (referenceBasis === 'unknown') return false;
  // Exact basis match; a family-level reference ('range'/'premium', e.g. from
  // older rows) matches either member of its family, but flat and unadjusted
  // variants are never mixed.
  if (referenceBasis === basis) return true;
  if (referenceBasis === 'range') return isRangeBallBasis(basis);
  if (referenceBasis === 'premium') return !isRangeBallBasis(basis);
  return false;
}

export type ReferenceComparisonRow = {
  value: number | null;
  delta: number | null;
  pct: number | null;
};

export type ReferenceComparison = {
  compatible: boolean;
  /** Why no comparison is shown, when incompatible. */
  reason: string | null;
  typical: ReferenceComparisonRow;
  strong: ReferenceComparisonRow;
};

function comparisonRow(
  referenceM: number,
  measured: number | null,
): ReferenceComparisonRow {
  if (measured === null) return { value: null, delta: null, pct: null };
  return {
    value: measured,
    delta: measured - referenceM,
    pct: referenceM > 0 ? measured / referenceM : null,
  };
}

/**
 * Compare measured typical and strong-strike (P80) values against a personal
 * reference. Only call with matching metric semantics — a 'carry' reference
 * against carry stats; a 'total' reference must never be compared with carry
 * numbers. Incompatible bases yield compatible:false with a reason, never a
 * silent comparison.
 */
export function compareWithReference(
  reference: UserReferenceValueRecord,
  measured: { typical: number | null; strong: number | null },
  basis: Basis,
): ReferenceComparison {
  if (!referenceBasisCompatible(reference.basis, basis))
    return {
      compatible: false,
      reason:
        reference.basis === 'unknown'
          ? 'Reference basis unknown — set it when editing so it can be compared safely'
          : `Reference is ${reference.basis}-ball; current view is ${isRangeBallBasis(basis) ? 'range' : 'premium'}-ball`,
      typical: { value: null, delta: null, pct: null },
      strong: { value: null, delta: null, pct: null },
    };
  return {
    compatible: true,
    reason: null,
    typical: comparisonRow(reference.valueM, measured.typical),
    strong: comparisonRow(reference.valueM, measured.strong),
  };
}

/** Validate a user-entered reference value before storing it. */
export function validateUserReferenceValue(
  value: UserReferenceValue,
): string | null {
  if (isUnknownClub(value.club)) return 'Club label is unknown';
  if (!Number.isFinite(value.valueM) || value.valueM <= 0)
    return 'Reference must be a positive distance in metres';
  if (value.valueM > 500) return 'Reference looks implausible (> 500 m)';
  if (!referenceMetricSchema.options.includes(value.metric))
    return 'Unknown metric';
  return null;
}

/**
 * Hygiene rules enforced by tests: no embedded datasets without a written
 * license reference, every entry carries the §7.2 attribution fields, and
 * URLs are https.
 */
export function benchmarkHygieneProblems(
  sources: readonly BenchmarkSource[] = BENCHMARK_SOURCES,
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) problems.push(`duplicate id ${source.id}`);
    ids.add(source.id);
    if (source.license === 'embedded-with-license' && !source.licenseEvidence)
      problems.push(`${source.id}: embedded-with-license requires licenseEvidence`);
    if (!/^https:\/\//.test(source.url))
      problems.push(`${source.id}: url must be https`);
    for (const field of ['name', 'publisher', 'population', 'retrievedAt'] as const) {
      if (!source[field]) problems.push(`${source.id}: missing ${field}`);
    }
    if (!source.metric || !source.venue || !source.audience)
      problems.push(`${source.id}: missing metric/venue/audience`);
    if (!source.clubs.length) problems.push(`${source.id}: no clubs`);
  }
  return problems;
}
