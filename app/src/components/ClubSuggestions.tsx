import { useMemo, useState } from 'react';
import {
  clubOrder,
  effectiveClub,
  isUnknownClub,
  type Dataset,
} from '../domain/model';
import { suggestClub } from '../domain/analytics';
import { assessSequences, SEQUENCE_RULE_VERSION } from '../domain/sequence';
import type { Repository } from '../data/contracts';
import { Badge, Button, Card } from './ds';

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
  const sequence = useMemo(
    () => assessSequences(data.shots, data.sessions, 'premium-flat'),
    [data.shots, data.sessions],
  );

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
    const seq = shot ? sequence.get(shot.id) : undefined;
    const club =
      choices[shotId] ??
      (seq?.kind === 'inferred-club' ? seq.club : undefined) ??
      suggestions.get(shotId)?.club ??
      '';
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
    <Card className="suggestions-card">
      <div className="ds-section-header">
        <div>
          <h2>Guess the missing clubs</h2>
          <div className="ds-section-sub">Unassigned club labels</div>
        </div>
        <Badge tone="warn">
          {unknown.length} {unknown.length === 1 ? 'shot' : 'shots'}
        </Badge>
      </div>
      <p>
        These shots have no readable club label. When surrounding shots point to
        one club, the sequence suggestion is shown first (provisional,{' '}
        {SEQUENCE_RULE_VERSION}); otherwise we compare carry with clubs that
        have at least ten known shots, within 15 m. Confirm a suggestion or
        choose another — the recorded label is never changed automatically.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="suggestion-list">
        {unknown.map((shot) => {
          const suggestion = suggestions.get(shot.id);
          const seq = sequence.get(shot.id);
          const inferred = seq?.kind === 'inferred-club' ? seq : undefined;
          const carry = shot.measurements.flatCarryPremium;
          const selected =
            choices[shot.id] ?? inferred?.club ?? suggestion?.club ?? '';
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
                {inferred
                  ? `Sequence: likely ${inferred.club} · ${inferred.evidence} surrounding ${inferred.club} shots (${SEQUENCE_RULE_VERSION}, provisional)`
                  : suggestion
                    ? `Suggested ${suggestion.club} · ${suggestion.delta.toFixed(1)} m from ${suggestion.sampleSize} shots (${suggestion.source})`
                    : 'No clear suggestion — choose a club if you know it'}
              </span>
              <span className="ds-field ds-select suggestion-select">
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
              </span>
              <Button
                disabled={!selected || !!busy}
                onClick={() => void confirm(shot.id)}
              >
                {busy === shot.id ? 'Saving…' : 'Save club'}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
