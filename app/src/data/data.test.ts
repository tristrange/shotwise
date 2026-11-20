import { describe, it, expect } from 'vitest';
import { loadConsistent } from './snapshot';
import { parseBackup, serializeBackup } from '../domain/backup';
import {
  csvFixture,
  makeEquipment,
  makeSession,
  makeShot,
} from '../domain/fixtures';
import {
  effectiveClub,
  equipmentAssignmentPreviewSchema,
  type Dataset,
} from '../domain/model';
import { parseCsv } from '../domain/csv';

describe('complete snapshot loading', () => {
  it('retries a changing dataset and never returns partial pages', async () => {
    let reads = 0;
    const result = await loadConsistent({
      version: async () => [0, 1, 1, 1][reads++] ?? 1,
      page: async (table, offset) =>
        table === 'sessions' && offset === 0 ? [makeSession()] : [],
      pageSize: 1,
    });
    expect(result.sessions).toHaveLength(1);
    expect(reads).toBe(4);
    await expect(
      loadConsistent({
        version: async () => 0,
        page: async () => {
          throw new Error('offline');
        },
        pageSize: 1,
      }),
    ).rejects.toThrow('offline');
  });
  it('fails on continuous writes instead of showing an inconsistent history', async () => {
    let revision = 0;
    await expect(
      loadConsistent({
        version: async () => revision++,
        page: async () => [],
        pageSize: 100,
      }),
    ).rejects.toThrow('changed');
  });
});

describe('equipment snapshot paging', () => {
  it('pages both new collections across pages and retries when the version moves', async () => {
    const clubA = makeEquipment({ inrangeLabel: '7i', name: 'Lab 7i A' });
    const clubB = makeEquipment({ inrangeLabel: 'PW', name: 'Lab PW' });
    const assignment = {
      shotId: crypto.randomUUID(),
      equipmentId: clubA.id,
      clubLabel: '7i',
    };
    let reads = 0;
    const result = await loadConsistent({
      version: async () => [0, 1, 1, 1][reads++] ?? 1,
      page: async (table, offset) => {
        if (table === 'equipment')
          return offset === 0 ? [clubA] : offset === 1 ? [clubB] : [];
        if (table === 'equipmentAssignments')
          return offset === 0 ? [assignment] : [];
        return [];
      },
      pageSize: 1,
    });
    expect(result.equipment.map((e) => e.id)).toEqual([clubA.id, clubB.id]);
    expect(result.equipmentAssignments).toEqual([assignment]);
    expect(reads).toBe(4);
  });
});

it('rejects case variants of the same shot in one equipment preview', () => {
  const shot = 'a0000000-0000-4000-8000-000000000001';
  expect(
    equipmentAssignmentPreviewSchema.safeParse({
      expectedVersion: 0,
      sessionId: crypto.randomUUID(),
      clubLabel: '7i',
      equipmentId: null,
      shotIds: [shot, shot.toUpperCase()],
    }).success,
  ).toBe(false);
});

