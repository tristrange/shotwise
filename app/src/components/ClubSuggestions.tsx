import { useState } from 'react';
import {
  clubOrder,
  effectiveClub,
  isUnknownClub,
  type Dataset,
} from '../domain/model';
import { suggestClub } from '../domain/analytics';
import type { Repository } from '../data/contracts';

export function ClubSuggestions({
  active,
  data,
  repository,
  refresh,
}: {
  active: boolean;
  data: Dataset;
  repository: Repository;
  refresh: () => Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (!active) return null;

  const sessions = new Map(
    data.sessions
      .filter((session) => !session.archived)
      .map((session) => [session.id, session]),
  );
  const activeShots = data.shots.filter((shot) => sessions.has(shot.sessionId));
  const knownClubs = [...new Set(activeShots.map(effectiveClub))]
    .filter((club) => !isUnknownClub(club))
    .sort((a, b) => clubOrder(a) - clubOrder(b) || a.localeCompare(b));
  const unknown = activeShots
    .filter(
      (shot) =>
        isUnknownClub(effectiveClub(shot)) &&
        shot.review.exclusion.kind === 'included',
    )
    .sort((a, b) => {
      const da = sessions.get(a.sessionId)?.date ?? '';
      const db = sessions.get(b.sessionId)?.date ?? '';
      return db.localeCompare(da) || a.rowIndex - b.rowIndex;
    });
  if (!unknown.length) return null;

  const suggestions = new Map(
    unknown.map((shot) => [shot.id, suggestClub(shot, data, 'premium-flat')]),
  );
  const sessionDates = new Map(data.sessions.map((s) => [s.id, s.date]));

  async function confirm(shotId: string) {
    if (busy) return;
    const shot = unknown.find((s) => s.id === shotId);
    const club = choices[shotId] ?? suggestions.get(shotId)?.club ?? '';
    if (!shot || !club) return;
    setBusy(shotId);
    setError('');
    try {
      await repository.review([
        {
          shotId: shot.id,
          expectedRevision: shot.revision,
          review: { ...shot.review, club: { kind: 'corrected', club } },
        },
      ]);
      await refresh();
      setChoices((old) => {
        const next = { ...old };
        delete next[shotId];
        return next;
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save the club. Refresh and try again.',
      );
    }
    setBusy('');
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Unassigned clubs</span>
          <h2>Guess the missing clubs</h2>
        </div>
        <span className="pill">{unknown.length} shots</span>
      </div>
      <p>
        These shots have no readable club label. The suggestion compares carry
        with clubs that have at least ten known shots, using the premium flat
        estimate. A suggestion must be within 15 m of a club’s median and at
        least 5 m closer than the next candidate. This is a rough carry-based
        guess. Confirm one to add it to that club’s stats.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="suggestion-list">
        {unknown.map((shot) => {
          const suggestion = suggestions.get(shot.id);
          const carry = shot.measurements.flatCarryPremium;
          const selected = choices[shot.id] ?? suggestion?.club ?? '';
          return (
            <div className="suggestion-row" key={shot.id}>
              <div className="suggestion-meta">
                <strong>
                  Row {shot.rowIndex} ·{' '}
                  {sessionDates.get(shot.sessionId) ?? 'Unknown date'}
                </strong>
                <span>{carry === null ? '—' : carry.toFixed(1)} m carry</span>
              </div>
              <span className="suggestion-hint">
                {suggestion
                  ? `Suggested ${suggestion.club} · ${suggestion.delta.toFixed(1)} m from ${suggestion.sampleSize} shots (${suggestion.source})`
                  : 'No clear carry-based suggestion — choose a club if you know it'}
              </span>
              <select
                aria-label={`Club for row ${shot.rowIndex}`}
                disabled={!!busy}
                value={selected}
                onChange={(e) =>
                  setChoices((old) => ({ ...old, [shot.id]: e.target.value }))
                }
              >
                <option value="">Choose club</option>
                {knownClubs.map((club) => (
                  <option key={club} value={club}>
                    {club}
                  </option>
                ))}
              </select>
              <button
                disabled={!selected || !!busy}
                onClick={() => void confirm(shot.id)}
              >
                {busy === shot.id ? 'Saving…' : 'Save club'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
