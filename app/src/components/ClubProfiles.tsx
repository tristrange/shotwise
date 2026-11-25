import { useEffect, useMemo, useRef, useState } from 'react';
import { clubProfiles, type ClubProfile } from '../domain/clubProfiles';
import { validateUserReferenceValue } from '../domain/benchmarks';
import type { Repository } from '../data/contracts';
import type {
  Equipment,
  ReferenceBasis,
  ReferenceMetric,
  ReferenceSource,
  ReferenceStatistic,
  ReferenceType,
  UserReferenceValueRecord,
  UserReferenceValueSaveInput,
} from '../domain/model';
import {
  BENCHMARK_SOURCES,
  REFERENCE_STATISTIC_LABEL,
  REFERENCE_TYPE_LABEL,
  attributionFor,
  benchmarkReferencesForClub,
  compareWithReference,
  type ReferenceComparison,
  type ReferenceComparisonRow,
} from '../domain/benchmarks';
import {
  CATEGORY_SCORES_VERSION,
  CATEGORY_SCORE_DEFINITIONS,
  CATEGORY_SCORE_ORDER,
  categoryScores,
  type CategoryScore,
  type CategoryScores,
} from '../domain/scores';
import { clubRatings, RATINGS_VERSION, type ClubRating } from '../domain/ratings';
import type { AnalysisSettings } from '../domain/analytics';
import { equipmentDisplayName } from '../domain/equipment';
import { localToday, type Basis, type Dataset } from '../domain/model';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';
import { sessionHref, visitLabel } from './SessionRecap';
import { RatingBreakdown, RatingChip } from './ClubRating';

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat(undefined, { style: 'percent' });

export function clubHref(club: string) {
  return `#clubs/${encodeURIComponent(club)}`;
}

const fmt = (n: number | null) => (n === null ? '—' : decimal.format(n));

function cohortLabel(cohort: 'reviewed' | 'broader') {
  return cohort === 'reviewed'
    ? 'reviewed full swings with typical contact'
    : 'broader estimate (unreviewed non-wedge swings included, confirmed mishits excluded)';
}

function gapNote(gap: ClubProfile['gap']) {
  if (!gap || gap.gap === null) return null;
  const flag =
    gap.flag === 'small'
      ? ' · small median gap'
      : gap.flag === 'reversed'
        ? ' · medians reversed'
        : gap.flag === 'large'
          ? ' · large gap'
          : '';
  return `Gap to the next longer club: ${decimal.format(gap.gap)} m${flag}`;
}

/**
 * Optional link-out external references for a club. Hidden behind a
 * disclosure; nothing is embedded, every row carries full attribution, and
 * professional-audience sources get a badge so they are not read as amateur
 * targets. Comparability (carry↔carry, total↔total) is stated per row.
 */
