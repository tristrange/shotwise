import {
  clubOrder,
  effectiveClub,
  equipmentSaveInputSchema,
  type Dataset,
  type Equipment,
  type EquipmentSaveInput,
  type EquipmentStatus,
  type Session,
} from './model';

/**
 * Form draft for one physical club. Optional fields stay as entered text and
 * become null only when the draft is converted into a save input.
 */
export type EquipmentDraft = {
  inrangeLabel: string;
  name: string;
  manufacturer: string;
  loft: string;
  status: EquipmentStatus;
  acquiredOn: string;
  retiredOn: string;
};

export function emptyDraft(): EquipmentDraft {
  return {
    inrangeLabel: '',
    name: '',
    manufacturer: '',
    loft: '',
    status: 'in-bag',
    acquiredOn: '',
    retiredOn: '',
  };
}

export function draftFromEquipment(club: Equipment): EquipmentDraft {
  return {
    inrangeLabel: club.inrangeLabel,
    name: club.name,
    manufacturer: club.manufacturer ?? '',
    loft: club.loft ?? '',
    status: club.status,
    acquiredOn: club.acquiredOn ?? '',
    retiredOn: club.retiredOn ?? '',
  };
}

const FIELD_MESSAGES: Record<string, string> = {
  inrangeLabel: 'Enter the exact Inrange label (1–30 characters).',
  name: 'Enter a display name (1–200 characters).',
  manufacturer: 'Manufacturer must be 200 characters or fewer.',
  loft: 'Loft must be 30 characters or fewer.',
  status: 'Choose In bag or Retired.',
  acquiredOn: 'Acquired on must be a valid calendar date.',
  retiredOn: 'Retired on must be a valid calendar date.',
  id: 'This club needs a stable ID. Start the form again.',
  revision: 'This club needs a valid revision. Start the form again.',
};

/**
 * Convert a draft into the validated save input for `save_equipment`.
 * `revision` is null to create and the previously read revision to update.
 * Two clubs may share an Inrange label and overlap in ownership, so no
 * uniqueness or date-ordering rules are applied here.
 */
export function draftToSaveInput(
  draft: EquipmentDraft,
  id: string,
  revision: number | null,
): EquipmentSaveInput {
  const parsed = equipmentSaveInputSchema.safeParse({
    id,
    revision,
    inrangeLabel: draft.inrangeLabel.trim(),
    name: draft.name.trim(),
    manufacturer: draft.manufacturer.trim() || null,
    loft: draft.loft.trim() || null,
    status: draft.status,
    acquiredOn: draft.acquiredOn || null,
    retiredOn: draft.retiredOn || null,
  });
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path[0];
  throw new Error(
    (typeof field === 'string' && FIELD_MESSAGES[field]) ||
      issue?.message ||
      'Check the club details and try again.',
  );
}

/** The repository maps revision conflicts to this message. */
export function isEquipmentConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/another device/i.test(error.message) || /conflict/i.test(error.message))
  );
}

/**
 * Bag order: in-bag clubs first, then by club order of the Inrange label,
 * then display name. Sharing a label is allowed, so the ID keeps the order
 * stable.
 */
export function sortEquipment(list: Equipment[]): Equipment[] {
  return [...list].sort(
    (a, b) =>
      (a.status === 'in-bag' ? 0 : 1) - (b.status === 'in-bag' ? 0 : 1) ||
      clubOrder(a.inrangeLabel) - clubOrder(b.inrangeLabel) ||
      a.inrangeLabel.localeCompare(b.inrangeLabel) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export type EquipmentVisit = {
  session: Session;
  shots: number;
  labels: string[];
  /** Shots whose effective club no longer matches the assigned label. */
  needsReview: number;
};
export type EquipmentHistory = {
  /** Assignments whose shot ID exists in the loaded snapshot. */
  total: number;
  /** Assignments pointing at shots outside the snapshot; kept for repair. */
  unknown: number;
  needsReview: number;
  /** Newest visit first. */
  visits: EquipmentVisit[];
};

/**
 * Per-physical-club assignment history derived from the exact shot IDs in the
 * version-checked snapshot. Retirement and edits never touch assignments, so
 * every confirmed shot keeps pointing at this club.
 */
export function equipmentHistory(
  data: Dataset,
  equipmentId: string,
): EquipmentHistory {
  const shotsById = new Map(data.shots.map((shot) => [shot.id, shot]));
  const sessionsById = new Map(data.sessions.map((s) => [s.id, s]));
  const bySession = new Map<string, EquipmentVisit>();
  let total = 0;
  let unknown = 0;
  let needsReview = 0;
  for (const assignment of data.equipmentAssignments) {
    if (assignment.equipmentId !== equipmentId) continue;
    const shot = shotsById.get(assignment.shotId);
    const session = shot ? sessionsById.get(shot.sessionId) : undefined;
    if (!shot || !session) {
      unknown++;
      continue;
    }
    total++;
    const stale = effectiveClub(shot) !== assignment.clubLabel;
    if (stale) needsReview++;
    const visit = bySession.get(session.id) ?? {
      session,
      shots: 0,
      labels: [],
      needsReview: 0,
    };
    visit.shots++;
    if (!visit.labels.includes(assignment.clubLabel))
      visit.labels.push(assignment.clubLabel);
    if (stale) visit.needsReview++;
    bySession.set(session.id, visit);
  }
  const visits = [...bySession.values()].sort(
    (a, b) =>
      b.session.date.localeCompare(a.session.date) ||
      (b.session.time ?? '').localeCompare(a.session.time ?? '') ||
      b.session.id.localeCompare(a.session.id),
  );
  return { total, unknown, needsReview, visits };
}
