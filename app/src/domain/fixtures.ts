import Papa from 'papaparse';
import {
  FIELD_HEADERS,
  initialReview,
  metricKeySchema,
  measurementsSchema,
  type Equipment,
  type Session,
  type Shot,
  type Review,
  type Measurements,
} from './model';

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    date: '2026-11-16',
    time: null,
    venue: '',
    notes: '',
    archived: false,
    filename: 'synthetic.csv',
    revision: 0,
    ...overrides,
  };
}
export function makeShot(
  overrides: Omit<Partial<Shot>, 'measurements' | 'review'> & {
    measurements?: Partial<Measurements>;
    review?: Partial<Review>;
  } = {},
): Shot {
  const { measurements, review, ...rest } = overrides;
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    rowIndex: 1,
    sourceNumber: '1',
    recordedClub: '7i',
    raw: {},
    revision: 0,
    measurements: {
      ...measurementsSchema.parse(
        Object.fromEntries(metricKeySchema.options.map((k) => [k, null])),
      ),
      flatCarryPremium: 100,
      ...measurements,
    },
    review: { ...initialReview, ...review },
    ...rest,
  };
}
export function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: crypto.randomUUID(),
    inrangeLabel: '7i',
    name: 'Lab 7i',
    manufacturer: null,
    loft: null,
    status: 'in-bag',
    acquiredOn: null,
    retiredOn: null,
    revision: 0,
    ...overrides,
  };
}
export function csvFixture(rows: Record<string, string>[]): string {
  return Papa.unparse(
    rows.map((row, i) => ({
      'Shot #': String(i + 1),
      Club: '7i',
      ...Object.fromEntries(Object.values(FIELD_HEADERS).map((h) => [h, '--'])),
      'Carry Dist. Range (m)': '100',
      ...row,
    })),
    { newline: '\n' },
  );
}
