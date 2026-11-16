import { useState } from 'react';
import { parseCsv, suggestDate, type CsvPreview } from '../domain/csv';
import { dateSchema, type Dataset, type Session } from '../domain/model';
import type { Repository } from '../data/contracts';
import { ShotReview } from './ShotReview';

type Preview = {
  id: number;
  filename: string;
  preview: CsvPreview | null;
  date: string;
  time: string;
  venue: string;
  notes: string;
  confirmed: boolean;
  confirmedFull: boolean;
  allowSameDay: boolean;
  result: string;
};
export function Sessions({
  data,
  repository,
  refresh,
}: {
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
}) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const session = data.sessions.find((s) => s.id === selected);
  async function filesChosen(files: File[]) {
    setBusy(true);
    const next: Preview[] = [];
    for (const [i, file] of files.entries()) {
      try {
        const preview = await parseCsv(
          new Uint8Array(await file.arrayBuffer()),
        );
        next.push({
          id: Date.now() + i,
          filename: file.name,
          preview,
          date: suggestDate(file.name),
          time: '',
          venue: '',
          notes: '',
          confirmed: false,
          confirmedFull: false,
          allowSameDay: false,
          result: '',
        });
      } catch (e) {
        next.push({
          id: Date.now() + i,
          filename: file.name,
          preview: null,
          date: '',
          time: '',
          venue: '',
          notes: '',
          confirmed: false,
          confirmedFull: false,
          allowSameDay: false,
          result: e instanceof Error ? e.message : 'Could not read file',
        });
      }
    }
    setPreviews((old) => [...old, ...next]);
    setBusy(false);
  }
  function patch(id: number, changes: Partial<Preview>) {
    setPreviews((old) =>
      old.map((p) => (p.id === id ? { ...p, ...changes } : p)),
    );
  }
  async function importAll() {
    setBusy(true);
    for (const p of previews) {
      if (
        !p.preview ||
        p.result.startsWith('Imported') ||
        p.result.startsWith('Duplicate')
      )
        continue;
      if (!p.confirmed || !dateSchema.safeParse(p.date).success) {
        patch(p.id, {
          result: 'Confirm a valid session date before importing.',
        });
        continue;
      }
      try {
        const result = await repository.importCsv({
          filename: p.filename,
          date: p.date,
          time: p.time || null,
          venue: p.venue,
          notes: p.notes,
          confirmedFull: p.confirmedFull,
          allowSameDay: p.allowSameDay,
          preview: p.preview,
        });
        patch(p.id, {
          result: result.duplicate
            ? 'Duplicate export — already imported.'
            : 'Imported successfully.',
        });
        await refresh();
      } catch (e) {
        patch(p.id, {
          result: e instanceof Error ? e.message : 'Import failed. Try again.',
        });
      }
    }
    setBusy(false);
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Practice log</span>
          <h1>Sessions & import</h1>
          <p>Bring your range exports together, one session at a time.</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Add shots</span>
            <h2>Import CSV files</h2>
          </div>
        </div>
        <p>
          Choose one or more Inrange CSV exports. Review each date before
          importing.
        </p>
        <label className="file-button">
          Choose CSV files
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            disabled={busy}
            onChange={(e) => {
              void filesChosen(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </label>
        {previews.map((p) => (
          <div className="preview" key={p.id}>
            <div className="panel-heading">
              <div>
                <h3>{p.filename}</h3>
                {p.preview && (
                  <p>
                    {p.preview.shots.length} shots ·{' '}
                    {Object.entries(
                      p.preview.shots.reduce<Record<string, number>>(
                        (a, s) => ({
                          ...a,
                          [s.recordedClub]: (a[s.recordedClub] ?? 0) + 1,
                        }),
                        {},
                      ),
                    )
                      .map(([c, n]) => `${c}: ${n}`)
                      .join(', ')}{' '}
                    · {p.preview.warnings.length} warnings
                  </p>
                )}
              </div>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  setPreviews((old) => old.filter((x) => x.id !== p.id))
                }
              >
                Remove
              </button>
            </div>
            {p.preview && (
              <>
                <div className="form-grid">
                  <label>
                    Session date
                    <input
                      type="date"
                      value={p.date}
                      onChange={(e) =>
                        patch(p.id, { date: e.target.value, confirmed: false })
                      }
                    />
                  </label>
                  <label>
                    Time (optional)
                    <input
                      type="time"
                      value={p.time}
                      onChange={(e) => patch(p.id, { time: e.target.value })}
                    />
                  </label>
                  <label>
                    Venue
                    <input
                      value={p.venue}
                      onChange={(e) => patch(p.id, { venue: e.target.value })}
                    />
                  </label>
                  <label>
                    Notes
                    <input
                      value={p.notes}
                      onChange={(e) => patch(p.id, { notes: e.target.value })}
                    />
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={p.confirmed}
                    onChange={(e) =>
                      patch(p.id, { confirmed: e.target.checked })
                    }
                  />{' '}
                  I confirm this session date
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={p.confirmedFull}
                    onChange={(e) =>
                      patch(p.id, { confirmedFull: e.target.checked })
                    }
                  />{' '}
                  Mark non-wedge shots as full swings. Wedge intent stays
                  unknown.
                </label>
                {data.sessions.some((s) => s.date === p.date) && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={p.allowSameDay}
                      onChange={(e) =>
                        patch(p.id, { allowSameDay: e.target.checked })
                      }
                    />{' '}
                    I acknowledge another session exists on this date
                  </label>
                )}
                {p.preview.warnings.length > 0 && (
                  <details>
                    <summary>
                      View import warnings ({p.preview.warnings.length})
                    </summary>
                    <ul>
                      {p.preview.warnings.map((w, i) => (
                        <li key={i}>
                          Row {w.row}, {w.field}: {w.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <details>
                  <summary>Inspect preview rows</summary>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Source row</th>
                          <th>Shot #</th>
                          <th>Club</th>
                          <th>Range carry</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.preview.shots.map((s) => (
                          <tr key={s.rowIndex}>
                            <td>{s.rowIndex}</td>
                            <td>{s.sourceNumber}</td>
                            <td>{s.recordedClub}</td>
                            <td>{s.measurements.carryRange ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
            {p.result && (
              <p role="status" className="notice">
                {p.result}
              </p>
            )}
          </div>
        ))}
        {previews.length > 0 && (
          <button disabled={busy} onClick={() => void importAll()}>
            Import valid files
          </button>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Logbook</span>
            <h2>Sessions</h2>
          </div>
          <span className="pill">{data.sessions.length} total</span>
        </div>
        {data.sessions.length === 0 ? (
          <p>No sessions yet. Import a CSV above to begin.</p>
        ) : (
          <div className="session-list">
            {[...data.sessions]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((s) => (
                <button
                  className={`session-row ${selected === s.id ? 'active' : ''}`}
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                >
                  <span>
                    <strong>{s.date}</strong>
                    <small>
                      {s.venue || s.filename} {s.archived && '· Archived'}
                    </small>
                  </span>
                  <span>
                    {data.shots.filter((x) => x.sessionId === s.id).length}{' '}
                    shots →
                  </span>
                </button>
              ))}
          </div>
        )}
      </section>
      {session && (
        <SessionDetail
          key={session.id}
          session={session}
          data={data}
          repository={repository}
          refresh={refresh}
          error={error}
          setError={setError}
        />
      )}
    </>
  );
}
function SessionDetail({
  session,
  data,
  repository,
  refresh,
  error,
  setError,
}: {
  session: Session;
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
  error: string;
  setError: (s: string) => void;
}) {
  const [draft, setDraft] = useState(session);
  const [baseline, setBaseline] = useState(session);
  const [conflict, setConflict] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(next: Session) {
    setBusy(true);
    setError('');
    try {
      await repository.updateSession(next);
      await refresh();
      setDraft({ ...next, revision: next.revision + 1 });
      setBaseline({ ...next, revision: next.revision + 1 });
      setConflict(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save session. Refresh and try again.',
      );
      if (e instanceof Error && e.message.includes('another device')) {
        try {
          const current = await repository.load();
          setConflict(
            current.sessions.find((s) => s.id === session.id) ?? null,
          );
        } catch {
          // Keep the draft and original conflict message if recovery is offline.
        }
      }
    }
    setBusy(false);
  }
  return (
    <section className="panel">
      <span className="eyebrow">Session detail</span>
      <h2>{session.filename}</h2>
      <div className="form-grid">
        <label>
          Date
          <input
            type="date"
            disabled={busy}
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </label>
        <label>
          Time
          <input
            type="time"
            disabled={busy}
            value={draft.time ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, time: e.target.value || null })
            }
          />
        </label>
        <label>
          Venue
          <input
            value={draft.venue}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, venue: e.target.value })}
          />
        </label>
        <label>
          Notes
          <input
            value={draft.notes}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => void save(draft)}>
          Save session
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void save({ ...draft, archived: !draft.archived })}
        >
          {draft.archived ? 'Unarchive session' : 'Archive session'}
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
            Latest saved session: {conflict.date} {conflict.time ?? ''} ·{' '}
            {conflict.venue || 'No venue'} · Notes: {conflict.notes || 'None'}.
          </p>
          <p>
            Retry keeps the fields you changed and uses the latest saved values
            for other fields.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void save({
                ...conflict,
                date: draft.date !== baseline.date ? draft.date : conflict.date,
                time: draft.time !== baseline.time ? draft.time : conflict.time,
                venue:
                  draft.venue !== baseline.venue ? draft.venue : conflict.venue,
                notes:
                  draft.notes !== baseline.notes ? draft.notes : conflict.notes,
                archived:
                  draft.archived !== baseline.archived
                    ? draft.archived
                    : conflict.archived,
              })
            }
          >
            Retry my changes
          </button>
        </div>
      )}
      <ShotReview
        data={data}
        repository={repository}
        refresh={refresh}
        sessionId={session.id}
      />
    </section>
  );
}
