import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCsv, suggestDate, type CsvPreview } from '../domain/csv';
import {
  dateSchema,
  type Basis,
  type Dataset,
  type Session,
} from '../domain/model';
import { sessionRecap } from '../domain/recap';
import type { Repository } from '../data/contracts';
import { resolvePracticeEvidence } from './PracticeInsights';
import { SessionRecap, recapEvidence, sessionHref } from './SessionRecap';
import { ShotReview } from './ShotReview';
import {
  CompareSessions,
  compareHref,
  parseCompareQuery,
} from './CompareSessions';

type Preview = {
  id: number;
  filename: string;
  preview: CsvPreview | null;
  date: string;
  time: string;
  venue: string;
  notes: string;
  result: string;
  saved?: Awaited<ReturnType<Repository['importCsv']>>;
};
export function Sessions({
  data,
  repository,
  refresh,
  sessionId,
  compare,
  evidenceQuery,
  basis,
  onBasisChange,
}: {
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
  sessionId: string | undefined;
  compare: boolean;
  evidenceQuery: string;
  basis: Basis;
  onBasisChange: (basis: Basis) => void;
}) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);
  const returnLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!compare && !sessionId) returnLink.current?.focus();
  }, [compare, sessionId]);
  const session = data.sessions.find((s) => s.id === sessionId);
  const { reference: compareReference, comparison: compareComparison } = compare
    ? parseCompareQuery(evidenceQuery)
    : { reference: undefined, comparison: undefined };
  function selectComparePair(
    reference: string | undefined,
    comparison: string | undefined,
  ) {
    window.location.hash = compareHref(reference, comparison);
  }
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
  async function importAll(separateSessionId?: number) {
    setBusy(true);
    for (const p of previews) {
      if (separateSessionId !== undefined && p.id !== separateSessionId)
        continue;
      if (!p.preview || p.saved) continue;
      if (!dateSchema.safeParse(p.date).success) {
        patch(p.id, {
          result: 'Enter a valid session date before importing.',
        });
        continue;
      }
      try {
        const saved = await repository.importCsv({
          filename: p.filename,
          date: p.date,
          time: p.time || null,
          venue: p.venue,
          notes: p.notes,
          confirmedFull: false,
          allowSameDay: p.id === separateSessionId,
          preview: p.preview,
        });
        await refresh();
        patch(p.id, { saved, result: '' });
      } catch (e) {
        patch(p.id, {
          result: e instanceof Error ? e.message : 'Import failed. Try again.',
        });
      }
    }
    setBusy(false);
  }
  if (compare) {
    return (
      <CompareSessions
        data={data}
        referenceId={compareReference}
        comparisonId={compareComparison}
        onSelect={selectComparePair}
        basis={basis}
        onBasisChange={onBasisChange}
      />
    );
  }
  return (
    <>
      <div className="section-heading">
        <h1>Sessions & import</h1>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Add shots</span>
            <h2>Import CSV files</h2>
          </div>
        </div>
        <p>
          Choose one or more Inrange CSV exports. Dates are filled from
          filenames when available; otherwise enter a session date.
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
                      required
                      value={p.date}
                      onChange={(e) =>
                        patch(p.id, {
                          date: e.target.value,
                          result:
                            p.result ===
                            'Same-day import requires acknowledgement'
                              ? ''
                              : p.result,
                        })
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
                {p.result === 'Same-day import requires acknowledgement' && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void importAll(p.id)}
                  >
                    Import as a separate session
                  </button>
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
            {p.saved && (
              <div className="import-result">
                <p role="status">
                  {p.saved.duplicate
                    ? 'Duplicate export — already imported.'
                    : 'Imported successfully.'}
                </p>
                <a
                  href={sessionHref(p.saved.sessionId)}
                  onClick={(e) => {
                    returnLink.current = e.currentTarget;
                  }}
                >
                  View recap
                </a>
              </div>
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
        <div className="actions">
          <a className="text-button" href={compareHref()}>
            Compare sessions
          </a>
        </div>
        {data.sessions.length === 0 ? (
          <p>No sessions yet. Import a CSV above to begin.</p>
        ) : (
          <div className="session-list">
            {[...data.sessions]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((s) => (
                <a
                  className={`session-row ${sessionId === s.id ? 'active' : ''}`}
                  key={s.id}
                  href={sessionHref(s.id)}
                  aria-current={sessionId === s.id ? 'true' : undefined}
                  onClick={(e) => {
                    returnLink.current = e.currentTarget;
                  }}
                >
                  <span>
                    <strong>
                      {s.date}
                      {s.time && ` · ${s.time.slice(0, 5)}`}
                    </strong>
                    <small>
                      {s.venue && `${s.venue} · `}
                      {s.filename}
                      {s.archived && ' · Archived'}
                    </small>
                  </span>
                  <span>
                    {data.shots.filter((x) => x.sessionId === s.id).length}{' '}
                    shots →
                  </span>
                </a>
              ))}
          </div>
        )}
      </section>
      {sessionId && !session && data.sessions.length > 0 && (
        <p className="notice" role="status">
          This session is unavailable. Choose a session from the logbook.
        </p>
      )}
      {session && (
        <SessionDetail
          key={session.id}
          session={session}
          data={data}
          repository={repository}
          refresh={refresh}
          evidenceQuery={evidenceQuery}
          basis={basis}
          onBasisChange={onBasisChange}
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
  evidenceQuery,
  basis,
  onBasisChange,
}: {
  session: Session;
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
  evidenceQuery: string;
  basis: Basis;
  onBasisChange: (basis: Basis) => void;
}) {
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(session);
  const [baseline, setBaseline] = useState(session);
  const [conflict, setConflict] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const recap = useMemo(
    () => sessionRecap(data, session.id, basis),
    [data, session.id, basis],
  );
  const params = new URLSearchParams(evidenceQuery);
  const practice = params.has('practice');
  const evidence = practice
    ? resolvePracticeEvidence(data, session.id, params)
    : recap && recapEvidence(recap, evidenceQuery);
  const headingId = sessionHref(session.id).slice(1);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const evidenceHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = evidenceQuery
      ? evidenceHeading.current
      : detailHeading.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }, [evidenceQuery]);
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
    <section className="panel session-detail" aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1} ref={detailHeading}>
        Session details
      </h2>
      <p className="session-filename">{session.filename}</p>
      {recap ? (
        <SessionRecap recap={recap} onBasisChange={onBasisChange} />
      ) : (
        <p className="notice">
          This session is archived. Unarchive it to see its recap.
        </p>
      )}
      <h3>Session metadata</h3>
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
        {!session.archived && (
          <a className="text-button" href={compareHref(session.id)}>
            Compare with another session
          </a>
        )}
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
      {evidenceQuery ? (
        <section
          aria-labelledby="session-evidence"
          className="session-evidence"
        >
          <h3 id="session-evidence" tabIndex={-1} ref={evidenceHeading}>
            Supporting shots
          </h3>
          <p>
            <a href={sessionHref(session.id)}>
              {practice ? 'View full session recap' : 'Back to recap'}
            </a>
          </p>
          {evidence ? (
            <ShotReview
              key={evidenceQuery}
              data={data}
              repository={repository}
              refresh={refresh}
              sessionId={evidence.sessionId}
              evidence={evidence}
            />
          ) : (
            <p>These supporting shots are unavailable for the current data.</p>
          )}
        </section>
      ) : (
        <ShotReview
          data={data}
          repository={repository}
          refresh={refresh}
          sessionId={session.id}
        />
      )}
    </section>
  );
}
