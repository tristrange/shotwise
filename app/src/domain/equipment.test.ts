import { describe, expect, it } from 'vitest';
import { makeEquipment, makeSession, makeShot } from './fixtures';
import {
  assignmentPreview,
  assignmentStatus,
  coverageCounts,
  draftFromEquipment,
  draftToSaveInput,
  emptyDraft,
  equipmentHistory,
  isEquipmentConflict,
  equipmentByCohort,
  sessionEquipmentGroups,
  sortEquipment,
} from './equipment';
import { emptyDataset, type Dataset } from './model';

describe('equipment drafts', () => {
  it('converts a draft into a validated save input, trimming and nulling optional text', () => {
    const input = draftToSaveInput(
      {
        inrangeLabel: ' 7i ',
        name: ' Lab 7i ',
        manufacturer: ' ',
        loft: ' 31° ',
        status: 'in-bag',
        acquiredOn: '2026-01-05',
        retiredOn: '',
      },
      '11111111-1111-4111-8111-111111111111',
      null,
    );
    expect(input).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      revision: null,
      inrangeLabel: '7i',
      name: 'Lab 7i',
      manufacturer: null,
      loft: '31°',
      status: 'in-bag',
      acquiredOn: '2026-01-05',
      retiredOn: null,
    });
  });
  it('keeps the previously read revision on update and rejects invalid drafts with a field message', () => {
    const update = draftToSaveInput(
      { ...emptyDraft(), inrangeLabel: 'PW', name: 'Wedge' },
      '11111111-1111-4111-8111-111111111111',
      7,
    );
    expect(update.revision).toBe(7);
    expect(() =>
      draftToSaveInput(
        { ...emptyDraft(), inrangeLabel: '7i', name: '   ' },
        '11111111-1111-4111-8111-111111111111',
        null,
      ),
    ).toThrow('display name');
    expect(() =>
      draftToSaveInput(
        { ...emptyDraft(), inrangeLabel: '', name: 'Lab 7i' },
        '11111111-1111-4111-8111-111111111111',
        null,
      ),
    ).toThrow('Inrange label');
    expect(() =>
      draftToSaveInput(
        { ...emptyDraft(), inrangeLabel: '7i', name: 'Lab 7i', acquiredOn: '2026-02-30' },
        '11111111-1111-4111-8111-111111111111',
        null,
      ),
    ).toThrow('calendar date');
  });
  it('round-trips a saved club back into a draft', () => {
    const club = makeEquipment({
      manufacturer: 'acme',
      loft: null,
      status: 'retired',
      acquiredOn: '2025-03-01',
      retiredOn: '2026-03-01',
    });
    expect(draftFromEquipment(club)).toEqual({
      inrangeLabel: club.inrangeLabel,
      name: club.name,
      manufacturer: 'acme',
      loft: '',
      status: 'retired',
      acquiredOn: '2025-03-01',
      retiredOn: '2026-03-01',
    });
  });
});

describe('equipment conflicts', () => {
  it('recognises the repository revision-conflict message', () => {
    expect(
      isEquipmentConflict(
        new Error(
          'This record changed on another device. Refresh before saving again. Your input has been kept.',
        ),
      ),
    ).toBe(true);
    expect(isEquipmentConflict(new Error('Equipment conflict'))).toBe(false);
    expect(isEquipmentConflict(new Error('Unable to reach Shotwise.'))).toBe(
      false,
    );
    expect(isEquipmentConflict('conflict')).toBe(false);
  });
});

describe('bag ordering', () => {
  it('puts in-bag clubs first and allows two clubs sharing one label', () => {
    const driver = makeEquipment({ inrangeLabel: 'D', name: 'Driver', status: 'in-bag' });
    const sevenA = makeEquipment({ inrangeLabel: '7i', name: 'Lab 7i A', status: 'in-bag' });
    const sevenB = makeEquipment({ inrangeLabel: '7i', name: 'Lab 7i B', status: 'retired' });
    const wedge = makeEquipment({ inrangeLabel: 'PW', name: 'Wedge', status: 'retired' });
    expect(sortEquipment([wedge, sevenB, driver, sevenA]).map((c) => c.name)).toEqual([
      'Driver',
      'Lab 7i A',
      'Lab 7i B',
      'Wedge',
    ]);
  });
});

