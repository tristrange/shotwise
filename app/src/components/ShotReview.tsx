import { useEffect, useMemo, useRef, useState } from 'react';
import { clubFlags } from '../domain/analytics';
import {
  correctionRowStatus,
  pinCorrectionShot,
  sessionIdentity,
  validateCorrectedClub,
  type CorrectionPreview,
} from '../domain/clubCorrection';
import { assessUnusualShots } from '../domain/unusualShots';
import {
  effectiveClub,
  FIELD_HEADERS,
  type Dataset,
  type MetricKey,
  type Review,
  type Shot,
} from '../domain/model';
import type { Repository, RevisionInput } from '../data/contracts';

type Filter = 'flags' | 'reviewed' | 'all';

export function ShotReview({
  data,
  repository,
  refresh,
  sessionId,
  evidence,
}: {
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
  sessionId?: string;
  evidence?: {
    shotIds: string[];
    key: MetricKey;
    context: string;
    singleShot?: boolean;
  };
}) {
  const assessments = useMemo(
    () => assessUnusualShots(data.shots, data.sessions),
    [data.shots, data.sessions],
  );
  const flags = clubFlags(data.shots, data.sessions);
  const flagged = new Set([
    ...flags.keys(),
    ...[...assessments].flatMap(([id, assessment]) =>
      assessment.kind === 'assessed' && assessment.unusual ? [id] : [],
    ),
  ]);
  const reviewedIds = useMemo(
    () =>
      new Set(
        data.events
          .filter((event) => !event.undone)
          .map((event) => event.shotId),
      ),
    [data.events],
  );
  const evidenceIds = evidence && new Set(evidence.shotIds);
  const scoped = data.shots.filter(
    (shot) =>
      (!sessionId || shot.sessionId === sessionId) &&
      (!evidenceIds || evidenceIds.has(shot.id)),
  );
  scoped.sort((a, b) => a.rowIndex - b.rowIndex);
  const matches = (shot: Shot, filter: Filter) =>
    filter === 'all' ||
    (filter === 'flags' ? flagged.has(shot.id) : reviewedIds.has(shot.id));
  const [filter, setFilter] = useState<Filter>(sessionId ? 'all' : 'flags');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [intent, setIntent] = useState('');
  const [contact, setContact] = useState('');
  const [club, setClub] = useState('');
  const [corrected, setCorrected] = useState('');
  const [exclusion, setExclusion] = useState('');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pending, setPending] = useState<
    'save' | 'undo' | 'apply' | 'undoBatch' | null
  >(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [lastBatch, setLastBatch] = useState<{
    sessionLabel: string;
    shots: RevisionInput[];
  } | null>(null);
  const busy = pending !== null;
  const previewOpen = preview !== null;
  const locked = busy || previewOpen;
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const reviewActions = useRef<HTMLDivElement>(null);
  const previewWasOpen = useRef(false);
  useEffect(() => {
    if (previewOpen) previewHeading.current?.focus();
    else if (previewWasOpen.current) reviewActions.current?.focus();
    previewWasOpen.current = previewOpen;
  }, [previewOpen]);
  const shots = scoped.filter((shot) => matches(shot, filter));
  const focus =
    scoped.find((shot) => shot.id === focusedId) ?? shots[0] ?? null;
  // The focused shot keeps its card visible even when it leaves the filter,
  // until navigation or an intentional filter change moves the focus.
  const shown =
    focus && !shots.some((shot) => shot.id === focus.id)
      ? [focus, ...shots]
      : shots;
  const flagCount = scoped.filter((shot) => flagged.has(shot.id)).length;
  const chosen = shown.filter((shot) => selected.includes(shot.id));
  const previewRows = useMemo(
    () =>
      preview
        ? preview.shots.map((pinned) => ({
            ...pinned,
            status: correctionRowStatus(
              pinned,
              preview.proposedClub,
              preview.includeReviewed,
            ),
          }))
        : [],
    [preview],
  );
  const eligibleRows = previewRows.filter((row) => row.status === 'eligible');
  const bulkCorrection = club === 'corrected' && chosen.length > 1;
  const multiSession =
    bulkCorrection &&
    chosen.some((shot) => shot.sessionId !== chosen[0]?.sessionId);
  const otherDrafts = intent || contact || exclusion;
  const sessionRows = focus
    ? data.shots
        .filter((shot) => shot.sessionId === focus.sessionId)
        .sort((a, b) => a.rowIndex - b.rowIndex)
    : [];
  const navRows = focus
    ? shots.filter((shot) => shot.sessionId === focus.sessionId)
    : [];
  const previous = focus
    ? (navRows.findLast((shot) => shot.rowIndex < focus.rowIndex) ?? null)
    : null;
  const next = focus
    ? (navRows.find((shot) => shot.rowIndex > focus.rowIndex) ?? null)
    : null;
  const focusIndex = focus
    ? sessionRows.findIndex((shot) => shot.id === focus.id)
    : -1;
  const nearby =
    focusIndex >= 0
      ? sessionRows.slice(Math.max(0, focusIndex - 1), focusIndex + 2)
      : [];
  const sessionFor = (id: string) =>
    data.sessions.find((session) => session.id === id);
  const focusedSession = focus && sessionFor(focus.sessionId);
  function resetDrafts() {
    setIntent('');
    setContact('');
    setClub('');
    setCorrected('');
    setExclusion('');
    setReason('');
  }
  function changeFilter(nextFilter: Filter) {
    if (locked || nextFilter === filter) return;
    setFilter(nextFilter);
    setSelected([]);
    setFocusedId(null);
    setError('');
    resetDrafts();
  }
  function go(target: Shot | null) {
    if (locked || !target) return;
    setFocusedId(target.id);
    setSelected([target.id]);
    setError('');
    resetDrafts();
  }
  function startPreview() {
    if (locked || !bulkCorrection || multiSession) return;
    const valid = validateCorrectedClub(corrected);
    if (!valid.ok) {
      setError(valid.message);
      return;
    }
    const firstChosen = chosen.at(0);
    const session = firstChosen && sessionFor(firstChosen.sessionId);
    if (!session) {
      setError(
        'The session for the selected shots is unavailable. Refresh and try again.',
      );
      return;
    }
    setError('');
    setStatus('');
    setPreview({
      sessionLabel: sessionIdentity(session),
      proposedClub: valid.club,
      includeReviewed: false,
      shots: chosen
        .map(pinCorrectionShot)
        .sort((a, b) => a.rowIndex - b.rowIndex),
    });
  }
  function cancelPreview() {
    if (busy) return;
    setPreview(null);
    setError('');
  }
  async function applyPreview() {
    if (busy || !preview || !eligibleRows.length) return;
    setPending('apply');
    setError('');
    setStatus('');
    try {
      await repository.review(
        eligibleRows.map((row) => ({
          shotId: row.shotId,
          expectedRevision: row.expectedRevision,
          review: {
            ...row.review,
            club: { kind: 'corrected', club: preview.proposedClub },
          },
        })),
      );
      setLastBatch({
        sessionLabel: preview.sessionLabel,
        shots: eligibleRows.map((row) => ({
          shotId: row.shotId,
          expectedRevision: row.expectedRevision + 1,
        })),
      });
      setPreview(null);
      setSelected([]);
      resetDrafts();
      setStatus(
        `Club correction applied to ${eligibleRows.length} of ${previewRows.length} selected rows in ${preview.sessionLabel}.`,
      );
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not complete the club correction. Refresh and check the selected shots.',
      );
    }
    setPending(null);
  }
  async function undoLastBatch() {
    if (busy || !lastBatch) return;
    setPending('undoBatch');
    setError('');
    setStatus('');
    try {
      await repository.undo(lastBatch.shots);
      setLastBatch(null);
      setStatus(
        `Club correction undone for ${lastBatch.shots.length} shot${lastBatch.shots.length === 1 ? '' : 's'} in ${lastBatch.sessionLabel}.`,
      );
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not undo the club correction. Refresh and check the affected shots.',
      );
    }
    setPending(null);
  }
  async function run(undo = false) {
    if (locked || (bulkCorrection && !undo)) return;
    if (!chosen.length) {
      setError('Select at least one shot.');
      return;
    }
    if (exclusion === 'excluded' && !reason.trim() && !undo) {
      setError('Enter a reason for exclusion.');
      return;
    }
    if (club === 'corrected' && !corrected.trim() && !undo) {
      setError('Enter the corrected club.');
      return;
    }
    setFocusedId(focus?.id ?? null);
    setPending(undo ? 'undo' : 'save');
    setError('');
    setStatus('');
    try {
      if (undo)
        await repository.undo(
          chosen.map((s) => ({ shotId: s.id, expectedRevision: s.revision })),
        );
      else
        await repository.review(
          chosen.map((s) => {
            let next: Review = { ...s.review };
            if (
              intent === 'full' ||
              intent === 'partial' ||
              intent === 'unknown'
            )
              next = { ...next, intent };
            if (
              contact === 'typical' ||
              contact === 'mishit' ||
              contact === 'uncertain'
            )
              next = { ...next, contact };
            if (club === 'confirmed')
              next = { ...next, club: { kind: 'confirmed' } };
            if (club === 'corrected')
              next = {
                ...next,
                club: { kind: 'corrected', club: corrected.trim() },
              };
            if (club === 'unreviewed')
              next = { ...next, club: { kind: 'unreviewed' } };
            if (exclusion === 'included')
              next = { ...next, exclusion: { kind: 'included' } };
            if (exclusion === 'excluded')
              next = {
                ...next,
                exclusion: { kind: 'excluded', reason: reason.trim() },
              };
            return { shotId: s.id, expectedRevision: s.revision, review: next };
          }),
        );
      await refresh();
      setSelected([]);
      resetDrafts();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Save failed. Your choices are preserved; refresh if the data changed elsewhere.',
      );
    }
    setPending(null);
  }
  const feedback = (
    <>
      {pending && (
        <p role="status" className="notice">
          {pending === 'save'
            ? 'Saving review…'
            : pending === 'undo'
              ? 'Undoing review…'
              : pending === 'apply'
                ? 'Applying club correction…'
                : 'Undoing club correction…'}
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
    </>
  );
  return (
    <div className="review">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Review shots</span>
          <h2>{sessionId ? 'Session shots' : 'Review queue'}</h2>
          {evidence && (
            <p>
              {evidence.context}
              {!evidence.singleShot && ` · ${scoped.length} measured shots`}
            </p>
          )}
        </div>
        <span className="pill">{flagCount} flagged</span>
      </div>
      <p>
        Club-label flags and likely-mishit flags are separate suggestions. Saved
        shots and contact decisions stay unchanged. Use “Hide likely mishits” in
        stats to compare the effect. Leave contact uncertain if you do not know.
      </p>
      <details>
        <summary>How unusual-shot flags work (experimental)</summary>
        <p>
          Recognised drivers, woods, hybrids, irons and wedges, using range-flat
          carry and range ball speed. At least 20 earlier shots with both
          positive measurements are needed. The baseline targets the latest 50
          earlier shots within 60 days, keeping the full cutoff date. Unknown
          intent remains eligible for drivers, woods, hybrids and irons. Wedge
          shots need explicit full intent for assessment and baseline evidence.
          Unreviewed contact remains eligible. Partial swings, known mishits,
          exclusions and archived sessions are left out. Effective club labels
          are used.
        </p>
        <p>
          The reference is the 75th percentile of each earlier measurement.
          Carry must be below 65% of its reference and ball speed below 80% of
          its reference. Both must be low. Sparse or missing evidence abstains;
          those shots stay included in stats. Untimed or equally timed sessions
          on the same day are not used to assess one another. These provisional
          thresholds are not a validated contact classifier. Marking contact
          typical or mishit, or intent partial, clears the unusual-shot flag;
          Undo selected restores the previous decision.
        </p>
      </details>
      <p>All shots includes shots where the unusual-shot rule abstained.</p>
      <div className="tabs">
        <button
          aria-pressed={filter === 'flags'}
          className={filter === 'flags' ? 'active' : ''}
          disabled={locked}
          onClick={() => changeFilter('flags')}
        >
          Open flags
        </button>
        <button
          aria-pressed={filter === 'reviewed'}
          className={filter === 'reviewed' ? 'active' : ''}
          disabled={locked}
          onClick={() => changeFilter('reviewed')}
        >
          Manually reviewed
        </button>
        <button
          aria-pressed={filter === 'all'}
          className={filter === 'all' ? 'active' : ''}
          disabled={locked}
          onClick={() => changeFilter('all')}
        >
          All shots
        </button>
      </div>
      <section className="focused-review" aria-label="Focused shot">
        <div className="focused-head">
          <p className="focused-label" aria-live="polite">
            {focus ? (
              <>
                Focused:{' '}
                <strong>
                  Row {focus.rowIndex} · Shot #{focus.sourceNumber || '—'}
                </strong>{' '}
                {focusedSession &&
                  `· ${focusedSession.date} · ${focusedSession.filename}`}
              </>
            ) : (
              'No shot in focus'
            )}
          </p>
          <div className="focused-nav">
            <button
              className="secondary"
              disabled={locked || !previous}
              onClick={() => go(previous)}
            >
              Previous shot
            </button>
            <button
              className="secondary"
              disabled={locked || !next}
              onClick={() => go(next)}
            >
              Next shot
            </button>
          </div>
        </div>
        <section className="nearby" aria-label="Nearby source rows">
          <p className="nearby-title">
            Nearby source rows · Range-flat carry and ball speed
          </p>
          {nearby.length === 0 ? (
            <p className="muted">No rows in this view.</p>
          ) : (
            <ul>
              {nearby.map((shot) => (
                <li
                  key={shot.id}
                  aria-current={shot.id === focus?.id ? 'true' : undefined}
                >
                  Row {shot.rowIndex} · Shot #{shot.sourceNumber || '—'} ·{' '}
                  {effectiveClub(shot)} ·{' '}
                  {shot.measurements.flatCarryRange ?? '—'} m{' · '}
                  {shot.measurements.speedRange ?? '—'} kph
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
      <div className="review-controls">
        <div className="actions">
          <button
            className="secondary"
            disabled={locked}
            onClick={() => setSelected(shots.map((s) => s.id))}
          >
            Select all matching
          </button>
          <button
            className="text-button"
            disabled={locked}
            onClick={() => setSelected([])}
          >
            Clear selection
          </button>
          <span>{chosen.length} selected</span>
        </div>
        {sessionId && (
          <div className="range-controls">
            <label>
              From source row
              <input
                type="number"
                min="1"
                disabled={locked}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To source row
              <input
                type="number"
                min="1"
                disabled={locked}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              disabled={locked}
              onClick={() =>
                setSelected(
                  shots
                    .filter(
                      (s) =>
                        s.rowIndex >= Number(from || 1) &&
                        s.rowIndex <= Number(to || Infinity),
                    )
                    .map((s) => s.id),
                )
              }
            >
              Select range
            </button>
          </div>
        )}
        <div className="form-grid">
          <label>
            Set intent
            <select
              value={intent}
              disabled={locked}
              onChange={(e) => setIntent(e.target.value)}
            >
              <option value="">Leave unchanged</option>
              <option value="full">Full</option>
              <option value="partial">Partial</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            Set contact
            <select
              value={contact}
              disabled={locked}
              onChange={(e) => setContact(e.target.value)}
            >
              <option value="">Leave unchanged</option>
              <option value="typical">Typical</option>
              <option value="mishit">Mishit</option>
              <option value="uncertain">Uncertain</option>
            </select>
          </label>
          <label>
            Club decision
            <select
              value={club}
              disabled={locked}
              onChange={(e) => setClub(e.target.value)}
            >
              <option value="">Leave unchanged</option>
              <option value="confirmed">Confirm recorded</option>
              <option value="corrected">Correct club</option>
              <option value="unreviewed">Reset club decision</option>
            </select>
          </label>
          {club === 'corrected' && (
            <label>
              Corrected club
              <input
                value={corrected}
                disabled={locked}
                onChange={(e) => setCorrected(e.target.value)}
              />
            </label>
          )}
          <label>
            Exclusion
            <select
              value={exclusion}
              disabled={locked}
              onChange={(e) => setExclusion(e.target.value)}
            >
              <option value="">Leave unchanged</option>
              <option value="included">Include</option>
              <option value="excluded">Exclude</option>
            </select>
          </label>
          {exclusion === 'excluded' && (
            <label>
              Exclusion reason
              <input
                required
                value={reason}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
        </div>
        {multiSession && (
          <p className="notice">
            Select shots from one session to preview a club correction.
          </p>
        )}
        <div className="actions" ref={reviewActions} tabIndex={-1}>
          {bulkCorrection ? (
            <button disabled={locked || multiSession} onClick={startPreview}>
              Preview club correction
            </button>
          ) : (
            <button disabled={locked} onClick={() => void run()}>
              Save review
            </button>
          )}
          <button
            className="secondary"
            disabled={locked}
            onClick={() => void run(true)}
          >
            Undo selected
          </button>
          {lastBatch && (
            <button
              className="secondary"
              disabled={locked}
              onClick={() => void undoLastBatch()}
            >
              Undo club correction
            </button>
          )}
        </div>
        {!preview && feedback}
      </div>
      {preview && (
        <section
          className="correction-preview"
          aria-label="Club correction preview"
        >
          <h3 ref={previewHeading} tabIndex={-1}>
            Club correction preview
          </h3>
          <p className="correction-session">
            <strong>{preview.sessionLabel}</strong>
          </p>
          <p className="correction-proposed">
            Change club label to <strong>{preview.proposedClub}</strong>
          </p>
          <p>
            {eligibleRows.length} of {previewRows.length} selected rows will
            change when you apply this correction.
          </p>
          <label className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={preview.includeReviewed}
              onChange={(e) =>
                setPreview((current) =>
                  current
                    ? { ...current, includeReviewed: e.target.checked }
                    : current,
                )
              }
            />
            Include previously reviewed clubs
          </label>
          {otherDrafts.length > 0 && (
            <p className="notice">
              Applying this correction saves the club label and clears the other
              draft changes.
            </p>
          )}
          <ul className="correction-rows">
            {previewRows.map((row) => (
              <li key={row.shotId}>
                Row {row.rowIndex} · Shot #{row.sourceNumber || '—'} ·{' '}
                {row.oldLabel}
                {row.status === 'eligible' ? (
                  <>
                    {' '}
                    → <strong>{preview.proposedClub}</strong> · will change
                  </>
                ) : row.status === 'skipped-reviewed' ? (
                  <> · skipped · already {row.review.club.kind}</>
                ) : (
                  <> · skipped · label already matches</>
                )}
              </li>
            ))}
          </ul>
          <div className="correction-actions">
            <button
              disabled={busy || eligibleRows.length === 0}
              onClick={() => void applyPreview()}
            >
              Apply club correction
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={cancelPreview}
            >
              Cancel preview
            </button>
          </div>
          {eligibleRows.length === 0 && (
            <p className="notice">All selected rows are skipped.</p>
          )}
          {feedback}
        </section>
      )}
      {shown.length === 0 ? (
        <p>No shots in this view.</p>
      ) : (
        <div className="shot-list">
          {shown.map((s) => {
            const flag = flags.get(s.id);
            const assessment = assessments.get(s.id);
            return (
              <article
                className={focus?.id === s.id ? 'shot is-focused' : 'shot'}
                key={s.id}
              >
                <label className="shot-title">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={selected.includes(s.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected((old) =>
                          old.includes(s.id) ? old : [...old, s.id],
                        );
                        setFocusedId(s.id);
                      } else {
                        setSelected((old) => old.filter((id) => id !== s.id));
                      }
                    }}
                  />
                  <strong>
                    Row {s.rowIndex} · Shot #{s.sourceNumber || '—'}
                  </strong>
                  <span>{sessionFor(s.sessionId)?.date}</span>
                </label>
                <div className="shot-meta">
                  <span>
                    Club{' '}
                    <strong>
                      {s.recordedClub} → {effectiveClub(s)}
                    </strong>
                  </span>
                  {evidence && (
                    <span>
                      {FIELD_HEADERS[evidence.key]}{' '}
                      {s.measurements[evidence.key] ?? '—'}
                    </span>
                  )}
                  <span>
                    Premium flat carry (estimate){' '}
                    {s.measurements.flatCarryPremium ?? '—'} m
                  </span>
                  <span>Total {s.measurements.flatTotalPremium ?? '—'} m</span>
                  <span>Speed {s.measurements.speedPremium ?? '—'} kph</span>
                  <span>Launch {s.measurements.launchPremium ?? '—'}°</span>
                  <span>Apex {s.measurements.apexPremium ?? '—'} m</span>
                  <span>
                    {s.review.intent} · {s.review.contact} ·{' '}
                    {s.review.exclusion.kind}
                    {s.review.exclusion.kind === 'excluded' &&
                      `: ${s.review.exclusion.reason}`}
                  </span>
                </div>
                {flag && (
                  <p className="flag">
                    Review club label: range-flat carry and range speed exceed
                    thresholds from {flag.baselineCount} earlier shots across{' '}
                    {flag.sessions} sessions (rule {flag.ruleVersion}; medians{' '}
                    {flag.carryMedian.toFixed(1)} m /{' '}
                    {flag.speedMedian.toFixed(1)} kph; thresholds{' '}
                    {flag.carryThreshold.toFixed(1)} m /{' '}
                    {flag.speedThreshold.toFixed(1)} kph).
                  </p>
                )}
                {assessment?.kind === 'assessed' && assessment.unusual && (
                  <div className="flag">
                    <strong>Likely mishit · experimental</strong>
                    <p>
                      Range-flat carry {assessment.carry.toFixed(1)} m and range
                      ball speed {assessment.speed.toFixed(1)} kph are both low
                      for {effectiveClub(s)}. Baseline:{' '}
                      {assessment.baselineCount} earlier paired shots across{' '}
                      {assessment.sessions} session(s). Unreviewed shots may be
                      included.
                    </p>
                    <p>
                      Medians: {assessment.carryMedian.toFixed(1)} m /{' '}
                      {assessment.speedMedian.toFixed(1)} kph. Reference (75th
                      percentile): {assessment.carryReference.toFixed(1)} m /{' '}
                      {assessment.speedReference.toFixed(1)} kph. Flag cutoffs:
                      below {assessment.carryThreshold.toFixed(1)} m /{' '}
                      {assessment.speedThreshold.toFixed(1)} kph (rule{' '}
                      {assessment.ruleVersion}). This does not confirm a mishit.
                    </p>
                  </div>
                )}
                {assessment?.kind === 'abstained' && (
                  <p className="notice">
                    Unusual-shot check unavailable: {assessment.reason}{' '}
                    {assessment.baselineCount} earlier paired shots available.
                  </p>
                )}
                <details>
                  <summary>Original CSV cells</summary>
                  <dl className="raw">
                    {Object.entries(s.raw).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
