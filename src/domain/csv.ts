import Papa from 'papaparse';
import { dateSchema, FIELD_HEADERS, measurementsSchema, metricKeySchema, parsedShotSchema, type MetricKey, type ParsedShot } from './model';

export const PARSER_VERSION = 'inrange-1';
export const MAX_BYTES = 5 * 1024 * 1024;
export type CsvWarning = { row: number; field: string; message: string };
export type CsvPreview = { originalBase64: string; fileHash: string; contentHash: string; parserVersion: string; shots: ParsedShot[]; warnings: CsvWarning[]; headers: string[] };
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}
export function fromBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function parseMeasurement(raw: string, key: MetricKey): number | null {
  const value = raw.trim();
  if (!value || value === '--') return null;
  const directional = ['curve', 'launchDirection', 'fromCentre'].includes(key);
  const match = value.match(directional ? /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([LR])?$/i : /^([+-]?\d+(?:\.\d+)?)\s*°?$/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  if (!['launchDirection', 'fromCentre', 'curve', 'strokesGained', 'launchRange', 'launchPremium'].includes(key) && parsed < 0) return null;
  if (key.startsWith('launch') && Math.abs(parsed) > 90) return null;
  return match[2] ? Math.abs(parsed) * (match[2].toUpperCase() === 'L' ? -1 : 1) : parsed;
}
export async function parseCsv(bytes: Uint8Array): Promise<CsvPreview> {
  if (bytes.byteLength > MAX_BYTES) throw new Error('CSV exceeds the 5 MB limit. Split the export into sessions.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('CSV must be UTF-8 encoded.'); }
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  if (result.errors.length) throw new Error('CSV structure could not be read: ' + result.errors[0]?.message);
  const [originalHeaders, ...rows] = result.data;
  const headers = originalHeaders?.map(h => h.trim()) ?? [];
  if (['Shot #', 'Club', 'Carry Dist. Range (m)'].some(h => !headers.includes(h))) throw new Error('Missing required headers: Shot #, Club, Carry Dist. Range (m).');
  if (new Set(headers).size !== headers.length || headers.some(h => !h)) throw new Error('CSV contains empty or duplicate column headers.');
  if (!rows.length) throw new Error('CSV has no shots.');
  if (rows.length > 20000) throw new Error('CSV exceeds the 20,000-shot limit.');
  const warnings: CsvWarning[] = [];
  const shots = rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Row ${index + 2} has ${cells.length} columns; expected ${headers.length}.`);
    const raw = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
    const measurements = measurementsSchema.parse(Object.fromEntries(metricKeySchema.options.map(key => {
      const field = FIELD_HEADERS[key];
      const cell = raw[field] ?? '';
      const value = parseMeasurement(cell, key);
      if (value === null && cell.trim() && cell.trim() !== '--') warnings.push({ row: index + 1, field, message: `“${cell}” is not a valid measurement; retained as missing.` });
      return [key, value];
    })));
    return parsedShotSchema.parse({ rowIndex: index + 1, sourceNumber: raw['Shot #'] ?? '', recordedClub: raw.Club?.trim() || '?', raw, measurements });
  });
  const sortedHeaders = [...headers].sort();
  const canonical = JSON.stringify([sortedHeaders, shots.map(s => sortedHeaders.map(h => s.raw[h]))]);
  return { originalBase64: toBase64(bytes), fileHash: await sha256(bytes), contentHash: await sha256(new TextEncoder().encode(canonical)), parserVersion: PARSER_VERSION, shots, warnings, headers };
}
export function suggestDate(filename: string): string {
  const iso = filename.match(/(20\d{2}-\d{2}-\d{2})/);
  if (iso?.[1]) return dateSchema.safeParse(iso[1]).success ? iso[1] : '';
  const d = filename.match(/(\d{1,2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{2}|\d{4})/i);
  if (!d?.[1] || !d[2] || !d[3]) return '';
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(d[2].toLowerCase()) + 1;
  const value = `${d[3].length === 2 ? '20' : ''}${d[3]}-${String(month).padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  return dateSchema.safeParse(value).success ? value : '';
}