describe('per-club assignment history', () => {
  const CLUB_ID = 'club-7i';
  function datasetWith(assignments: Dataset['equipmentAssignments']): {
    data: Dataset;
    club: ReturnType<typeof makeEquipment>;
  } {
    const club = makeEquipment({ id: CLUB_ID, inrangeLabel: '7i' });
    const older = makeSession({ id: 's-old', date: '2026-01-10', time: '09:00' });
    const newer = makeSession({ id: 's-new', date: '2026-02-10', time: null });
    const oldShot = makeShot({ id: 'shot-old', sessionId: older.id, recordedClub: '7i' });
    const newShotA = makeShot({ id: 'shot-a', sessionId: newer.id, recordedClub: '7i' });
    const newShotB = makeShot({
      id: 'shot-b',
      sessionId: newer.id,
      recordedClub: '7i',
      review: { club: { kind: 'corrected', club: 'PW' } },
    });
    const otherClub = makeEquipment({ inrangeLabel: 'PW' });
    const otherShot = makeShot({ id: 'shot-other', sessionId: newer.id, recordedClub: 'PW' });
    return {
      club,
      data: {
        ...emptyDataset,
        sessions: [older, newer],
        shots: [oldShot, newShotA, newShotB, otherShot],
        equipment: [club, otherClub],
        equipmentAssignments: [
          ...assignments,
          { shotId: otherShot.id, equipmentId: otherClub.id, clubLabel: 'PW' },
        ],
      },
    };
  }

  it('groups exact snapshot shot IDs into visits with counts, newest first, and flags corrected labels', () => {
    const { data } = datasetWith([
      { shotId: 'shot-old', equipmentId: CLUB_ID, clubLabel: '7i' },
      { shotId: 'shot-a', equipmentId: CLUB_ID, clubLabel: '7i' },
      { shotId: 'shot-b', equipmentId: CLUB_ID, clubLabel: '7i' },
    ]);
    const history = equipmentHistory(data, CLUB_ID);
    expect(history.total).toBe(3);
    expect(history.unknown).toBe(0);
    expect(history.needsReview).toBe(1);
    expect(history.visits.map((v) => [v.session.id, v.shots])).toEqual([
      ['s-new', 2],
      ['s-old', 1],
    ]);
    expect(history.visits[0]?.labels).toEqual(['7i']);
    expect(history.visits[0]?.needsReview).toBe(1);
  });

  it('keeps assignments whose shot is missing from the snapshot separate', () => {
    const { data } = datasetWith([
      { shotId: 'shot-a', equipmentId: CLUB_ID, clubLabel: '7i' },
      {
        shotId: '00000000-0000-4000-8000-000000000000',
        equipmentId: CLUB_ID,
        clubLabel: '7i',
      },
    ]);
    const history = equipmentHistory(data, CLUB_ID);
    expect(history.total).toBe(1);
    expect(history.unknown).toBe(1);
    expect(history.visits).toHaveLength(1);
  });
});

describe('assignment status', () => {
  it('classifies unassigned, current and needs-review shots by effective label', () => {
    const club = makeEquipment({ id: 'eq-1', inrangeLabel: '7i' });
    const plain = makeShot({ id: 'shot-plain', recordedClub: '7i' });
    const corrected = makeShot({
      id: 'shot-corrected',
      recordedClub: '7i',
      review: { club: { kind: 'corrected', club: 'PW' } },
    });
    const data: Dataset = {
      ...emptyDataset,
      equipment: [club],
      shots: [plain, corrected],
      equipmentAssignments: [
        { shotId: 'shot-plain', equipmentId: club.id, clubLabel: '7i' },
        { shotId: 'shot-corrected', equipmentId: club.id, clubLabel: '7i' },
      ],
    };
    expect(assignmentStatus(plain, data.equipmentAssignments[0])).toBe(
      'current',
    );
    expect(assignmentStatus(corrected, data.equipmentAssignments[1])).toBe(
      'needs-review',
    );
    expect(assignmentStatus(plain, null)).toBe('unassigned');
  });
});

