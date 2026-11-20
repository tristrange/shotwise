import {
  clubOrder,
  effectiveClub,
  equipmentSaveInputSchema,
  isUnknownClub,
  type Dataset,
  type Equipment,
  type EquipmentAssignment,
  type EquipmentSaveInput,
  type EquipmentStatus,
  type Session,
  type Shot,
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
    error.message.startsWith('This record changed on another device.')
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

/** Per-shot assignment state derived from the loaded snapshot. */
export type AssignmentStatus = 'unassigned' | 'current' | 'needs-review';

/**
 * A saved assignment is current while the shot's effective club still matches
 * the label pinned at confirmation; a later club correction makes it stale and
 * it is retained for repair as needs-review.
 */
export function assignmentStatus(
  shot: Shot,
  assignment: EquipmentAssignment | null | undefined,
): AssignmentStatus {
  if (!assignment) return 'unassigned';
  return assignment.clubLabel.trim() === effectiveClub(shot).trim()
    ? 'current'
    : 'needs-review';
}

export type AssignmentRow = {
  shotId: string;
  rowIndex: number;
  sourceNumber: string;
  recordedClub: string;
  effectiveClub: string;
  /** The retained assignment, if any; it survives later club corrections. */
  assignment: EquipmentAssignment | null;
  status: AssignmentStatus;
};

function toRow(
  shot: Shot,
  assignmentByShot: Map<string, EquipmentAssignment>,
): AssignmentRow {
  const assignment = assignmentByShot.get(shot.id) ?? null;
  return {
    shotId: shot.id,
    rowIndex: shot.rowIndex,
    sourceNumber: shot.sourceNumber,
    recordedClub: shot.recordedClub,
    effectiveClub: effectiveClub(shot),
    assignment,
    status: assignmentStatus(shot, assignment),
  };
}

/** Equipment coverage of a shot set: known, mixed, or unknown. */
export type EquipmentCoverage = 'known' | 'mixed' | 'unknown';

function coverageOf(counts: {
  total: number;
  current: number;
  needsReview: number;
  physicalClubs: number;
}): EquipmentCoverage {
  if (counts.current + counts.needsReview === 0) return 'unknown';
  if (counts.current === counts.total && counts.physicalClubs === 1)
    return 'known';
  return 'mixed';
}

export type SessionEquipmentGroup = {
  /** Effective club label; reported as recorded. */
  club: string;
  /** Every session shot with this effective label, in source-row order. */
  rows: AssignmentRow[];
  total: number;
  assigned: number;
  current: number;
  needsReview: number;
  unassigned: number;
  coverage: EquipmentCoverage;
};

/**
 * Effective-club-label groups of one session, derived only from the loaded
 * snapshot. Assignment is independent of intent, contact, and exclusion, so
 * every shot of the session is included regardless of those reviews; unknown
 * labels and labels too long for the assignment contract are not assignable.
 */
export function sessionEquipmentGroups(
  data: Dataset,
  sessionId: string,
): SessionEquipmentGroup[] {
  const assignmentByShot = new Map(
    data.equipmentAssignments.map((a) => [a.shotId, a]),
  );
  const byClub = new Map<string, AssignmentRow[]>();
  for (const shot of data.shots) {
    if (shot.sessionId !== sessionId) continue;
    const club = effectiveClub(shot);
    if (isUnknownClub(club) || club.trim().length > 30) continue;
    const rows = byClub.get(club) ?? [];
    rows.push(toRow(shot, assignmentByShot));
    byClub.set(club, rows);
  }
  return [...byClub.entries()]
    .map(([club, rows]) => {
      rows.sort(
        (a, b) => a.rowIndex - b.rowIndex || a.shotId.localeCompare(b.shotId),
      );
      const current = rows.filter((r) => r.status === 'current').length;
      const needsReview = rows.filter(
        (r) => r.status === 'needs-review',
      ).length;
      return {
        club,
        rows,
        total: rows.length,
        assigned: current + needsReview,
        current,
        needsReview,
        unassigned: rows.length - current - needsReview,
        coverage: coverageOf({
          total: rows.length,
          current,
          needsReview,
          physicalClubs: new Set(
            rows.flatMap((row) =>
              row.assignment ? [row.assignment.equipmentId] : [],
            ),
          ).size,
        }),
      };
    })
    .sort(
      (a, b) =>
        clubOrder(a.club) - clubOrder(b.club) || a.club.localeCompare(b.club),
    );
}

/** Group counts by coverage plus the total needs-review shots. */
export function coverageCounts(groups: SessionEquipmentGroup[]): {
  known: number;
  mixed: number;
  unknown: number;
  needsReview: number;
} {
  return {
    known: groups.filter((g) => g.coverage === 'known').length,
    mixed: groups.filter((g) => g.coverage === 'mixed').length,
    unknown: groups.filter((g) => g.coverage === 'unknown').length,
    needsReview: groups.reduce((n, g) => n + g.needsReview, 0),
  };
}

export type AssignmentPreview = {
  /** Dataset version pinned when the preview was built. */
  expectedVersion: number;
  sessionId: string;
  clubLabel: string;
  /** Inclusive source-row bounds; null means the whole group. */
  firstRow: number | null;
  lastRow: number | null;
  /** Exact rows in source-row order; these shot IDs are confirmed as one list. */
  rows: AssignmentRow[];
  total: number;
  assigned: number;
  current: number;
  needsReview: number;
  unassigned: number;
};

/**
 * Build the exact preview for one effective-label group, optionally narrowed
 * to an inclusive source-row range for a mid-session swap. The dataset version
 * and the exact shot list are pinned here; confirmation sends them unchanged
 * and the repository rejects the write when the version moved.
 */
export function assignmentPreview(
  data: Dataset,
  sessionId: string,
  clubLabel: string,
  range?: { firstRow?: number | null; lastRow?: number | null },
): AssignmentPreview {
  const label = clubLabel.trim();
  const firstRow = range?.firstRow ?? null;
  const lastRow = range?.lastRow ?? null;
  const assignmentByShot = new Map(
    data.equipmentAssignments.map((a) => [a.shotId, a]),
  );
  const rows = data.shots
    .filter(
      (shot) =>
        shot.sessionId === sessionId && effectiveClub(shot).trim() === label,
    )
    .filter(
      (shot) =>
        (firstRow === null || shot.rowIndex >= firstRow) &&
        (lastRow === null || shot.rowIndex <= lastRow),
    )
    .map((shot) => toRow(shot, assignmentByShot))
    .sort(
      (a, b) => a.rowIndex - b.rowIndex || a.shotId.localeCompare(b.shotId),
    );
  const current = rows.filter((r) => r.status === 'current').length;
  const needsReview = rows.filter((r) => r.status === 'needs-review').length;
  return {
    expectedVersion: data.version,
    sessionId,
    clubLabel: label,
    firstRow,
    lastRow,
    rows,
    total: rows.length,
    assigned: current + needsReview,
    current,
    needsReview,
    unassigned: rows.length - current - needsReview,
  };
}

export type LabelEquipmentClub = {
  id: string;
  name: string;
  status: EquipmentStatus;
  shots: number;
  current: number;
  needsReview: number;
};

export type LabelEquipmentSummary = {
  /** Shots with this effective label in the relevant cohort. */
  shots: number;
  assigned: number;
  current: number;
  needsReview: number;
  unassigned: number;
  coverage: EquipmentCoverage;
  /** Physical clubs used on this label; two clubs may share one label. */
  equipment: LabelEquipmentClub[];
};

/** Equipment context for the same shots included in a displayed analysis. */
export function equipmentForShots(
  data: Dataset,
  shots: Shot[],
): LabelEquipmentSummary {
  const assignmentByShot = new Map(
    data.equipmentAssignments.map((a) => [a.shotId, a]),
  );
  const equipmentById = new Map(data.equipment.map((e) => [e.id, e]));
  const clubs = new Map<string, LabelEquipmentClub>();
  let current = 0;
  let needsReview = 0;
  for (const shot of shots) {
    const assignment = assignmentByShot.get(shot.id);
    if (!assignment) continue;
    const club = equipmentById.get(assignment.equipmentId);
    if (!club) continue;
    const isCurrent = assignmentStatus(shot, assignment) === 'current';
    if (isCurrent) current++;
    else needsReview++;
    const entry = clubs.get(assignment.equipmentId) ?? {
      id: assignment.equipmentId,
      name: club.name,
      status: club.status,
      shots: 0,
      current: 0,
      needsReview: 0,
    };
    entry.shots++;
    if (isCurrent) entry.current++;
    else entry.needsReview++;
    clubs.set(assignment.equipmentId, entry);
  }
  const assigned = current + needsReview;
  return {
    shots: shots.length,
    assigned,
    current,
    needsReview,
    unassigned: shots.length - assigned,
    coverage: coverageOf({
      total: shots.length,
      current,
      needsReview,
      physicalClubs: clubs.size,
    }),
    equipment: [...clubs.values()].sort(
      (a, b) =>
        (a.status === 'in-bag' ? 0 : 1) - (b.status === 'in-bag' ? 0 : 1) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    ),
  };
}
