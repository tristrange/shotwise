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
import { resolveShots } from '../domain/assessment';
import { CLASSIFIER_VERSION, type ShotAssessment } from '../domain/classify';
import { SEQUENCE_RULE_VERSION } from '../domain/sequence';
import {
  effectiveClub,
  FIELD_HEADERS,
  type Dataset,
  type MetricKey,
  type Review,
  type Shot,
} from '../domain/model';
import type { Repository, RevisionInput } from '../data/contracts';
import {
  Badge,
  Button,
  Card,
  Disclosure,
  SectionHeader,
  SegmentedControl,
  Select,
  TextField,
} from './ds';
import type { SegmentedOption } from './ds';

type Filter = 'flags' | 'reviewed' | 'all';

const FILTER_OPTIONS: readonly SegmentedOption<Filter>[] = [
  { value: 'flags', label: 'Open flags' },
  { value: 'reviewed', label: 'Manually reviewed' },
  { value: 'all', label: 'All shots' },
];
const INTENT_DRAFT_OPTIONS = [
  { value: '', label: 'Leave unchanged' },
  { value: 'full', label: 'Full' },
  { value: 'partial', label: 'Partial' },
  { value: 'unknown', label: 'Unknown' },
] as const;
const CONTACT_DRAFT_OPTIONS = [
  { value: '', label: 'Leave unchanged' },
  { value: 'typical', label: 'Typical' },
  { value: 'mishit', label: 'Mishit' },
  { value: 'uncertain', label: 'Uncertain' },
] as const;
const CLUB_DRAFT_OPTIONS = [
  { value: '', label: 'Leave unchanged' },
  { value: 'confirmed', label: 'Confirm recorded' },
  { value: 'corrected', label: 'Correct club' },
  { value: 'unreviewed', label: 'Reset club decision' },
] as const;
const EXCLUSION_DRAFT_OPTIONS = [
  { value: '', label: 'Leave unchanged' },
  { value: 'included', label: 'Include' },
  { value: 'excluded', label: 'Exclude' },
] as const;

/**
 * Non-authoritative automatic labels for dimensions the user has not manually
 * reviewed (ADR-0001: manual review always wins). Returns nothing when the
 * classifier abstained or the dimension was reviewed.
 */