describe('session equipment groups', () => {
  function sessionDataset(): {
    data: Dataset;
    session: ReturnType<typeof makeSession>;
  } {
    const session = makeSession({ id: 's-1' });
    const other = makeSession({ id: 's-2', archived: true });
    const shots = [
      makeShot({
        id: 'shot-1',
        sessionId: session.id,
        rowIndex: 2,
        sourceNumber: '2',
        recordedClub: '7i',
      }),
      makeShot({
        id: 'shot-2',
        sessionId: session.id,
        rowIndex: 1,
        sourceNumber: '1',
        recordedClub: '7i',
      }),
      makeShot({
        id: 'shot-3',
        sessionId: session.id,
        rowIndex: 3,
        sourceNumber: '3',
        recordedClub: '7i',
        review: {
          club: { kind: 'corrected', club: 'PW' },
          exclusion: { kind: 'excluded', reason: 'bad sensor' },
          intent: 'partial',
        },
      }),
      makeShot({
        id: 'shot-4',
        sessionId: session.id,
        rowIndex: 4,
        sourceNumber: '4',
        recordedClub: 'SW',
      }),
      makeShot({
        id: 'shot-5',
        sessionId: session.id,
        rowIndex: 5,
        sourceNumber: '5',
        recordedClub: '?',
      }),
      makeShot({
        id: 'shot-6',
        sessionId: other.id,
        rowIndex: 1,
        sourceNumber: '1',
        recordedClub: '7i',
      }),
    ];
    const club = makeEquipment({ id: 'eq-7i', inrangeLabel: '7i' });
    const data: Dataset = {
      ...emptyDataset,
      sessions: [session, other],
      shots,
      equipment: [club],
      equipmentAssignments: [
        { shotId: 'shot-1', equipmentId: club.id, clubLabel: '7i' },
        // shot-3 keeps its previous association even though it was corrected to PW and excluded.
        { shotId: 'shot-3', equipmentId: club.id, clubLabel: '7i' },
      ],
    };
    return { data, session };
  }

  it('groups every session shot by effective label in row order, independent of intent, contact and exclusion', () => {
    const { data, session } = sessionDataset();
    const groups = sessionEquipmentGroups(data, session.id);
    expect(groups.map((g) => g.club)).toEqual(['7i', 'PW', 'SW']);
    const seven = groups[0];
    expect(seven?.rows.map((r) => [r.rowIndex, r.shotId])).toEqual([
      [1, 'shot-2'],
      [2, 'shot-1'],
    ]);
    // shot-3 is corrected to PW, so it lands in the PW group; its 7i assignment is stale there.
    const pw = groups.find((g) => g.club === 'PW');
    expect(pw?.rows.map((r) => r.shotId)).toEqual(['shot-3']);
    expect(pw?.rows[0]?.status).toBe('needs-review');
    expect(pw?.rows[0]?.assignment?.clubLabel).toBe('7i');
    // Unknown labels are not assignable groups.
    expect(groups.some((g) => g.club === '?')).toBe(false);
  });

  it('derives known, mixed and unknown coverage with needs-review counts', () => {
    const { data, session } = sessionDataset();
    const groups = sessionEquipmentGroups(data, session.id);
    const seven = groups.find((g) => g.club === '7i');
    const sw = groups.find((g) => g.club === 'SW');
    const pw = groups.find((g) => g.club === 'PW');
    expect(seven).toMatchObject({
      total: 2,
      assigned: 1,
      current: 1,
      needsReview: 0,
      unassigned: 1,
      coverage: 'mixed',
    });
    expect(sw).toMatchObject({ total: 1, assigned: 0, coverage: 'unknown' });
    expect(pw).toMatchObject({
      total: 1,
      assigned: 1,
      needsReview: 1,
      coverage: 'mixed',
    });
    expect(coverageCounts(groups)).toEqual({
      known: 0,
      mixed: 2,
      unknown: 1,
      needsReview: 1,
    });
    // A fully current group reads as known.
    const all: Dataset = {
      ...data,
      equipmentAssignments: [
        { shotId: 'shot-1', equipmentId: 'eq-7i', clubLabel: '7i' },
        { shotId: 'shot-2', equipmentId: 'eq-7i', clubLabel: '7i' },
      ],
    };
    expect(
      sessionEquipmentGroups(all, session.id).find((g) => g.club === '7i')
        ?.coverage,
    ).toBe('known');
  });
});

