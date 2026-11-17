import { z } from 'zod';

export const idSchema = z.uuid();
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date');
export const metricKeySchema = z.enum([
  'carryRange',
  'flatCarryRange',
  'carryPremium',
  'flatCarryPremium',
  'totalRange',
  'flatTotalRange',
  'totalPremium',
  'flatTotalPremium',
  'apexRange',
  'apexPremium',
  'speedRange',
  'speedPremium',
  'launchRange',
  'launchPremium',
  'launchDirection',
  'fromCentre',
  'curve',
  'proximity',
  'target',
  'strokesGained',
]);
export type MetricKey = z.infer<typeof metricKeySchema>;
export const measurementsSchema = z.record(
  metricKeySchema,
  z.number().finite().nullable(),
);
export type Measurements = z.infer<typeof measurementsSchema>;
export const FIELD_HEADERS = {
  carryRange: 'Carry Dist. Range (m)',
  flatCarryRange: 'Flat Carry Dist. Range (m)',
  carryPremium: 'Carry Dist. Premium (m)',
  flatCarryPremium: 'Flat Carry Dist. Premium (m)',
  totalRange: 'Total Dist. Range (m)',
  flatTotalRange: 'Flat Total Dist. Range (m)',
  totalPremium: 'Total Dist. Premium (m)',
  flatTotalPremium: 'Flat Total Dist. Premium (m)',
  apexRange: 'Apex (m)',
  apexPremium: 'Apex (m) Premium',
  speedRange: 'Ball Speed (kph)',
  speedPremium: 'Ball Speed (kph) Premium',
  launchRange: 'Launch Angle (deg)',
  launchPremium: 'Launch Angle (deg) Premium',
  launchDirection: 'Launch Direction',
  fromCentre: 'From Centre (m)',
  curve: 'Curve',
  proximity: 'Prox to Hole (m)',
  target: 'Target (m)',
  strokesGained: 'Strokes Gained',
} satisfies Record<MetricKey, string>;

export const clubDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unreviewed') }),
  z.object({ kind: z.literal('confirmed') }),
  z.object({
    kind: z.literal('corrected'),
    club: z.string().trim().min(1).max(30),
  }),
]);
export const reviewSchema = z.object({
  intent: z.enum(['full', 'partial', 'unknown']),
  contact: z.enum(['typical', 'mishit', 'uncertain']),
  club: clubDecisionSchema,
  exclusion: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('included') }),
    z.object({
      kind: z.literal('excluded'),
      reason: z.string().trim().min(1).max(500),
    }),
  ]),
});
export type Review = z.infer<typeof reviewSchema>;
export const initialReview: Review = {
  intent: 'unknown',
  contact: 'uncertain',
  club: { kind: 'unreviewed' },
  exclusion: { kind: 'included' },
};
export const parsedShotSchema = z.object({
  rowIndex: z.number().int().positive(),
  sourceNumber: z.string(),
  recordedClub: z.string(),
  raw: z.record(z.string(), z.string()),
  measurements: measurementsSchema,
});
export type ParsedShot = z.infer<typeof parsedShotSchema>;
export const shotSchema = parsedShotSchema.extend({
  id: idSchema,
  sessionId: idSchema,
  review: reviewSchema,
  revision: z.number().int().nonnegative(),
});
export type Shot = z.infer<typeof shotSchema>;
export const sessionSchema = z.object({
  id: idSchema,
  date: dateSchema,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  venue: z.string().max(200),
  notes: z.string().max(2000),
  archived: z.boolean(),
  filename: z.string(),
  revision: z.number().int().nonnegative(),
});
export type Session = z.infer<typeof sessionSchema>;
export const importSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  originalBase64: z.string(),
  fileHash: z.string(),
  contentHash: z.string(),
  parserVersion: z.string(),
});
export const eventSchema = z.object({
  id: idSchema,
  shotId: idSchema,
  before: reviewSchema,
  after: reviewSchema,
  createdAt: z.string(),
  undone: z.boolean().optional(),
});
export type ReviewEvent = z.infer<typeof eventSchema>;
export const datasetSchema = z.object({
  version: z.number().int().nonnegative(),
  sessions: z.array(sessionSchema),
  shots: z.array(shotSchema),
  imports: z.array(importSchema),
  events: z.array(eventSchema),
});
export type Dataset = z.infer<typeof datasetSchema>;
export const emptyDataset: Dataset = {
  version: 0,
  sessions: [],
  shots: [],
  imports: [],
  events: [],
};
export const basisSchema = z.enum([
  'premium-flat',
  'range-flat',
  'premium',
  'range',
]);
export type Basis = z.infer<typeof basisSchema>;
export const BASES: Record<
  Basis,
  {
    label: string;
    carry: MetricKey;
    total: MetricKey;
    speed: MetricKey;
    launch: MetricKey;
    apex: MetricKey;
  }
> = {
  'premium-flat': {
    label: 'Premium · flat (estimate)',
    carry: 'flatCarryPremium',
    total: 'flatTotalPremium',
    speed: 'speedPremium',
    launch: 'launchPremium',
    apex: 'apexPremium',
  },
  'range-flat': {
    label: 'Range · flat',
    carry: 'flatCarryRange',
    total: 'flatTotalRange',
    speed: 'speedRange',
    launch: 'launchRange',
    apex: 'apexRange',
  },
  premium: {
    label: 'Premium (estimate)',
    carry: 'carryPremium',
    total: 'totalPremium',
    speed: 'speedPremium',
    launch: 'launchPremium',
    apex: 'apexPremium',
  },
  range: {
    label: 'Range',
    carry: 'carryRange',
    total: 'totalRange',
    speed: 'speedRange',
    launch: 'launchRange',
    apex: 'apexRange',
  },
};
export function effectiveClub(shot: Shot): string {
  return shot.review.club.kind === 'corrected'
    ? shot.review.club.club
    : shot.recordedClub;
}
export function isWedge(club: string): boolean {
  return /^(PW|SW|GW|LW|AW|UW|W|\d{2}°?)$/i.test(club.trim());
}
export function isUnknownClub(club: string): boolean {
  return !club.trim() || ['?', 'unknown', '--'].includes(club.toLowerCase());
}
/** Longest to shortest: driver, woods, hybrids, irons, then wedges. */
export function clubOrder(club: string): number {
  const value = club.trim().toLowerCase();
  if (/^(d|dr|driver|1w)$/.test(value)) return 0;
  // Nominal lofts only place named wedges among loft-labelled clubs; actual lofts vary.
  const wedgeLoft = new Map([
    ['pw', 46],
    ['gw', 50],
    ['aw', 50],
    ['uw', 50],
    ['sw', 56],
    ['lw', 60],
  ]).get(value);
  if (wedgeLoft !== undefined) return 100 + wedgeLoft;
  const loft = value.match(/^(\d{2})°?$/);
  if (loft) return 100 + Number(loft[1]);
  const match = value.match(/^(\d+)(w|h|i)?$/);
  if (match) {
    const number = Number(match[1]);
    const family = match[2];
    if (family === 'w') return 10 + number;
    if (family === 'h') return 30 + number;
    return 50 + number;
  }
  return 200;
}
export function localToday(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(value: string, days: number): string {
  const d = new Date(value + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
