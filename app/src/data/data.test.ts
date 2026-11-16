import { describe, it, expect } from 'vitest';
import { loadConsistent } from './snapshot';
import { parseBackup, serializeBackup } from '../domain/backup';
import { csvFixture, makeSession, makeShot } from '../domain/fixtures';
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
        }),
      ),
    ).rejects.toThrow();
  });
});