describe('assignment preview', () => {
  function previewDataset(): {
    data: Dataset;
    session: ReturnType<typeof makeSession>;
  } {
    const session = makeSession({ id: 's-1' });
    const club = makeEquipment({ id: 'eq-7i', inrangeLabel: '7i' });
    const retired = makeEquipment({
      id: 'eq-7i-old',
      inrangeLabel: '7i',
      name: 'Old 7i',
      status: 'retired',
    });
    const shots = [
      makeShot({
        id: 'shot-1',
        sessionId: session.id,
        rowIndex: 1,
        sourceNumber: '1',
        recordedClub: '7i',
      }),
      makeShot({
        id: 'shot-2',
        sessionId: session.id,
        rowIndex: 2,
        sourceNumber: '2',
        recordedClub: '7i',
      }),
      makeShot({
        id: 'shot-3',
        sessionId: session.id,
        rowIndex: 3,
        sourceNumber: '3',
        recordedClub: '7i',
      }),
      makeShot({
        id: 'shot-4',
        sessionId: session.id,
        rowIndex: 4,
        sourceNumber: '4',
        recordedClub: '7i',
      }),
      makeShot({
        id: 'shot-5',
        sessionId: session.id,
        rowIndex: 5,
        sourceNumber: '5',
        recordedClub: '7i',
        review: { club: { kind: 'corrected', club: 'PW' } },
      }),
      makeShot({
        id: 'shot-6',
        sessionId: session.id,
        rowIndex: 6,
        sourceNumber: '6',
        recordedClub: 'SW',
      }),
    ];
    const data: Dataset = {
      ...emptyDataset,
      version: 41,
      sessions: [session],
      shots,
      equipment: [club, retired],
      equipmentAssignments: [
        { shotId: 'shot-1', equipmentId: club.id, clubLabel: '7i' },
        { shotId: 'shot-2', equipmentId: retired.id, clubLabel: '7i' },
        // shot-5 was corrected into PW, so its 7i assignment is stale.
        { shotId: 'shot-5', equipmentId: club.id, clubLabel: '7i' },
      ],
    };
    return { data, session };
  }

  it('pins the dataset version and the exact effective-label rows in row order', () => {
    const { data, session } = previewDataset();
    const preview = assignmentPreview(data, session.id, '7i');
    expect(preview.expectedVersion).toBe(41);
    expect(preview.sessionId).toBe(session.id);
    expect(preview.clubLabel).toBe('7i');
    expect(preview.firstRow).toBeNull();
    expect(preview.lastRow).toBeNull();
    // shot-5 is corrected to PW, so it is not eligible in the 7i group.
    expect(preview.rows.map((r) => r.shotId)).toEqual([
      'shot-1',
      'shot-2',
      'shot-3',
      'shot-4',
    ]);
    expect(preview.rows.map((r) => r.status)).toEqual([
      'current',
      'current',
      'unassigned',
      'unassigned',
    ]);
    expect(preview).toMatchObject({
      total: 4,
      assigned: 2,
      current: 2,
      needsReview: 0,
      unassigned: 2,
    });
  });

  it('applies an inclusive source-row range exactly', () => {
    const { data, session } = previewDataset();
    const preview = assignmentPreview(data, session.id, '7i', {
      firstRow: 2,
      lastRow: 3,
    });
    expect(preview.rows.map((r) => [r.rowIndex, r.shotId])).toEqual([
      [2, 'shot-2'],
      [3, 'shot-3'],
    ]);
    expect(preview.firstRow).toBe(2);
    expect(preview.lastRow).toBe(3);
    // Boundaries are inclusive: a single-row range keeps exactly that row.
    const single = assignmentPreview(data, session.id, '7i', {
      firstRow: 4,
      lastRow: 4,
    });
    expect(single.rows.map((r) => r.shotId)).toEqual(['shot-4']);
    // Open ends clamp to the group.
    const tail = assignmentPreview(data, session.id, '7i', { firstRow: 3 });
    expect(tail.rows.map((r) => r.shotId)).toEqual(['shot-3', 'shot-4']);
  });

  it('withholds a preview for an unknown label even when source rows match', () => {
    const { data, session } = previewDataset();
    data.shots.push(makeShot({ sessionId: session.id, recordedClub: '?' }));
    expect(assignmentPreview(data, session.id, '?').rows).toEqual([]);
  });

  it('marks stale assignments as needs-review in the label the shot was corrected into', () => {
    const { data, session } = previewDataset();
    const pw = assignmentPreview(data, session.id, 'PW');
    expect(pw.rows.map((r) => r.shotId)).toEqual(['shot-5']);
    expect(pw.rows[0]?.status).toBe('needs-review');
    expect(pw.rows[0]?.assignment).toEqual({
      shotId: 'shot-5',
      equipmentId: 'eq-7i',
      clubLabel: '7i',
    });
    expect(pw.needsReview).toBe(1);
    expect(pw.unassigned).toBe(0);
  });
});

