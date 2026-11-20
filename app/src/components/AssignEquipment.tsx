import { useEffect, useMemo, useRef, useState } from 'react';
import type { Repository } from '../data/contracts';
import { sessionIdentity } from '../domain/clubCorrection';
import {
  assignmentPreview,
  coverageCounts,
  isEquipmentConflict,
  sessionEquipmentGroups,
  sortEquipment,
  type AssignmentPreview,
} from '../domain/equipment';
import { type Dataset, type Equipment, type Session } from '../domain/model';

type Draft = {
  clubLabel: string;
  firstRow: string;
  lastRow: string;
  equipmentId: string;
};

type Preview = AssignmentPreview & {
  equipmentId: string | null;
  equipmentName: string | null;
};

const PREVIEW_PAGE_SIZE = 50;

/**
 * Assign equipment in Session Details: pick an effective club label group, an
 * optional inclusive source-row range, and a physical club (retired clubs stay
 * available for historical use) or Clear assignment. The preview pins the
 * dataset version and the exact shot list; one confirmation applies them as a
 * group through repository.assignEquipment.
 */
export function AssignEquipment({
  data,
  repository,
  refresh,
  session,
}: {
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
  session: Session;
}) {
  const [draft, setDraft] = useState<Draft>({
    clubLabel: '',
    firstRow: '',
    lastRow: '',
    equipmentId: '',
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const previewWasOpen = useRef(false);

  const groups = useMemo(
    () => sessionEquipmentGroups(data, session.id),
    [data, session.id],
  );
  const coverage = useMemo(() => coverageCounts(groups), [groups]);
  const equipmentNames = useMemo(
    () => new Map(data.equipment.map((club) => [club.id, club.name])),
    [data.equipment],
  );
  const pageStart = previewPage * PREVIEW_PAGE_SIZE;
  const pageEnd = Math.min(preview?.total ?? 0, pageStart + PREVIEW_PAGE_SIZE);
  const group = groups.find((g) => g.club === draft.clubLabel);
  const bagClubs = useMemo(
    () =>
      sortEquipment(
        data.equipment.filter(
          (club) => club.inrangeLabel.trim() === draft.clubLabel.trim(),
        ),
      ),
    [data.equipment, draft.clubLabel],
  );
  const busy = pending;
  const locked = busy || preview !== null;
  const canPreview = Boolean(
    group &&
    (draft.equipmentId === 'clear' ||
      bagClubs.some((club) => club.id === draft.equipmentId)),
  );

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
    else if (previewWasOpen.current) previewButton.current?.focus();
    previewWasOpen.current = preview !== null;
  }, [preview]);

  function patch(changes: Partial<Draft>) {
    setDraft((old) => ({ ...old, ...changes }));
  }
  function changeLabel(clubLabel: string) {
    setDraft((old) => ({
      ...old,
      clubLabel,
      equipmentId: '',
    }));
    setPreview(null);
    setError('');
    setStatus('');
  }
  function parseRange():
    { firstRow: number | null; lastRow: number | null } | { error: string } {
    const parse = (value: string): number | null | undefined => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      return Number.isInteger(n) && n >= 1 ? n : undefined;
    };
    const firstRow = parse(draft.firstRow);
    const lastRow = parse(draft.lastRow);
    if (firstRow === undefined || lastRow === undefined)
      return { error: 'Source rows must be whole numbers of 1 or more.' };
    if (firstRow !== null && lastRow !== null && firstRow > lastRow)
      return {
        error:
          'First source row must be the same as or before Last source row.',
      };
    return { firstRow, lastRow };
  }
  function startPreview() {
    if (locked || !group || !canPreview) return;
    const range = parseRange();
    if ('error' in range) {
      setError(range.error);
      return;
    }
    setError('');
    setStatus('');
    const built = assignmentPreview(data, session.id, group.club, range);
    const equipmentId =
      draft.equipmentId === 'clear' ? null : draft.equipmentId;
    setPreviewPage(0);
    setPreview({
      ...built,
      equipmentId,
      equipmentName: equipmentId
        ? (equipmentNames.get(equipmentId) ?? null)
        : null,
    });
  }
  function revise() {
    if (busy) return;
    setPreview(null);
    setError('');
  }
  async function confirm() {
    if (busy || !preview) return;
    setPending(true);
    setError('');
    setStatus('');
    try {
      await repository.assignEquipment({
        expectedVersion: preview.expectedVersion,
        sessionId: preview.sessionId,
        clubLabel: preview.clubLabel,
        equipmentId: preview.equipmentId,
        shotIds: preview.rows.map((row) => row.shotId),
      });
      await refresh();
      setStatus(
        `${preview.equipmentId ? `Assigned ${preview.equipmentName} to` : 'Cleared equipment for'} ${preview.rows.length} shot${preview.rows.length === 1 ? '' : 's'} with label ${preview.clubLabel}.`,
      );
      setPreview(null);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : 'Could not save the assignment. Your choices are still here.';
      if (isEquipmentConflict(e)) {
        // The pinned version and list are stale: require a fresh preview, but
        // keep the draft so nothing entered is lost.
        await refresh();
        setPreview(null);
        setError(
          `${message} The dataset changed, so this preview is stale — choose Preview assignment again before confirming.`,
        );
      } else {
        setError(message);
      }
    }
    setPending(false);
  }

  const needsReviewRows =
    group?.rows.filter((r) => r.status === 'needs-review') ?? [];
  const rangeText = preview
    ? preview.firstRow !== null || preview.lastRow !== null
      ? `source rows ${preview.firstRow ?? 1}–${preview.lastRow ?? 'end'}`
      : 'all source rows'
    : null;

  return (
    <section
      className="assign-equipment"
      aria-labelledby="assign-equipment-heading"
    >
      <h3 id="assign-equipment-heading" tabIndex={-1}>
        Assign equipment
      </h3>
      <p>
        Assign a physical club from your bag to the shots of one effective club
        label, or clear the assignment. Use a source-row range for a mid-session
        swap. Assignments never change the original import, row order,
        measurements, or review decisions, and they stay separate from intent,
        contact, and exclusion. Old and backdated imports start unknown until
        you confirm them here.
      </p>
      <p className="muted">
        Equipment coverage: {coverage.known} known, {coverage.mixed} mixed,{' '}
        {coverage.unknown} unknown label{groups.length === 1 ? '' : 's'} ·{' '}
        {coverage.needsReview} shot{coverage.needsReview === 1 ? '' : 's'} need
        review
      </p>
      <div className="form-grid">
        <label>
          Club label
          <select
            value={draft.clubLabel}
            disabled={locked || groups.length === 0}
            onChange={(e) => changeLabel(e.target.value)}
          >
            <option value="">Choose a club label</option>
            {groups.map((g) => (
              <option key={g.club} value={g.club}>
                {g.club} · {g.total} shot{g.total === 1 ? '' : 's'} ·{' '}
                {g.coverage}
                {g.needsReview > 0 ? ` · ${g.needsReview} need review` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          First source row
          <input
            type="number"
            min="1"
            inputMode="numeric"
            disabled={locked}
            value={draft.firstRow}
            onChange={(e) => patch({ firstRow: e.target.value })}
          />
        </label>
        <label>
          Last source row
          <input
            type="number"
            min="1"
            inputMode="numeric"
            disabled={locked}
            value={draft.lastRow}
            onChange={(e) => patch({ lastRow: e.target.value })}
          />
        </label>
        <label>
          Physical club
          <select
            value={draft.equipmentId}
            disabled={locked || !group}
            onChange={(e) => patch({ equipmentId: e.target.value })}
          >
            <option value="">Choose equipment</option>
            <option value="clear">Clear assignment</option>
            {bagClubs.map((club: Equipment) => (
              <option key={club.id} value={club.id}>
                {club.name} ({club.status === 'retired' ? 'retired' : 'in bag'})
              </option>
            ))}
          </select>
        </label>
      </div>
      {group && (
        <p className="muted">
          {group.club}: {group.total} shot{group.total === 1 ? '' : 's'} · rows{' '}
          {group.rows[0]?.rowIndex}–{group.rows.at(-1)?.rowIndex} ·{' '}
          {group.assigned} assigned ({group.current} current) ·{' '}
          {group.unassigned} unassigned · coverage {group.coverage}
        </p>
      )}
      {group && bagClubs.length === 0 && (
        <p className="notice">
          No physical club in your bag has the label {group.club}. Add one in{' '}
          <a href="#clubs">Manage bag</a> to assign it; clearing still works.
        </p>
      )}
      {needsReviewRows.length > 0 && (
        <div className="needs-review">
          <p>
            <span className="pill">Needs review</span> {needsReviewRows.length}{' '}
            shot{needsReviewRows.length === 1 ? '' : 's'} where a later club
            correction conflicts with the saved assignment. The previous
            association is retained until you confirm the new label's equipment;
            undoing the correction restores compatibility.
          </p>
          <ul>
            {needsReviewRows.map((row) => (
              <li key={row.shotId}>
                Row {row.rowIndex} · Shot #{row.sourceNumber || '—'} ·{' '}
                {row.assignment &&
                  (equipmentNames.get(row.assignment.equipmentId) ??
                    'Unknown club')}{' '}
                ({row.assignment?.clubLabel}) · Effective label{' '}
                <strong>{row.effectiveClub}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button
          ref={previewButton}
          disabled={locked || !canPreview}
          onClick={startPreview}
        >
          Preview assignment
        </button>
      </div>
      {pending && (
        <p role="status" className="notice">
          Saving assignment…
        </p>
      )}
      {!pending && status && (
        <p role="status" className="notice">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <section className="assignment-preview" aria-label="Assignment preview">
          <h4 ref={previewHeading} tabIndex={-1}>
            Assignment preview
          </h4>
          <p>
            <strong>{sessionIdentity(session)}</strong>
          </p>
          <p>
            Club label <strong>{preview.clubLabel}</strong> · {rangeText} ·
            {preview.equipmentId
              ? `will assign ${preview.equipmentName ?? 'the selected club'}`
              : 'will clear the assignment'}{' '}
            for {preview.total} shot{preview.total === 1 ? '' : 's'}.
          </p>
          <p className="muted">
            {preview.current} current · {preview.needsReview} need review ·{' '}
            {preview.unassigned} unassigned in this selection.
          </p>
          {preview.rows.length === 0 ? (
            <p className="notice">
              No shots match this label and source-row range.
            </p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Exact shots in this assignment preview">
                <thead>
                  <tr>
                    <th>Source row</th>
                    <th>Shot #</th>
                    <th>Recorded</th>
                    <th>Effective</th>
                    <th>Current equipment</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(pageStart, pageEnd).map((row) => (
                    <tr key={row.shotId}>
                      <td>{row.rowIndex}</td>
                      <td>{row.sourceNumber || '—'}</td>
                      <td>{row.recordedClub}</td>
                      <td>{row.effectiveClub}</td>
                      <td>
                        {row.assignment
                          ? `${equipmentNames.get(row.assignment.equipmentId) ?? 'Unknown club'} · label ${row.assignment.clubLabel}`
                          : 'Unassigned'}
                      </td>
                      <td>
                        {row.status === 'current'
                          ? 'Current'
                          : row.status === 'needs-review'
                            ? 'Needs review'
                            : 'Unassigned'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.total > PREVIEW_PAGE_SIZE && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={busy || previewPage === 0}
                onClick={() => setPreviewPage(previewPage - 1)}
              >
                Previous preview page
              </button>
              <span role="status">
                Shots {pageStart + 1}–{pageEnd} of {preview.total}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={busy || pageEnd >= preview.total}
                onClick={() => setPreviewPage(previewPage + 1)}
              >
                Next preview page
              </button>
            </div>
          )}
          <div className="actions">
            <button
              disabled={busy || preview.rows.length === 0}
              onClick={() => void confirm()}
            >
              Confirm assignment
            </button>
            <button className="secondary" disabled={busy} onClick={revise}>
              Revise
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
