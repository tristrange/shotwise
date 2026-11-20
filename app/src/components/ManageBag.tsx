import { useMemo, useRef, useState, type Ref } from 'react';
import type { Repository } from '../data/contracts';
import {
  draftFromEquipment,
  draftToSaveInput,
  emptyDraft,
  equipmentHistory,
  isEquipmentConflict,
  sortEquipment,
  type EquipmentDraft,
  type EquipmentHistory,
} from '../domain/equipment';
import {
  type Dataset,
  type Equipment,
  type EquipmentStatus,
} from '../domain/model';
import { clubHref } from './ClubProfiles';
import { sessionHref, visitLabel } from './SessionRecap';

function BagItem({
  club,
  history,
  onEdit,
  disabled,
}: {
  club: Equipment;
  history: EquipmentHistory;
  onEdit: (club: Equipment) => void;
  disabled: boolean;
}) {
  const details = [club.manufacturer, club.loft && `Loft ${club.loft}`].filter(
    Boolean,
  );
  const dates = [
    club.acquiredOn && `Acquired on ${club.acquiredOn}`,
    club.retiredOn && `Retired on ${club.retiredOn}`,
  ].filter(Boolean);
  return (
    <li className="bag-item">
      <div className="bag-row">
        <div className="bag-meta" id={`bag-meta-${club.id}`}>
          <strong>{club.name}</strong>
          <span>
            Inrange label:{' '}
            <a href={clubHref(club.inrangeLabel)}>{club.inrangeLabel}</a> ·{' '}
            {club.status === 'in-bag' ? 'In bag' : 'Retired'}
          </span>
          {details.length > 0 && <span>{details.join(' · ')}</span>}
          <span>
            {dates.length > 0 ? dates.join(' · ') : 'No dates recorded'}
          </span>
          <span>
            {history.total} assigned {history.total === 1 ? 'shot' : 'shots'}
            {history.needsReview > 0 && ` · ${history.needsReview} need review`}
          </span>
        </div>
        <button
          className="secondary"
          aria-describedby={`bag-meta-${club.id}`}
          disabled={disabled}
          onClick={() => onEdit(club)}
        >
          Edit {club.name}
        </button>
      </div>
      {history.visits.length > 0 && (
        <div className="table-wrap bag-history">
          <table aria-label={`Assignment history for ${club.name}`}>
            <caption>
              {history.total} assigned {history.total === 1 ? 'shot' : 'shots'}{' '}
              across {history.visits.length}{' '}
              {history.visits.length === 1 ? 'visit' : 'visits'}
            </caption>
            <thead>
              <tr>
                <th>Visit</th>
                <th>Shots</th>
                <th>Club label</th>
                <th>Needs review</th>
              </tr>
            </thead>
            <tbody>
              {history.visits.map((visit) => (
                <tr key={visit.session.id}>
                  <td>
                    <a href={sessionHref(visit.session.id)}>
                      {visitLabel(visit.session)}
                    </a>
                    {visit.session.venue && ` · ${visit.session.venue}`}
                    {visit.session.archived && ' · archived'}
                  </td>
                  <td>{visit.shots}</td>
                  <td>{visit.labels.join(', ')}</td>
                  <td>{visit.needsReview > 0 ? visit.needsReview : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

export function ManageBag({
  data,
  repository,
  refresh,
  headingRef,
}: {
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const [formId, setFormId] = useState<string | null>(null);
  const [baselineRevision, setBaselineRevision] = useState<number | null>(null);
  const [draft, setDraft] = useState<EquipmentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Equipment | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  const clubs = useMemo(
    () =>
      sortEquipment(data.equipment).map((club) => ({
        club,
        history: equipmentHistory(data, club.id),
      })),
    [data],
  );
  const formOpen = draft !== null;

  function startNew() {
    setFormId(crypto.randomUUID());
    setBaselineRevision(null);
    setDraft(emptyDraft());
    setError('');
    setConflict(null);
  }
  function startEdit(club: Equipment) {
    setFormId(club.id);
    setBaselineRevision(club.revision);
    setDraft(draftFromEquipment(club));
    setError('');
    setConflict(null);
  }
  function closeForm() {
    setFormId(null);
    setBaselineRevision(null);
    setDraft(null);
    setError('');
    setConflict(null);
  }
  function patch(changes: Partial<EquipmentDraft>) {
    setDraft((old) => (old ? { ...old, ...changes } : old));
  }

  async function save() {
    if (!draft || formId === null || busy) return;
    setBusy(true);
    setError('');
    try {
      await repository.saveEquipment(
        draftToSaveInput(draft, formId, baselineRevision),
      );
      await refresh();
      closeForm();
    } catch (e) {
      // The draft stays in the form so nothing the user entered is lost.
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save the club. Refresh and try again.',
      );
      if (isEquipmentConflict(e)) {
        try {
          const current = await repository.load();
          setConflict(
            current.equipment.find((item) => item.id === formId) ?? null,
          );
        } catch {
          setConflict(null);
        }
      }
    }
    setBusy(false);
  }

  return (
    <section className="panel" aria-labelledby="manage-bag">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Your physical clubs</span>
          <h2 id="manage-bag" ref={headingRef} tabIndex={-1}>
            Manage bag
          </h2>
          <p className="context">
            {clubs.length} {clubs.length === 1 ? 'club' : 'clubs'} · assignments
            follow the physical club
          </p>
        </div>
        <div className="card-controls">
          <button onClick={startNew} disabled={formOpen || busy}>
            Add club
          </button>
        </div>
      </div>
      <p>
        Register each physical club in your bag. Two clubs may share an Inrange
        label and overlap in ownership. Editing or retiring a club keeps its
        recorded shot assignments, so history stays intact.
      </p>
      {formOpen && draft && (
        <form
          className="bag-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="form-grid">
            <label>
              Inrange label
              <input
                required
                maxLength={30}
                value={draft.inrangeLabel}
                disabled={busy}
                onChange={(e) => patch({ inrangeLabel: e.target.value })}
              />
            </label>
            <label>
              Display name
              <input
                required
                maxLength={200}
                value={draft.name}
                disabled={busy}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              Manufacturer
              <input
                maxLength={200}
                value={draft.manufacturer}
                disabled={busy}
                onChange={(e) => patch({ manufacturer: e.target.value })}
              />
            </label>
            <label>
              Loft
              <input
                maxLength={30}
                value={draft.loft}
                disabled={busy}
                onChange={(e) => patch({ loft: e.target.value })}
              />
            </label>
            <label>
              Status
              <select
                value={draft.status}
                disabled={busy}
                onChange={(e) =>
                  patch({ status: e.target.value as EquipmentStatus })
                }
              >
                <option value="in-bag">In bag</option>
                <option value="retired">Retired</option>
              </select>
            </label>
            <label>
              Acquired on
              <input
                type="date"
                value={draft.acquiredOn}
                disabled={busy}
                onChange={(e) => patch({ acquiredOn: e.target.value })}
              />
            </label>
            <label>
              Retired on
              <input
                type="date"
                value={draft.retiredOn}
                disabled={busy}
                onChange={(e) => patch({ retiredOn: e.target.value })}
              />
            </label>
          </div>
          <div className="actions">
            <button type="submit" ref={saveButton} disabled={busy}>
              {busy ? 'Saving…' : 'Save club'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={closeForm}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {conflict && (
            <div className="notice">
              <p>
                This club was changed on another device, so the save was
                rejected and your entered values are still in the form. Latest
                saved: {conflict.name} · {conflict.inrangeLabel} · revision{' '}
                {conflict.revision}.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBaselineRevision(conflict.revision);
                  setConflict(null);
                  setError('');
                  saveButton.current?.focus();
                }}
              >
                Use latest revision
              </button>
            </div>
          )}
        </form>
      )}
      {clubs.length === 0 && !formOpen && (
        <p>
          No clubs in your bag yet. Add your first club to track which physical
          club hit each shot.
        </p>
      )}
      <ul className="bag-list">
        {clubs.map(({ club, history }) => (
          <BagItem
            key={club.id}
            club={club}
            history={history}
            onEdit={startEdit}
            disabled={formOpen || busy}
          />
        ))}
      </ul>
    </section>
  );
}
