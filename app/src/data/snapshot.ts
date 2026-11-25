import { datasetSchema, type Dataset } from '../domain/model';

type Table =
  | 'sessions'
  | 'shots'
  | 'imports'
  | 'events'
  | 'equipment'
  | 'equipmentAssignments'
  | 'userReferenceValues';
/**
 * Collections added after the client's minimum supported RPC schema. A newer
 * client loading against an older deployed database must still read history:
 * the old `dataset_page` rejects these with 'Invalid dataset table' (see
 * supabase/migrations/20261120003439_equipment_persistence.sql), which is
 * treated as an empty collection (the dataset schema defaults them to []).
 */
const OPTIONAL_TABLES: ReadonlySet<Table> = new Set(['userReferenceValues']);
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
        let page: unknown[];
        try {
          page = await source.page(table, offset, pageSize);
        } catch (error) {
          if (
            OPTIONAL_TABLES.has(table) &&
            error instanceof Error &&
            /Invalid (dataset )?table/.test(error.message)
          )
            return [];
          throw error;
        }
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    };
    const [
      sessions,
      shots,
      imports,
      events,
      equipment,
      equipmentAssignments,
      userReferenceValues,
    ] = await Promise.all([
      read('sessions'),
      read('shots'),
      read('imports'),
      read('events'),
      read('equipment'),
      read('equipmentAssignments'),
      read('userReferenceValues'),
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
        userReferenceValues,
      });
  }
  throw new Error(
    'History changed while loading. Refresh once the other device has finished saving.',
  );
}
