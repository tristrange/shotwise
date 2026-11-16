import { z } from 'zod';
import { datasetSchema, parsedShotSchema, type Dataset } from './model';
import { fromBase64, PARSER_VERSION, parseCsv } from './csv';

export function serializeBackup(dataset: Dataset): string {
  return JSON.stringify(
    {
      format: 'shotwise',
      version: 1,
      exportedAt: new Date().toISOString(),
      dataset,
    },
    null,
    2,
  );
}
export async function parseBackup(text: string): Promise<Dataset> {
  if (text.length > 100 * 1024 * 1024)
    throw new Error('Backup exceeds the 100 MB browser restore limit.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. Choose a Shotwise backup.');
  }
  const envelope = z
    .object({
      format: z.literal('shotwise'),
      version: z.literal(1),
      dataset: datasetSchema,
    })
    .safeParse(value);
  if (!envelope.success)
    throw new Error('Unsupported backup version or invalid Shotwise data.');
  const data = envelope.data.dataset;
  for (const rows of [data.sessions, data.shots, data.imports, data.events]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error('Backup contains duplicate record IDs.');
  }
  const sessions = new Set(data.sessions.map((s) => s.id));
  const shots = new Map(data.shots.map((s) => [s.id, s]));
  if (
    data.imports.length !== sessions.size ||
    new Set(data.imports.map((i) => i.sessionId)).size !== sessions.size
  )
    throw new Error('Every session needs exactly one original import.');
  if (
    data.shots.some((s) => !sessions.has(s.sessionId)) ||
    data.imports.some((i) => !sessions.has(i.sessionId)) ||
    data.events.some((e) => !shots.has(e.shotId))
  )
    throw new Error('Backup has broken session or review references.');
  for (const original of data.imports) {
    if (original.parserVersion !== PARSER_VERSION)
      throw new Error('This backup uses an unsupported parser version.');
    let parsed;
    try {
      parsed = await parseCsv(fromBase64(original.originalBase64));
    } catch {
      throw new Error('An original CSV in this backup could not be verified.');
    }
    if (
      parsed.fileHash !== original.fileHash ||
      parsed.contentHash !== original.contentHash
    )
      throw new Error('Original CSV hash mismatch. The backup may be damaged.');
    const saved = data.shots
      .filter((s) => s.sessionId === original.sessionId)
      .sort((a, b) => a.rowIndex - b.rowIndex)
      .map((s) => parsedShotSchema.parse(s));
    const canonical = (shots: typeof saved) =>
      JSON.stringify(
        shots.map((s) => ({
          ...s,
          raw: Object.fromEntries(
            Object.entries(s.raw).sort(([a], [b]) => a.localeCompare(b)),
          ),
        })),
      );
    if (canonical(saved) !== canonical(parsed.shots))
      throw new Error('Saved shot measurements do not match the original CSV.');
  }
  return data;
}