describe('label equipment summaries', () => {
  it('counts assignments on the supplied cohort and distinguishes mixed physical clubs', () => {
    const live = makeSession({ id: 's-live' });
    const archived = makeSession({ id: 's-old', archived: true });
    const clubA = makeEquipment({
      id: 'eq-a',
      inrangeLabel: '7i',
      name: 'Primary 7i',
    });
    const clubB = makeEquipment({
      id: 'eq-b',
      inrangeLabel: '7i',
      name: 'Backup 7i',
      status: 'retired',
    });
    const data: Dataset = {
      ...emptyDataset,
      sessions: [live, archived],
      shots: [
        makeShot({ id: 'shot-1', sessionId: live.id, recordedClub: '7i' }),
        makeShot({ id: 'shot-2', sessionId: live.id, recordedClub: '7i' }),
        makeShot({ id: 'shot-3', sessionId: live.id, recordedClub: 'SW' }),
        makeShot({ id: 'shot-4', sessionId: archived.id, recordedClub: '7i' }),
      ],
      equipment: [clubA, clubB],
      equipmentAssignments: [
        { shotId: 'shot-1', equipmentId: clubA.id, clubLabel: '7i' },
        { shotId: 'shot-2', equipmentId: clubB.id, clubLabel: '7i' },
        { shotId: 'shot-4', equipmentId: clubA.id, clubLabel: '7i' },
      ],
    };
    const summarizeEquipment = equipmentByCohort(data);
    const all = summarizeEquipment(
      data.shots.filter(
        (shot) => shot.sessionId === live.id && shot.recordedClub === '7i',
      ),
    );
    expect(all.shots).toBe(2);
    expect(all).toMatchObject({
      assigned: 2,
      current: 2,
      needsReview: 0,
      unassigned: 0,
      coverage: 'mixed',
    });
    expect(all.equipment.map((e) => [e.name, e.status, e.shots])).toEqual([
      ['Primary 7i', 'in-bag', 1],
      ['Backup 7i', 'retired', 1],
    ]);
    const archivedScoped = summarizeEquipment(
      data.shots.filter((shot) => shot.sessionId === archived.id),
    );
    expect(archivedScoped).toMatchObject({
      shots: 1,
      assigned: 1,
      coverage: 'known',
    });
    expect(
      summarizeEquipment(
        data.shots.filter((shot) => shot.recordedClub === 'SW'),
      ),
    ).toMatchObject({
      shots: 1,
      assigned: 0,
      coverage: 'unknown',
    });
  });
});
