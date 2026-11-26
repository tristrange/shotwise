import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { parseCsv, suggestDate, type CsvPreview } from '../domain/csv';
import {
  BASES,
  dateSchema,
  effectiveClub,
  idSchema,
  isUnknownClub,
  type Basis,
  type Dataset,
  type Session,
  type Shot,
} from '../domain/model';
import { metricStats, reviewCoverage } from '../domain/analytics';
import { resolvedClub, resolveShots } from '../domain/assessment';
import { sessionRecap } from '../domain/recap';
import type { Repository } from '../data/contracts';
import { resolvePracticeEvidence } from './PracticeInsights';
import { SessionRecap, recapEvidence, sessionHref } from './SessionRecap';
import { ShotReview } from './ShotReview';
import { AssignEquipment } from './AssignEquipment';
import {
  CompareSessions,
  compareHref,
  parseCompareQuery,
} from './CompareSessions';
import { Badge, Button, Card, Disclosure, SectionHeader } from './ds';

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
  // Compact per-session summaries for the logbook cards: shot/club counts, a
  // median carry on the selected basis and review coverage — all from the
  // shared domain functions, so the cards never disagree with the recap.
  const sessionCards = useMemo(() => {
    const resolved = resolveShots(data.shots, data.sessions, basis);
    const bySession = new Map<string, Shot[]>();
    for (const shot of data.shots) {
      const list = bySession.get(shot.sessionId) ?? [];
      list.push(shot);
      bySession.set(shot.sessionId, list);
    }
    const carryKey = BASES[basis].carry;
    return [...data.sessions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((s) => {
        const shots = bySession.get(s.id) ?? [];
        const included = shots.filter(
          (x) => x.review.exclusion.kind === 'included',
        );
        const clubs = [
          ...new Set(
            included
              .map((x) => {
                const r = resolved.get(x.id);
                return r ? resolvedClub(r) : effectiveClub(x);
              })
              .filter((club) => !isUnknownClub(club)),
          ),
        ];
        const coverage = reviewCoverage(shots, resolved);
        return {
          session: s,
          recorded: shots.length,
          included: included.length,
          clubs,
          median: metricStats(included, carryKey).median,
          unassessed: coverage.total - coverage.assessed,
        };
      });
  }, [data, basis]);
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
      <Card className="import-panel">
        <SectionHeader
          title="Import CSV files"
          sub="Choose one or more Inrange CSV exports. Dates are filled from filenames when available; otherwise enter a session date."
        />
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
                  <Disclosure summary={`View import warnings (${p.preview.warnings.length})`}>
                    <ul>
                      {p.preview.warnings.map((w, i) => (
                        <li key={i}>
                          Row {w.row}, {w.field}: {w.message}
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                )}
                <Disclosure summary="Inspect preview rows">
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
                </Disclosure>
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
          <Button disabled={busy} onClick={() => void importAll()}>
            Import valid files
          </Button>
        )}
      </Card>
      <Card className="logbook">
        <SectionHeader
          title="Sessions"
          sub={`${data.sessions.length} total`}
          aside={
            <a className="text-button" href={compareHref()}>
              Compare sessions
            </a>
          }
        />
        {data.sessions.length === 0 ? (
          <p>No sessions yet. Import a CSV above to begin.</p>
        ) : (
          <div className="session-list" role="list" aria-label="Session history">
            {sessionCards.map((card) => {
              const { session: s } = card;
              const active = sessionId === s.id;
              return (
                <article
                  className={`session-card${active ? ' active' : ''}`}
                  role="listitem"
                  key={s.id}
                >
                  <a
                    className="session-card-main"
                    href={sessionHref(s.id)}
                    aria-current={active ? 'true' : undefined}
                    onClick={(e) => {
                      returnLink.current = e.currentTarget;
                    }}
                  >
                    <span className="session-card-id">
                      <strong>
                        {s.date}
                        {s.time && ` · ${s.time.slice(0, 5)}`}
                      </strong>
                      <small>
                        {s.venue && `${s.venue} · `}
                        {s.filename}
                      </small>
                    </span>
                    <span className="session-card-shots">
                      {card.recorded} shots →
                    </span>
                  </a>
                  <div className="session-card-meta">
                    <span className="session-card-summary">
                      {card.clubs.length} {card.clubs.length === 1 ? 'club' : 'clubs'}
                      {card.median !== null && (
                        <> · median carry {card.median.toFixed(0)} m</>
                      )}
                      {card.included !== card.recorded && (
                        <> · {card.included} included</>
                      )}
                    </span>
                    {s.archived && <Badge tone="warn">Archived</Badge>}
                    {card.unassessed > 0 && (
                      <span className="pill" title="Shots still without a contact assessment; analytics already include the automatic assessments">
                        {card.unassessed} unassessed
                      </span>
                    )}
                    <a
                      className="ds-icon-button small session-card-compare"
                      href={compareHref(s.id)}
                      aria-label={`Compare ${s.date}${s.time ? ` ${s.time.slice(0, 5)}` : ''}`}
                      title="Compare this session with another"
                    >
                      <ArrowLeftRight size={15} aria-hidden="true" />
                    </a>
                  </div>
                  <details className="session-card-more">
                    <summary>File details</summary>
                    <dl className="session-card-facts">
                      <div><dt>File</dt><dd>{s.filename}</dd></div>
                      <div><dt>Time</dt><dd>{s.time ?? 'Unknown'}</dd></div>
                      <div><dt>Recorded / included</dt><dd>{card.recorded} / {card.included}</dd></div>
                      <div><dt>Clubs</dt><dd>{card.clubs.join(', ') || '—'}</dd></div>
                      {s.notes && <div><dt>Notes</dt><dd>{s.notes}</dd></div>}
                    </dl>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </Card>
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
  // A "Review shot" link targets one exact shot UUID within its visit; the
  // shot must belong to this session before it is shown as evidence.
  const shotParam = idSchema.safeParse(params.get('shot')).data;
  const focusShot = shotParam
    ? data.shots.find(
        (shot) => shot.id === shotParam && shot.sessionId === session.id,
      )
    : undefined;
  const shotEvidence = focusShot
    ? {
        sessionId: session.id,
        shotIds: [focusShot.id],
        key: BASES[basis].carry,
        singleShot: true,
        context: `Shot review · Row ${focusShot.rowIndex} · Shot #${focusShot.sourceNumber || '—'} · ${BASES[basis].label}`,
      }
    : undefined;
  const evidence =
    shotEvidence ??
    (practice
      ? resolvePracticeEvidence(data, session.id, params)
      : recap && recapEvidence(recap, evidenceQuery));
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
    <section className="ds-card session-detail" aria-labelledby={headingId}>
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
      <AssignEquipment
        data={data}
        repository={repository}
        refresh={refresh}
        session={session}
      />
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