describe('portable private backups', () => {
  it('accepts unchanged raw cells whose keys were reordered by PostgreSQL jsonb', async () => {
    const session = makeSession();
    const preview = await parseCsv(new TextEncoder().encode(csvFixture([{}])));
    const source = preview.shots[0];
    if (!source) throw new Error('Missing fixture shot');
    const shot = makeShot({
      ...source,
      sessionId: session.id,
      raw: Object.fromEntries(Object.entries(source.raw).reverse()),
    });
    const data = {
      version: 1,
      sessions: [session],
      shots: [shot],
      imports: [{ id: crypto.randomUUID(), sessionId: session.id, ...preview }],
      events: [],
      equipment: [],
      equipmentAssignments: [],
    };
    expect((await parseBackup(serializeBackup(data))).shots[0]?.id).toBe(
      shot.id,
    );
  });
  it('validates original bytes, parser output and stable references in a round trip', async () => {
    const session = makeSession();
    const preview = await parseCsv(new TextEncoder().encode(csvFixture([{}])));
    const shot = makeShot({ ...preview.shots[0], sessionId: session.id });
    const dataset = {
      version: 1,
      sessions: [session],
      shots: [shot],
      imports: [{ id: crypto.randomUUID(), sessionId: session.id, ...preview }],
      events: [],
      equipment: [],
      equipmentAssignments: [],
    };
    const restored = await parseBackup(serializeBackup(dataset));
    expect(restored.shots[0]?.id).toBe(shot.id);
    expect(restored.imports[0]?.fileHash).toBe(preview.fileHash);
  });
  it('rejects unsupported versions, broken references and tampered originals', async () => {
    await expect(
      parseBackup('{"format":"shotwise","version":99}'),
    ).rejects.toThrow('version');
    const session = makeSession();
    await expect(
      parseBackup(
        serializeBackup({
          version: 0,
          sessions: [session],
          shots: [makeShot()],
          imports: [],
          events: [],
          equipment: [],
          equipmentAssignments: [],
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('equipment backups', () => {
  async function baseDataset(): Promise<{ dataset: Dataset; shot: Dataset['shots'][number] }> {
    const session = makeSession();
    const preview = await parseCsv(new TextEncoder().encode(csvFixture([{}])));
    const source = preview.shots[0];
    if (!source) throw new Error('Missing fixture shot');
    const shot = makeShot({ ...source, sessionId: session.id });
    return {
      dataset: {
        version: 1,
        sessions: [session],
        shots: [shot],
        imports: [
          { id: crypto.randomUUID(), sessionId: session.id, ...preview },
        ],
        events: [],
        equipment: [],
        equipmentAssignments: [],
      },
      shot,
    };
  }
  it('writes v2 envelopes and round-trips equipment and assignments', async () => {
    const { dataset, shot } = await baseDataset();
    const club = makeEquipment({ inrangeLabel: shot.recordedClub });
    const assignment = {
      shotId: shot.id,
      equipmentId: club.id,
      clubLabel: shot.recordedClub,
    };
    const text = serializeBackup({
      ...dataset,
      equipment: [club],
      equipmentAssignments: [assignment],
    });
    expect(JSON.parse(text).version).toBe(2);
    const restored = await parseBackup(text);
    expect(restored.equipment).toEqual([club]);
    expect(restored.equipmentAssignments).toEqual([assignment]);
  });
  it('maps legacy v1 envelopes to empty equipment collections', async () => {
    const { dataset } = await baseDataset();
    const legacy = {
      format: 'shotwise',
      version: 1,
      dataset: {
        version: dataset.version,
        sessions: dataset.sessions,
        shots: dataset.shots,
        imports: dataset.imports,
        events: dataset.events,
      },
    };
    const restored = await parseBackup(JSON.stringify(legacy));
    expect(restored.equipment).toEqual([]);
    expect(restored.equipmentAssignments).toEqual([]);
    expect(restored.shots).toHaveLength(1);
    expect(restored.sessions).toHaveLength(1);
  });
  it('rejects v2 datasets without equipment arrays and invalid equipment references', async () => {
    const { dataset, shot } = await baseDataset();
    const withoutArrays = {
      format: 'shotwise',
      version: 2,
      dataset: {
        version: dataset.version,
        sessions: dataset.sessions,
        shots: dataset.shots,
        imports: dataset.imports,
        events: dataset.events,
      },
    };
    await expect(parseBackup(JSON.stringify(withoutArrays))).rejects.toThrow(
      'Unsupported backup version',
    );
    const club = makeEquipment();
    const duplicate = serializeBackup({
      ...dataset,
      equipment: [club, { ...club }],
      equipmentAssignments: [],
    });
    await expect(parseBackup(duplicate)).rejects.toThrow('duplicate');
    const orphanEquipment = serializeBackup({
      ...dataset,
      equipment: [club],
      equipmentAssignments: [
        { shotId: shot.id, equipmentId: crypto.randomUUID(), clubLabel: '7i' },
      ],
    });
    await expect(parseBackup(orphanEquipment)).rejects.toThrow('references');
    const orphanShot = serializeBackup({
      ...dataset,
      equipment: [club],
      equipmentAssignments: [
        {
          shotId: crypto.randomUUID(),
          equipmentId: club.id,
          clubLabel: '7i',
        },
      ],
    });
    await expect(parseBackup(orphanShot)).rejects.toThrow('references');
  });
  it('preserves assignments that no longer match a corrected club for review', async () => {
    const { dataset, shot } = await baseDataset();
    const club = makeEquipment({ inrangeLabel: '7i' });
    const corrected = makeShot({
      ...shot,
      review: { club: { kind: 'corrected', club: 'PW' } },
    });
    const mismatched = serializeBackup({
      ...dataset,
      shots: [corrected],
      equipment: [club],
      equipmentAssignments: [
        { shotId: corrected.id, equipmentId: club.id, clubLabel: '7i' },
      ],
    });
    const restored = await parseBackup(mismatched);
    const restoredShot = restored.shots[0];
    if (!restoredShot) throw new Error('Missing restored shot');
    expect(effectiveClub(restoredShot)).toBe('PW');
    expect(restored.equipmentAssignments).toEqual([
      { shotId: corrected.id, equipmentId: club.id, clubLabel: '7i' },
    ]);
  });
});
