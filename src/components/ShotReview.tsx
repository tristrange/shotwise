import { useState } from 'react';
import { clubFlags } from '../domain/analytics';
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
  const shots = data.shots
    .filter(
      (s) =>
        (!sessionId || s.sessionId === sessionId) &&
        (filter === 'all' || flags.has(s.id)),
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
          <span className="eyebrow">REVIEW SHOTS</span>
          <h2>{sessionId ? 'Session shots' : 'Review queue'}</h2>
        </div>
        <span className="pill">{flags.size} flagged</span>
      </div>
      {!sessionId && (
        <>
          <p>
            Flags identify unusual club labels using earlier range-flat carry
            and range ball speed. They do not change or exclude a shot.
          </p>
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
