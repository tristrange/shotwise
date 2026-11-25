import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { CsvPreview } from '../domain/csv';
import type {
  Dataset,
  Equipment,
  EquipmentAssignmentPreview,
  EquipmentSaveInput,
  Review,
  Session,
  UserReferenceValueRecord,
  UserReferenceValueSaveInput,
} from '../domain/model';

export type ImportInput = {
  filename: string;
  date: string;
  time: string | null;
  venue: string;
  notes: string;
  confirmedFull: boolean;
  allowSameDay: boolean;
  preview: CsvPreview;
};
export type ReviewChange = {
  shotId: string;
  expectedRevision: number;
  review: Review;
};
export type RevisionInput = { shotId: string; expectedRevision: number };
export interface Repository {
  load(): Promise<Dataset>;
  importCsv(
    input: ImportInput,
  ): Promise<{ sessionId: string; duplicate: boolean }>;
  review(changes: ReviewChange[]): Promise<void>;
  undo(shots: RevisionInput[]): Promise<void>;
  updateSession(session: Session): Promise<void>;
  saveEquipment(input: EquipmentSaveInput): Promise<Equipment>;
  assignEquipment(input: EquipmentAssignmentPreview): Promise<void>;
  saveUserReferenceValue(
    input: UserReferenceValueSaveInput,
  ): Promise<UserReferenceValueRecord>;
  deleteUserReferenceValue(id: string): Promise<void>;
  restore(dataset: Dataset): Promise<void>;
}
export type Backend =
  | {
      kind: 'configured';
      client: SupabaseClient<Database>;
      repository: Repository;
    }
  | { kind: 'unconfigured' };