function autoBadges(
  shot: Shot,
  auto: ShotAssessment | undefined,
): { label: string; reason: string }[] {
  if (!auto) return [];
  const badges: { label: string; reason: string }[] = [];
  if (shot.review.contact === 'uncertain' && auto.contact.value === 'mishit')
    badges.push({ label: 'auto: likely mishit', reason: auto.contact.reason });
  if (shot.review.intent === 'unknown' && auto.intent.value === 'partial')
    badges.push({ label: 'auto: likely partial', reason: auto.intent.reason });
  return badges;
}

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
  // One resolved pass feeds both the automatic badges and the suspicion badge,
  // instead of running both classifiers separately. Classification runs on the
  // canonical assessment basis (range measurements preferred over premium
  // estimates), so the basis argument here is display-only and never changes
  // club identity, intent or contact.
  const resolvedAssessments = useMemo(
    () => resolveShots(data.shots, data.sessions, 'premium-flat'),
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
  const autoMishits = scoped.filter((shot) =>
    autoBadges(shot, resolvedAssessments.get(shot.id)?.automatic).some((b) =>
      b.label.includes('mishit'),
    ),
  ).length;
  const autoPartials = scoped.filter((shot) =>
    autoBadges(shot, resolvedAssessments.get(shot.id)?.automatic).some((b) =>
      b.label.includes('partial'),
    ),
  ).length;
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
      <Card className="review-summary">
        <SectionHeader
          title={sessionId ? 'Session shots' : 'Review queue'}
          sub={
            evidence
              ? `${evidence.context}${!evidence.singleShot ? ` · ${scoped.length} measured shots` : ''}`
              : undefined
          }
          aside={
            <div className="card-controls">
              <Badge tone="warn">{flagCount} flagged</Badge>
              {autoMishits + autoPartials > 0 && (
                <span
                  className="ds-badge tone-warn provisional"
                  title={`Automatic assessment ${CLASSIFIER_VERSION} — informational only; saved reviews always win.`}
                >
                  auto: {autoMishits} likely mishits · {autoPartials} likely
                  partials
                </span>
              )}
            </div>
          }
        />
        <p className="review-guidance">
          Club-label flags and likely-mishit flags are separate suggestions.
          Reviewing is optional maintenance, not a step required before
          analytics. Saved shots and contact decisions stay unchanged; use “Hide
          likely mishits” in stats to compare the effect. Leave contact
          uncertain if you do not know. Automatic labels ({CLASSIFIER_VERSION})
          are provisional and never override a saved review — solid badges are
          saved manual decisions, dashed badges are automatic labels.
        </p>
        <Disclosure summary="How unusual-shot flags work (experimental)">
          <p>
            Recognised drivers, woods, hybrids, irons and wedges, using
            range-flat carry and range ball speed. At least 20 earlier shots
            with both positive measurements are needed. The baseline targets the
            latest 50 earlier shots within 60 days, keeping the full cutoff
            date. Unknown intent remains eligible for drivers, woods, hybrids
            and irons. Wedge shots need explicit full intent for assessment and
            baseline evidence. Unreviewed contact remains eligible. Partial
            swings, known mishits, exclusions and archived sessions are left
            out. Effective club labels are used.
          </p>
          <p>
            The reference is the 75th percentile of each earlier measurement.
            Carry must be below 65% of its reference and ball speed below 80% of
            its reference. Both must be low. Sparse or missing evidence
            abstains; those shots stay included in stats. Untimed or equally
            timed sessions on the same day are not used to assess one another.
            These provisional thresholds are not a validated contact classifier.
            Marking contact typical or mishit, or intent partial, clears the
            unusual-shot flag; Undo selected restores the previous decision.
          </p>
        </Disclosure>
        <p className="muted">
          All shots includes shots where the unusual-shot rule abstained.
        </p>
        <SegmentedControl
          label="Review filter"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={changeFilter}
          disabled={locked}
        />
      </Card>
      <Card className="review-focus" role="region" aria-label="Focused shot">
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
            <Button
              variant="secondary"
              disabled={locked || !previous}
              onClick={() => go(previous)}
            >
              Previous shot
            </Button>
            <Button
              variant="secondary"
              disabled={locked || !next}
              onClick={() => go(next)}
            >
              Next shot
            </Button>
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
      </Card>
      <Card className="review-actions-card">
        <div className="actions">
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() => setSelected(shots.map((s) => s.id))}
          >
            Select all matching
          </Button>
          <Button
            variant="ghost"
            disabled={locked}
            onClick={() => setSelected([])}
          >
            Clear selection
          </Button>
          <span className="context">{chosen.length} selected</span>
        </div>
        {sessionId && (
          <div className="range-controls">
            <TextField
              label="From source row"
              type="number"
              min="1"
              disabled={locked}
              value={from}
              onChange={setFrom}
            />
            <TextField
              label="To source row"
              type="number"
              min="1"
              disabled={locked}
              value={to}
              onChange={setTo}
            />
            <Button
              variant="secondary"
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
            </Button>
          </div>
        )}
        <div className="review-fields">
          <Select
            label="Set intent"
            value={intent}
            disabled={locked}
            onChange={setIntent}
            options={INTENT_DRAFT_OPTIONS}
          />
          <Select
            label="Set contact"
            value={contact}
            disabled={locked}
            onChange={setContact}
            options={CONTACT_DRAFT_OPTIONS}
          />
          <Select
            label="Club decision"
            value={club}
            disabled={locked}
            onChange={setClub}
            options={CLUB_DRAFT_OPTIONS}
          />
          {club === 'corrected' && (
            <TextField
              label="Corrected club"
              value={corrected}
              disabled={locked}
              onChange={setCorrected}
            />
          )}
          <Select
            label="Exclusion"
            value={exclusion}
            disabled={locked}
            onChange={setExclusion}
            options={EXCLUSION_DRAFT_OPTIONS}
          />
          {exclusion === 'excluded' && (
            <TextField
              label="Exclusion reason"
              required
              value={reason}
              disabled={locked}
              onChange={setReason}
            />
          )}
        </div>
        {multiSession && (
          <p className="notice">
            Select shots from one session to preview a club correction.
          </p>
        )}
        <div className="actions" ref={reviewActions} tabIndex={-1}>
          {bulkCorrection ? (
            <Button disabled={locked || multiSession} onClick={startPreview}>
              Preview club correction
            </Button>
          ) : (
            <Button disabled={locked} onClick={() => void run()}>
              Save review
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() => void run(true)}
          >
            Undo selected
          </Button>
          {lastBatch && (
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() => void undoLastBatch()}
            >
              Undo club correction
            </Button>
          )}
        </div>
        {!preview && feedback}
      </Card>
      {preview && (
        <Card
          className="correction-preview"
          role="region"
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
            <Button
              disabled={busy || eligibleRows.length === 0}
              onClick={() => void applyPreview()}
            >
              Apply club correction
            </Button>
            <Button variant="secondary" disabled={busy} onClick={cancelPreview}>
              Cancel preview
            </Button>
          </div>
          {eligibleRows.length === 0 && (
            <p className="notice">All selected rows are skipped.</p>
          )}
          {feedback}
        </Card>
      )}
      {shown.length === 0 ? (
        <Card>
          <p>No shots in this view.</p>
        </Card>
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
                  {reviewedIds.has(s.id) && (
                    <span
                      className="ds-badge tone-brand"
                      title="Saved manual review — wins over automatic labels (ADR-0001)"
                    >
                      manual review
                    </span>
                  )}
                  {autoBadges(s, resolvedAssessments.get(s.id)?.automatic).map(
                    (badge) => (
                      <span
                        key={badge.label}
                        className="ds-badge tone-warn provisional"
                        title={`${badge.reason} (${CLASSIFIER_VERSION}; saved reviews win)`}
                      >
                        {badge.label}
                      </span>
                    ),
                  )}
                  {(() => {
                    const seq = resolvedAssessments.get(s.id)?.suspicion;
                    if (seq) {
                      // The badge stays visible on reviewed rows too: a manual
                      // confirm/correct clears the exclusion, but the golfer
                      // should still see the automatic observation.
                      const manual =
                        s.review.club.kind !== 'unreviewed'
                          ? '; manual club decision wins'
                          : '';
                      return (
                        <span
                          className="ds-badge tone-warn provisional"
                          title={`${seq.reason} (${SEQUENCE_RULE_VERSION}; recorded label kept${manual})`}
                        >
                          auto: possible wrong club ({seq.suspectedClub}?)
                        </span>
                      );
                    }
                    return null;
                  })()}
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
                <Disclosure summary="Original CSV cells">
                  <dl className="raw">
                    {Object.entries(s.raw).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </Disclosure>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
