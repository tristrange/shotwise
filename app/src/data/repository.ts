import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  datasetSchema,
  equipmentAssignmentPreviewSchema,
  equipmentSaveInputSchema,
  equipmentSchema,
  sessionSchema,
  userReferenceValueSaveInputSchema,
  userReferenceValueSchema,
} from '../domain/model';
import { loadConsistent } from './snapshot';
import type { Backend, Repository } from './contracts';
import type { Database } from './database.types';

export function createRepository(client: SupabaseClient<Database>): Repository {
  async function rpc<N extends keyof Database['public']['Functions']>(
    name: N,
    parameters: Database['public']['Functions'][N]['Args'],
  ): Promise<unknown> {
    const { data, error } = await client.rpc(name, parameters);
    if (error) {
      if (
        error.message.includes('revision') ||
        error.message.includes('conflict')
      )
        throw new Error(
          'This record changed on another device. Refresh before saving again. Your input has been kept.',
        );
      if (error.message.includes('JWT') || error.code === 'PGRST301')
        throw new Error('Your sign-in has expired. Sign in again and retry.');
      if (
        error.code === '57014' ||
        error.message.includes('statement timeout')
      ) {
        if (name === 'commit_import')
          throw new Error('Import timed out before saving. Retry or choose a smaller export.');
        if (name === 'restore_backup')
          throw new Error('Restore timed out before saving. Keep your backup file and retry.');
        throw new Error('Shotwise timed out waiting for the server. Try again.');
      }
      if (
        error.message.includes('Failed to fetch') ||
        error.message.includes('fetch failed')
      )
        throw new Error(
          'Unable to reach Shotwise. Check your connection and retry; your input has been kept.',
        );
      throw new Error(error.message);
    }
    return data;
  }
  return {
    load: () =>
      loadConsistent({
        version: async () =>
          z
            .number()
            .int()
            .nonnegative()
            .parse(await rpc('dataset_version', {})),
        page: async (table, offset, limit) =>
          z.array(z.unknown()).parse(
            await rpc('dataset_page', {
              p_table: table,
              p_offset: offset,
              p_limit: limit,
            }),
          ),
      }),
    importCsv: async (input) =>
      z
        .object({ sessionId: z.uuid(), duplicate: z.boolean() })
        .parse(await rpc('commit_import', { p_input: z.json().parse(input) })),
    review: async (changes) => {
      await rpc('apply_reviews', { p_changes: z.json().parse(changes) });
    },
    undo: async (shots) => {
      await rpc('undo_reviews', { p_shots: z.json().parse(shots) });
    },
    updateSession: async (session) => {
      await rpc('update_session', {
        p_session: z.json().parse(sessionSchema.parse(session)),
      });
    },
    saveEquipment: async (input) =>
      equipmentSchema.parse(
        await rpc('save_equipment', {
          p_equipment: z
            .json()
            .parse(equipmentSaveInputSchema.parse(input)),
        }),
      ),
    assignEquipment: async (input) => {
      await rpc('assign_equipment', {
        p_preview: z
          .json()
          .parse(equipmentAssignmentPreviewSchema.parse(input)),
      });
    },
    saveUserReferenceValue: async (input) =>
      userReferenceValueSchema.parse(
        await rpc('save_reference_value', {
          p_value: z
            .json()
            .parse(userReferenceValueSaveInputSchema.parse(input)),
        }),
      ),
    deleteUserReferenceValue: async (id, expectedRevision) => {
      await rpc('delete_reference_value', { p_id: id, p_revision: expectedRevision });
    },
    restore: async (dataset) => {
      await rpc('restore_backup', {
        p_dataset: z.json().parse(datasetSchema.parse(dataset)),
      });
    },
  };
}

function configure(): Backend {
  const url: unknown = import.meta.env?.VITE_SUPABASE_URL;
  const key: unknown = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (
    typeof url !== 'string' ||
    typeof key !== 'string' ||
    !url ||
    !key ||
    key.includes('replace-with')
  )
    return { kind: 'unconfigured' };
  const checked = z.url().safeParse(url);
  if (!checked.success || !/^https?:\/\//.test(url))
    return { kind: 'unconfigured' };
  if (key.startsWith('sb_secret_')) return { kind: 'unconfigured' };
  if (key.startsWith('ey')) {
    try {
      const claims: unknown = JSON.parse(atob(key.split('.')[1] ?? ''));
      if (!z.object({ role: z.literal('anon') }).safeParse(claims).success)
        return { kind: 'unconfigured' };
    } catch {
      return { kind: 'unconfigured' };
    }
  }
  const client = createClient<Database>(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return { kind: 'configured', client, repository: createRepository(client) };
}
export const backend = configure();