function BenchmarkReferences({ club, basis }: { club: string; basis: Basis }) {
  // Range-ball bases measure the limited-flight range ball; no external
  // source covers range balls, so the disclosure is suppressed entirely.
  const references = benchmarkReferencesForClub(club, basis);
  if (references.length === 0) return null;
  return (
    <details className="benchmark-refs">
      <summary>External references ({references.length})</summary>
      <ul>
        {references.map((ref) => {
          const source = BENCHMARK_SOURCES.find((s) => s.id === ref.sourceId);
          if (!source) return null;
          return (
            <li key={ref.sourceId}>
              <a href={ref.url} target="_blank" rel="noopener noreferrer">
                {ref.label}
              </a>{' '}
              {ref.audience === 'professional' && (
                <span className="pill">
                  Pro reference — not an amateur target
                </span>
              )}
              <p className="context">
                {ref.caveat}. {attributionFor(source)}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="context">
        Linked sources only — no external dataset is embedded in the app.
        Compare carry with carry and total with total: on-course totals are
        context for range carry, not a like-for-like target.
      </p>
    </details>
  );
}

const CATEGORY_ORDER = CATEGORY_SCORE_ORDER;

function formatScore(score: CategoryScore) {
  if (score.value === null) return 'not enough data';
  if (score.unit === 'share') return percent.format(score.value);
  return `${decimal.format(score.value)} ${score.unit}`;
}

/**
 * The four category measurements from ADR-0003 / `category-scores-1`, shown
 * as raw metrics from the golfer's own shots. The within-bag raw-metric
 * standings of ADR-0004 were removed with ADR-0005 (decision 2): raw carry
 * ranks the driver first by construction and absolute IQR favours short
 * clubs. Normalized 0–100 ratings live in `RatingBreakdown` above.
 * Insufficient categories show "not enough data" with the reason in a pill.
 */
function CategoryScoresSection({ scores }: { scores: CategoryScores }) {
  return (
    <div className="category-scores">
      <ul className="profile-stats">
        {CATEGORY_ORDER.map((id) => {
          const score = scores[id];
          return (
            <li key={id}>
              <strong>{score.label}</strong> {formatScore(score)} · from{' '}
              {score.n}{' '}
              {score.unit === 'm'
                ? 'measured shots'
                : score.unit === 'deg'
                  ? 'shots with launch direction'
                  : 'assessed full swings'}
              {score.note && <span className="pill"> {score.note}</span>}
              {score.aux
                ?.filter((a) => a.value !== null)
                .map((a) => (
                  <span key={a.label}>
                    {' '}
                    · {a.label.toLowerCase()}{' '}
                    {a.unit === 'share'
                      ? percent.format(a.value!)
                      : `${decimal.format(a.value!)} ${a.unit}`}{' '}
                    (n = {a.n})
                  </span>
                ))}
            </li>
          );
        })}
      </ul>
      <details>
        <summary>How these are scored</summary>
        <ul>
          {CATEGORY_ORDER.map((id) => {
            const def = CATEGORY_SCORE_DEFINITIONS[id];
            return (
              <li key={id}>
                <strong>{def.label}.</strong> {def.description} Population:{' '}
                {def.population} Estimator: {def.estimator}
              </li>
            );
          })}
        </ul>
        <p className="context">
          Scores are raw measurements from your own shots on the selected
          basis, each with its sample size; categories with too little data show
          “not enough data” rather than a guess. The normalized 0–100 category
          ratings and overall composite live in the rating breakdown above
          (ADR-0005, {RATINGS_VERSION}); these raw measurements are the
          evidence behind them. Methodology version{' '}
          {CATEGORY_SCORES_VERSION}.
        </p>
      </details>
    </div>
  );
}

/** Compact comparison bars: measured value vs the personal reference. */
function ReferenceComparisonBars({
  comparison,
}: {
  comparison: ReferenceComparison;
}) {
  const rows: [string, ReferenceComparisonRow][] = [
    ['Typical carry', comparison.typical],
    ['Strong-strike (P80)', comparison.strong],
  ];
  return (
    <div className="reference-compare">
      {rows.map(([label, row]) => (
        <p key={label} className="reference-compare-row">
          <span className="reference-compare-label">{label}</span>
          {row.value === null || row.pct === null ? (
            <span className="context">no measured value on this basis</span>
          ) : (
            <>
              <span
                className="reference-compare-bar"
                role="img"
                aria-label={`${label} ${decimal.format(row.value)} m, ${percent.format(row.pct)} of reference, ${row.delta! >= 0 ? '+' : ''}${decimal.format(row.delta!)} m`}
              >
                <span
                  className="reference-compare-fill"
                  style={{ width: `${Math.min(100, row.pct * 100)}%` }}
                />
              </span>
              <span>
                {decimal.format(row.value)} m · {percent.format(row.pct)} of ref ·{' '}
                {row.delta! >= 0 ? '+' : ''}
                {decimal.format(row.delta!)} m
              </span>
            </>
          )}
        </p>
      ))}
    </div>
  );
}

/**
 * The golfer's own user-entered reference for a club (e.g. from a fitting
 * session), labelled as such and never mixed into analytics cohorts or
 * compared across metrics. Shown for every basis — unlike external overlays,
 * it is the user's own number, not an external range-ball-incompatible one.
 */
function PersonalReference({
  club,
  values,
  basis,
  typicalCarry,
  strongCarry,
  equipment,
  onSave,
  onDelete,
  error,
}: {
  club: string;
  values: UserReferenceValueRecord[];
  basis: Basis;
  typicalCarry: number | null;
  strongCarry: number | null;
  equipment: Equipment[];
  onSave: (input: UserReferenceValueSaveInput) => Promise<void>;
  onDelete: (id: string, expectedRevision: number) => Promise<void>;
  error: string;
}) {
  const [editing, setEditing] = useState<ReferenceMetric | null>(null);
  const [metric, setMetric] = useState<ReferenceMetric>('carry');
  const [valueM, setValueM] = useState('');
  const [note, setNote] = useState('');
  const [refBasis, setRefBasis] = useState<ReferenceBasis>('unknown');
  const [source, setSource] = useState<ReferenceSource>('manual');
  const [refType, setRefType] = useState<ReferenceType>('goal');
  const [statistic, setStatistic] = useState<ReferenceStatistic>('other');
  const [recordedOn, setRecordedOn] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  // Baseline captured when editing starts: if another device changes the
  // record meanwhile, submitting with this revision reports a conflict
  // instead of silently overwriting (same pattern as ManageBag).
  const [baseline, setBaseline] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const own = values.filter(
    (v) => v.club.toLowerCase() === club.trim().toLowerCase(),
  );
  const startEdit = (m: ReferenceMetric) => {
    const existing = own.find((v) => v.metric === m);
    setMetric(m);
    setValueM(existing ? String(existing.valueM) : '');
    setNote(existing?.note ?? '');
    setRefBasis(existing?.basis ?? 'unknown');
    setSource(existing?.source ?? 'manual');
    setRefType(existing?.referenceType ?? 'goal');
    setStatistic(existing?.statistic ?? 'other');
    setRecordedOn(existing?.recordedOn ?? '');
    setEquipmentId(existing?.equipmentId ?? '');
    setBaseline(
      existing ? { id: existing.id, revision: existing.revision } : null,
    );
    setEditing(m);
    setLocalError('');
  };

  const submit = async () => {
    const input: UserReferenceValueSaveInput = {
      id: baseline?.id ?? crypto.randomUUID(),
      club: club.trim(),
      metric,
      valueM: Number(valueM),
      note: note.trim() ? note.trim() : null,
      basis: refBasis,
      source,
      // Rating metadata (ADR-0005 §4.5): the reference concepts stay distinct
      // and are respected by rating-reference resolution.
      referenceType: refType,
      statistic,
      recordedOn: recordedOn.trim() ? recordedOn.trim() : null,
      equipmentId: equipmentId ? equipmentId : null,
      revision: baseline?.revision ?? null,
    };
    const problem = validateUserReferenceValue(input);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      await onSave(input);
      setEditing(null);
      setBaseline(null);
    } catch {
      // surfaced via the error prop
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="personal-reference">
      {own.length > 0 &&
        !editing &&
        own.map((v) => {
          // A carry reference compares with carry stats on a compatible
          // basis; a total reference is shown but never compared with carry.
          const comparison =
            v.metric === 'carry'
              ? compareWithReference(
                  v,
                  { typical: typicalCarry, strong: strongCarry },
                  basis,
                )
              : null;
          const equipmentName = v.equipmentId
            ? equipment.find((e) => e.id === v.equipmentId)
            : undefined;
          return (
            <div key={v.metric}>
              <p>
                Personal reference (user-entered):{' '}
                <strong>
                  {decimal.format(v.valueM)} m {v.metric}
                </strong>
                {v.note ? ` · ${v.note}` : ''} · basis {v.basis} · {v.source} ·{' '}
                {REFERENCE_TYPE_LABEL[v.referenceType].toLowerCase()} ·{' '}
                {REFERENCE_STATISTIC_LABEL[v.statistic]} statistic
                {v.recordedOn ? ` · recorded ${v.recordedOn}` : ''}
                {v.equipmentId
                  ? ` · ${equipmentName ? equipmentDisplayName(equipmentName) : 'unknown club'}`
                  : ''}{' '}
                ·{' '}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => startEdit(v.metric)}
                >
                  Edit
                </button>
              </p>
              {comparison && !comparison.compatible && (
                <p className="context">Not compared: {comparison.reason}.</p>
              )}
              {comparison?.compatible && (
                <ReferenceComparisonBars comparison={comparison} />
              )}
              {v.metric === 'total' && (
                <p className="context">
                  Total-distance reference — not compared with carry numbers.
                </p>
              )}
            </div>
          );
        })}
      {!editing && own.length === 0 && (
        <p>
          No personal reference for {club} yet.{' '}
          <button
            type="button"
            className="secondary"
            onClick={() => startEdit('carry')}
          >
            Add personal reference
          </button>
        </p>
      )}
      {editing && (
        <div className="reference-form">
          <label>
            Metric{' '}
            <select
              value={metric}
              onChange={(e) => {
                setMetric(e.target.value as ReferenceMetric);
                startEdit(e.target.value as ReferenceMetric);
              }}
            >
              <option value="carry">carry</option>
              <option value="total">total</option>
            </select>
          </label>
          <label>
            Value (m){' '}
            <input
              type="number"
              min={1}
              max={500}
              step="any"
              value={valueM}
              onChange={(e) => setValueM(e.target.value)}
            />
          </label>
          <label>
            Basis{' '}
            <select
              value={refBasis}
              onChange={(e) => setRefBasis(e.target.value as ReferenceBasis)}
              title="Which measurement basis this reference was recorded on — comparisons never mix bases silently"
            >
              <option value="unknown">unknown</option>
              <option value="range">range ball</option>
              <option value="range-flat">range ball (flat)</option>
              <option value="premium">premium ball</option>
              <option value="premium-flat">premium ball (flat)</option>
            </select>
          </label>
          <label>
            Source{' '}
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as ReferenceSource)}
            >
              <option value="manual">manual entry</option>
              <option value="fitting">fitting session</option>
              <option value="chart">printed chart</option>
              <option value="estimated">estimated</option>
            </select>
          </label>
          <label>
            Type{' '}
            <select
              value={refType}
              onChange={(e) => setRefType(e.target.value as ReferenceType)}
              title="What this reference represents — the three concepts are labelled distinctly and never mixed in ratings"
            >
              <option value="goal">personal goal</option>
              <option value="observed">observed personal best</option>
              <option value="historical-potential">
                historical personal potential
              </option>
            </select>
          </label>
          <label>
            Statistic{' '}
            <select
              value={statistic}
              onChange={(e) => setStatistic(e.target.value as ReferenceStatistic)}
              title="Which statistic this number represents (median, P80, …) — shown with ratings so a median goal is never read as P80"
            >
              <option value="other">other / not a statistic</option>
              <option value="median">median</option>
              <option value="p80">P80</option>
              <option value="mean">mean</option>
            </select>
          </label>
          <label>
            Recorded on{' '}
            <input
              type="date"
              value={recordedOn}
              onChange={(e) => setRecordedOn(e.target.value)}
            />
          </label>
          <label>
            Equipment{' '}
            <select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              title="The physical club this reference was measured with — ratings only apply it while that equipment is assigned to the club's shots"
            >
              <option value="">not tied to equipment</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {equipmentDisplayName(e)} ({e.inrangeLabel})
                </option>
              ))}
            </select>
          </label>
          <label>
            Note{' '}
            <input
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="pill-button"
            disabled={busy}
            onClick={() => void submit()}
          >
            Save
          </button>
          {baseline && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void onDelete(baseline.id, baseline.revision).then(() => {
                  setEditing(null);
                  setBaseline(null);
                })
              }
            >
              Delete
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            Cancel
          </button>
          {(localError || error) && (
            <p className="error">{localError || error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileCard({
  profile,
  focus,
  bagCount,
  basis,
  scores,
  rating,
  referenceValues,
  equipmentList,
  onSaveReference,
  onDeleteReference,
  referenceError,
}: {
  profile: ClubProfile;
  focus: boolean;
  bagCount: number;
  basis: Basis;
  scores: CategoryScores;
  rating: ClubRating | null;
  referenceValues: UserReferenceValueRecord[];
  equipmentList: Equipment[];
  onSaveReference: (input: UserReferenceValueSaveInput) => Promise<void>;
  onDeleteReference: (id: string, expectedRevision: number) => Promise<void>;
  referenceError: string;
}) {
  const {
    club,
    window: range,
    recent,
    latest,
    history,
    gap,
    best,
    basisLabel,
    equipment,
  } = profile;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focus) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
  }, [focus]);
  const windowText =
    range.mode === 'recent'
      ? `Last 60 days (${range.start ?? '—'} to ${range.end}), up to 50 shots per club`
      : `All-time (to ${range.end})`;
  const rangeText = range.firstDate
    ? `${range.firstDate} to ${range.lastDate}`
    : 'no dated shots';
  const latestCarry = latest
    ? latest.recap.potential[latest.recap.potential.preferred]
    : null;
  const latestSpread = latest ? latest.recap.reliability.spread : null;
  const contact = latest?.recap.reliability.contact;
  const gapText = gapNote(gap);
  return (
    <section className="club-profile" aria-labelledby={`club-${club}`}>
      <div className="club-profile-head">
        <h3 id={`club-${club}`} tabIndex={-1} ref={heading}>
          {club}
        </h3>
        <RatingChip rating={rating} />
      </div>
      <p className="context">
        {basisLabel} · {windowText} · {range.sessions}{' '}
        {range.sessions === 1 ? 'session' : 'sessions'} · {range.shots} shots ·{' '}
        {rangeText}
      </p>
      {bagCount > 0 && (
        <p className="context">
          Equipment · {equipment.assigned} of {equipment.shots} shots assigned ·{' '}
          {equipment.coverage}
          {equipment.needsReview > 0 && (
            <>
              {' '}
              ·{' '}
              <span className="pill">
                Needs review: {equipment.needsReview}
              </span>
            </>
          )}
          {equipment.equipment.length > 0 && (
            <>
              {' '}
              ·{' '}
              {equipment.equipment
                .map(equipmentDisplayName)
                .join(', ')}
            </>
          )}
        </p>
      )}
      <ul className="profile-stats">
        <li>
          <strong>
            Typical carry {fmt(recent.typical.median)} m
          </strong>{' '}
          · {cohortLabel(recent.typical.cohort)} · {recent.typical.n} measured,{' '}
          {recent.typical.missing} missing
          {recent.typical.median === null && ' · no carry on this basis'}
          {recent.typical.n < 10 && recent.typical.n > 0 && (
            <span className="pill"> Sample limited</span>
          )}
        </li>
        <li>
          <strong>
            Strong-strike carry (P80) {fmt(recent.potential.value)} m
          </strong>{' '}
          · distance potential when struck well, from {recent.potential.n}{' '}
          measured full swings · not an overall shot-quality score
          {recent.potential.value === null && recent.potential.n > 0 && (
            <span className="pill"> Sample limited</span>
          )}
          {recent.potential.value !== null && !recent.potential.reliable && (
            <span className="pill"> Sample limited</span>
          )}
        </li>
        <li>
          <strong>Carry spread (IQR) {fmt(recent.spread.iqr)} m</strong> · middle
          half of {recent.spread.n} measured carries, mishits and flagged shots
          included · {recent.spread.missing} missing
          {recent.spread.iqr === null && recent.spread.n > 0 && (
            <span className="pill"> Needs 4 measured shots</span>
          )}
          {recent.spread.n > 0 && recent.spread.n < 10 && (
            <span className="pill"> Sample limited</span>
          )}
        </li>
        {recent.lowerTail.p10 !== null && (
          <li>
            <strong>Lower carry tail (P10) {fmt(recent.lowerTail.p10)} m</strong>{' '}
            · from {recent.lowerTail.n} measured carries
          </li>
        )}
      </ul>
      {latest && latestCarry && latestSpread && (
        <p>
          Latest session{' '}
          <a href={sessionHref(latest.session.id)}>
            {visitLabel(latest.session)}
          </a>
          : typical carry {fmt(latestCarry.current.value)} m from{' '}
          {latestCarry.current.measured} measured shots, spread{' '}
          {fmt(latestSpread.current.value)} m — the same numbers as the{' '}
          <a href={sessionHref(latest.session.id)}>session recap</a>
          {contact &&
            contact.full > 0 &&
            ` (contact reviewed for ${contact.reviewed} of ${contact.full} full swings${
              contact.reviewedShare !== null
                ? `, ${percent.format(contact.reviewedShare)}`
                : ''
            })`}
          .
        </p>
      )}
      {best ? (
        <p>
          Longest carry <strong>{fmt(best.value)} m</strong> ·{' '}
          {visitLabel(best.session)} · that session had {best.n} measured,{' '}
          {best.missing} missing for {club}
          {best.n < 10 && <span className="pill"> Sample limited</span>}
          {best.reviewedShare !== null &&
            ` · ${percent.format(best.reviewedShare)} of full swings contact-reviewed`}
          {best.mishit &&
            ` · ${best.mishit === 'confirmed' ? 'confirmed' : 'auto-flagged'} mishit, treat with care`}
          .
        </p>
      ) : (
        <p>No measured carry on this basis for {club} yet.</p>
      )}
      {gapText && <p>{gapText}.</p>}
      {rating && <RatingBreakdown rating={rating} />}
      <CategoryScoresSection scores={scores} />
      <BenchmarkReferences club={club} basis={basis} />
      <PersonalReference
        club={club}
        values={referenceValues}
        basis={basis}
        typicalCarry={recent.typical.median}
        strongCarry={recent.potential.value}
        equipment={equipmentList}
        onSave={onSaveReference}
        onDelete={onDeleteReference}
        error={referenceError}
      />
      <div className="table-wrap">
        <table aria-label={`${club} history across sessions`}>
          <caption>
            {history.length} {history.length === 1 ? 'session' : 'sessions'} on
            the Progress cohort ·{' '}
            <a href="#progress">Open carry charts in Progress</a>
          </caption>
          <thead>
            <tr>
              <th>Session</th>
              <th>Median carry</th>
              <th>Carry spread (IQR)</th>
              <th>Measured / missing</th>
            </tr>
          </thead>
          <tbody>
            {history.map((point) => (
              <tr key={point.session.id}>
                <td>
                  <a href={sessionHref(point.session.id)}>
                    {visitLabel(point.session)}
                  </a>
                </td>
                <td>
                  {point.median === null ? 'No carry' : `${fmt(point.median)} m`}
                </td>
                <td>
                  {point.iqr === null ? 'Needs 4 measured' : `${fmt(point.iqr)} m`}
                </td>
                <td>
                  {point.n} / {point.missing}{' '}
                  {point.n < 10 && point.n > 0 && (
                    <span className="pill">Sample limited</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ClubProfiles({
  data,
  settings,
  onSettingsChange,
  focusClub,
  onManageBag,
  repository,
  refresh,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
  focusClub?: string;
  onManageBag: () => void;
  repository: Repository;
  refresh: () => Promise<void>;
}) {
  const { basis } = settings;
  const query = useMemo(
    () => ({
      mode: settings.mode,
      intent: settings.intent,
      contact: settings.contact,
      hideLikelyMishits: settings.hideLikelyMishits,
      today: localToday(),
    }),
    [settings],
  );
  const profiles = clubProfiles(data, basis, query);
  const [referenceError, setReferenceError] = useState('');
  const saveReference = async (input: UserReferenceValueSaveInput) => {
    try {
      await repository.saveUserReferenceValue(input);
      await refresh();
      setReferenceError('');
    } catch (e) {
      setReferenceError(
        e instanceof Error
          ? e.message
          : 'Could not save the reference. Refresh and try again.',
      );
      throw e;
    }
  };
  const deleteReference = async (id: string, expectedRevision: number) => {
    try {
      await repository.deleteUserReferenceValue(id, expectedRevision);
      await refresh();
      setReferenceError('');
    } catch (e) {
      setReferenceError(
        e instanceof Error
          ? e.message
          : 'Could not delete the reference. Refresh and try again.',
      );
      throw e;
    }
  };
  // Scores reuse the profiles computed above; ratings come from the shared
  // ratings-2 module on the fixed premium-flat rating basis (ADR-0005),
  // memoized so unrelated re-renders do not recompute them.
  const ratingsByClub = useMemo(
    () => new Map(clubRatings(data, query).map((r) => [r.club, r])),
    [data, query],
  );
  const scoresByClub = profiles.map((profile) => ({
    profile,
    scores: categoryScores(data, basis, query, profile.club, profile),
  }));
  return (
    <>
      <div className="section-heading">
        <h1>Club profiles</h1>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Derived · read-only</span>
            <h2>One profile per club</h2>
            <p className="context">
              {settings.mode === 'recent' ? 'Last 60 days' : 'All-time'} ·{' '}
              {settings.hideLikelyMishits && 'Unusual-shot filter on · '}
              {profiles.length} {profiles.length === 1 ? 'club' : 'clubs'}
            </p>
          </div>
          <div className="card-controls">
            <button type="button" className="secondary" onClick={onManageBag}>
              Manage bag
            </button>
            <PerformanceToggle settings={settings} onChange={onSettingsChange} />
            {settings.contact !== 'strong' && (
              <MishitToggle settings={settings} onChange={onSettingsChange} />
            )}
            <ViewToggle
              mode={settings.mode}
              onChange={(mode) => onSettingsChange({ ...settings, mode })}
            />
            <BasisButton
              basis={basis}
              onChange={(next) => onSettingsChange({ ...settings, basis: next })}
            />
          </div>
        </div>
        <p>
          Profiles are derived from your sessions and never change saved data.
          Archived sessions and excluded shots are left out, and a corrected
          club label counts as the club. Typical carry uses reviewed full swings
          with typical contact when at least 10 are measured, otherwise the
          broader estimate; wedges need an explicit full intent. Carry spread is
          the middle half (IQR) of measured carries and includes mishits and
          flagged shots, even when Hide likely mishits is on. Missing measurements
          stay missing on the chosen basis — profiles never fall back to another
          basis. The latest-session line matches that session’s recap; the
          history below matches Progress.
        </p>
        {profiles.length === 0 && (
          <p>
            No club profiles yet. Import a session with club labels to build
            them.
          </p>
        )}
        {scoresByClub.map(({ profile, scores }) => (
          <ProfileCard
            key={profile.club}
            profile={profile}
            focus={focusClub === profile.club}
            bagCount={data.equipment.length}
            basis={basis}
            scores={scores}
            rating={ratingsByClub.get(profile.club) ?? null}
            referenceValues={data.userReferenceValues}
            equipmentList={data.equipment}
            onSaveReference={saveReference}
            onDeleteReference={deleteReference}
            referenceError={referenceError}
          />
        ))}
      </section>
    </>
  );
}
