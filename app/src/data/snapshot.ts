import { datasetSchema, type Dataset } from '../domain/model';

type Table =
  | 'sessions'
  | 'shots'
  | 'imports'
  | 'events'
  | 'equipment'
  | 'equipmentAssignments';
export async function loadConsistent(source: {
  version(): Promise<number>;
  page(table: Table, offset: number, limit: number): Promise<unknown[]>;
  pageSize?: number;
}): Promise<Dataset> {
  const pageSize = source.pageSize ?? 500;
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = await source.version();
    const read = async (table: Table) => {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await source.page(table, offset, pageSize);
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    };
    const [sessions, shots, imports, events, equipment, equipmentAssignments] =
      await Promise.all([
        read('sessions'),
        read('shots'),
        read('imports'),
        read('events'),
        read('equipment'),
        read('equipmentAssignments'),
      ]);
    const after = await source.version();
    if (version === after)
      return datasetSchema.parse({
        version,
        sessions,
        shots,
        imports,
        events,
        equipment,
        equipmentAssignments,
      });
  }
  throw new Error(
    'History changed while loading. Refresh once the other device has finished saving.',
  );
}
