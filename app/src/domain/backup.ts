import { z } from 'zod';
import {
  datasetSchema,
  parsedShotSchema,
  type Dataset,
} from './model';
import { fromBase64, PARSER_VERSION, parseCsv } from './csv';

export function serializeBackup(dataset: Dataset): string {
  return JSON.stringify(
    {
      format: 'shotwise',
      version: 2,
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
  // v2 requires the equipment collections; a legacy v1 envelope maps them to empty.
  const current = z
    .object({
      format: z.literal('shotwise'),
      version: z.literal(2),
      dataset: datasetSchema,
    })
    .safeParse(value);
  let data: Dataset;
  if (current.success) {
    data = current.data.dataset;
  } else {
    const legacy = z
      .object({
        format: z.literal('shotwise'),
        version: z.literal(1),
        dataset: datasetSchema.omit({
          equipment: true,
          equipmentAssignments: true,
        }),
      })
      .safeParse(value);
    if (!legacy.success)
      throw new Error('Unsupported backup version or invalid Shotwise data.');
    data = {
      ...legacy.data.dataset,
      equipment: [],
      equipmentAssignments: [],
    };
  }
  for (const rows of [
    data.sessions,
    data.shots,
    data.imports,
    data.events,
    data.equipment,
  ]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error('Backup contains duplicate record IDs.');
  }
  if (
    new Set(data.equipmentAssignments.map((row) => row.shotId)).size !==
    data.equipmentAssignments.length
  )
    throw new Error('Backup contains duplicate assignment shot IDs.');
  const sessions = new Set(data.sessions.map((s) => s.id));
  const shots = new Map(data.shots.map((s) => [s.id, s]));
  const equipment = new Set(data.equipment.map((e) => e.id));
  if (
    data.imports.length !== sessions.size ||
    new Set(data.imports.map((i) => i.sessionId)).size !== sessions.size
  )
    throw new Error('Every session needs exactly one original import.');
  if (
    data.shots.some((s) => !sessions.has(s.sessionId)) ||
    data.imports.some((i) => !sessions.has(i.sessionId)) ||
    data.events.some((e) => !shots.has(e.shotId)) ||
    data.equipmentAssignments.some(
      (a) => !shots.has(a.shotId) || !equipment.has(a.equipmentId),
    )
  )
    throw new Error('Backup has broken session, review, or equipment references.');
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
