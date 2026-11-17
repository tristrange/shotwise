import { useMemo, useState } from 'react';
import { clubFlags } from '../domain/analytics';
import { assessUnusualShots } from '../domain/unusualShots';
import { effectiveClub, type Dataset, type Review } from '../domain/model';
import type { Repository } from '../data/contracts';

export function ShotReview({
  data,
  repository,
  refresh,
  sessionId,
}: {
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
  sessionId?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<'flags' | 'all'>(
    sessionId ? 'all' : 'flags',
  );
  const [intent, setIntent] = useState('');
  const [contact, setContact] = useState('');
  const [club, setClub] = useState('');
  const [corrected, setCorrected] = useState('');
  const [exclusion, setExclusion] = useState('');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flags = clubFlags(data.shots, data.sessions);
  const assessments = useMemo(
    () => assessUnusualShots(data.shots, data.sessions),
    [data.shots, data.sessions],
  );
  const flagged = new Set([
    ...flags.keys(),
    ...[...assessments].flatMap(([id, assessment]) =>
      assessment.kind === 'assessed' && assessment.unusual ? [id] : [],
    ),
  ]);
  const flagCount = data.shots.filter(
    (s) => (!sessionId || s.sessionId === sessionId) && flagged.has(s.id),
  ).length;
  const shots = data.shots
    .filter(
      (s) =>
        (!sessionId || s.sessionId === sessionId) &&
        (filter === 'all' || flagged.has(s.id)),
    )
    .sort((a, b) => a.rowIndex - b.rowIndex);
  const chosen = data.shots.filter((s) => selected.includes(s.id));
  async function run(undo = false) {
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
    setBusy(true);
    setError('');
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
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Save failed. Your choices are preserved; refresh if the data changed elsewhere.',
      );
    }
    setBusy(false);
  }
  return (
    <div className="review">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Review shots</span>
          <h2>{sessionId ? 'Session shots' : 'Review queue'}</h2>
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
          intent and unreviewed contact remain eligible; partial swings, known
          mishits, exclusions and archived sessions are left out. Effective club
          labels are used.
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
      {!sessionId && (
        <>
          <p>Browse all to see shots where the unusual-shot rule abstained.</p>
          <div className="tabs">
            <button
              className={filter === 'flags' ? 'active' : ''}
              onClick={() => setFilter('flags')}
            >
              Flagged only
            </button>
            <button
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              Browse all
            </button>
          </div>
        </>
      )}
      <div className="review-controls">
        <div className="actions">
          <button
            className="secondary"
            onClick={() => setSelected(shots.map((s) => s.id))}
          >
            Select all shown
          </button>
          <button className="text-button" onClick={() => setSelected([])}>
            Clear selection
          </button>
          <span>{selected.length} selected</span>
        </div>
        {sessionId && (
          <div className="range-controls">
            <label>
              From source row
              <input
                type="number"
                min="1"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To source row
              <input
                type="number"
                min="1"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button
              className="secondary"
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
            <select value={intent} onChange={(e) => setIntent(e.target.value)}>
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
            <select value={club} onChange={(e) => setClub(e.target.value)}>
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
                onChange={(e) => setCorrected(e.target.value)}
              />
            </label>
          )}
          <label>
            Exclusion
            <select
              value={exclusion}
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
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="actions">
          <button disabled={busy} onClick={() => void run()}>
            Save review
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(true)}
          >
            Undo selected
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      {shots.length === 0 ? (
        <p>No shots in this view.</p>
      ) : (
        <div className="shot-list">
          {shots.map((s) => {
            const flag = flags.get(s.id);
            const assessment = assessments.get(s.id);
            return (
              <article className="shot" key={s.id}>
                <label className="shot-title">
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, s.id]
                          : old.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <strong>
                    Row {s.rowIndex} · Shot #{s.sourceNumber || '—'}
                  </strong>
                  <span>
                    {data.sessions.find((x) => x.id === s.sessionId)?.date}
                  </span>
                </label>
                <div className="shot-meta">
                  <span>
                    Club{' '}
                    <strong>
                      {s.recordedClub} → {effectiveClub(s)}
                    </strong>
                  </span>
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
