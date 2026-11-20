import { describe, expect, it } from 'vitest';
import { makeEquipment, makeSession, makeShot } from './fixtures';
import {
  draftFromEquipment,
  draftToSaveInput,
  emptyDraft,
  equipmentHistory,
  isEquipmentConflict,
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
  it('recognises the repository revision-conflict message and raw conflict errors', () => {
    expect(
      isEquipmentConflict(
        new Error(
          'This record changed on another device. Refresh before saving again. Your input has been kept.',
        ),
      ),
    ).toBe(true);
    expect(isEquipmentConflict(new Error('Equipment conflict'))).toBe(true);
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
