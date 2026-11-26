import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Wrench } from 'lucide-react';
import type { ClubProfile } from '../domain/clubProfiles';
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
} from '../domain/benchmarks';
import {
  CATEGORY_SCORES_VERSION,
  CATEGORY_SCORE_DEFINITIONS,
  CATEGORY_SCORE_ORDER,
  type CategoryScore,
  type CategoryScores,
} from '../domain/scores';
import { RATING_BASIS, weakestEvidence } from '../domain/ratings';
import type { AnalysisSettings } from '../domain/analytics';
import { equipmentDisplayName } from '../domain/equipment';
import { BASES, type Basis, type Dataset } from '../domain/model';
import {
  BasisButton,
  MishitToggle,
  PerformanceToggle,
  ViewToggle,
} from './AnalysisControls';
import { sessionHref, visitLabel } from './SessionRecap';
import { clubDisplayName } from './clubNames';
import {
  clubProfileViews,
  type ClubProfileView,
  type DirectionCounts,
} from './clubProfileData';
import { ClubHistoryChart } from './ClubHistoryChart';
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  HelpPopover,
  Metric,
  MetricGrid,
  SectionHeader,
} from './ds';
import {
  BenchmarkBar,
  DispersionPlot,
  DistributionPlot,
  RatingBreakdown,
  ScoreRing,
  sharedBandScale,
} from './charts';

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

function gapFlag(gap: ClubProfile['gap']) {
  if (!gap || gap.gap === null) return null;
  return gap.flag === 'small'
    ? 'small median gap'
    : gap.flag === 'reversed'
      ? 'medians reversed'
      : gap.flag === 'large'
        ? 'large gap'
        : null;
}

/** Compact horizontal club selection — deep links to each profile. */
function ClubPicker({ clubs, active }: { clubs: string[]; active?: string }) {
  return (
    <nav className="club-picker" aria-label="Select a club profile">
      <a
        href="#clubs"
        className={active ? '' : 'active'}
        aria-current={active ? undefined : 'true'}
      >
        All clubs
      </a>
      {clubs.map((club) => (
        <a
          key={club}
          href={clubHref(club)}
          className={club === active ? 'active' : ''}
          aria-current={club === active ? 'true' : undefined}
        >
          <span className="club-badge" aria-hidden="true">
            {club.toUpperCase()}
          </span>
          <span className="club-picker-name">{clubDisplayName(club)}</span>
        </a>
      ))}
    </nav>
  );
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
    <Disclosure summary={`External references (${references.length})`} className="benchmark-refs">
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
    </Disclosure>
  );
}

const CATEGORY_ORDER = CATEGORY_SCORE_ORDER;

function formatScore(score: CategoryScore) {
  if (score.value === null) return 'not enough data';
  if (score.unit === 'share') return percent.format(score.value);
  return `${decimal.format(score.value)} ${score.unit}`;
}

/**
 * Raw category measurements (ADR-0003 / `category-scores-1`) behind the
 * normalized rating bars, kept on demand: each category's raw metric with
 * its own sample size and sufficiency note. The four 0–100 ratings and the
 * composite live in the `RatingBreakdown` above (ADR-0005).
 */
function CategoryScoresDisclosure({ scores }: { scores: CategoryScores }) {
  return (
    <div className="category-scores">
      <Disclosure summary="How these are scored">
        <ul>
          {CATEGORY_ORDER.map((id) => {
            const def = CATEGORY_SCORE_DEFINITIONS[id];
            const score = scores[id];
            return (
              <li key={id}>
                <strong>{def.label}.</strong> {def.description} Population: {def.population}{' '}
                Estimator: {def.estimator} Raw value: {formatScore(score)} · from {score.n}{' '}
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
        <p className="context">
          Scores are raw measurements from your own shots on the selected basis, each with its
          sample size; categories with too little data show “not enough data” rather than a
          guess. The normalized 0–100 category ratings and overall composite live in the rating
          breakdown above (ADR-0005, ratings-2); these raw measurements are the evidence behind
          them. Methodology version {CATEGORY_SCORES_VERSION}.
        </p>
      </Disclosure>
    </div>
  );
}

/** Left/straight/right shares of a measured directional metric, with counts. */
function DirectionBar({ counts }: { counts: DirectionCounts }) {
  const total = counts.left + counts.straight + counts.right;
  if (total === 0) return null;
  const seg = (n: number) => (n / total) * 100;
  return (
    <span
      className="direction-bar"
      role="img"
      aria-label={`${counts.n} measured: ${counts.left} left, ${counts.straight} straight, ${counts.right} right`}
    >
      <span className="seg left" style={{ width: `${seg(counts.left)}%` }} />
      <span className="seg straight" style={{ width: `${seg(counts.straight)}%` }} />
      <span className="seg right" style={{ width: `${seg(counts.right)}%` }} />
    </span>
  );
}

/** Dispersion plot where both carry and lateral finishing position are measured. */
function DispersionSection({
  view,
}: {
  view: ClubProfileView;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!view.dispersion || view.corridorHalfWidth === null) return null;
  return (
    <Disclosure summary="Dispersion plot (carry vs lateral)">
      <DispersionPlot
        points={view.dispersion}
        corridorHalfWidth={view.corridorHalfWidth}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <p className="context">
        Only shots with both carry and lateral finishing position measured are plotted — missing
        lateral data is never drawn as zero. The dashed funnel is the ±
        {Math.round(view.corridorHalfWidth * 100)}% × carry corridor for this club’s role.
      </p>
    </Disclosure>
  );
}

/**
 * The golfer's own user-entered reference for a club (e.g. from a fitting
 * session), labelled as such and never mixed into analytics cohorts or
 * compared across metrics. The carry comparison itself renders in the
 * benchmarks section; total references are shown but never compared with
 * carry. Shown for every basis — it is the user's own number.
 */
function PersonalReference({
  club,
  values,
  equipment,
  onSave,
  onDelete,
  error,
}: {
  club: string;
  values: UserReferenceValueRecord[];
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
    <section className="profile-section personal-reference" aria-label="Personal reference">
      <span className="ds-field-label">Personal reference</span>
      {own.length > 0 &&
        !editing &&
        own.map((v) => {
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
                <Button variant="secondary" small onClick={() => startEdit(v.metric)}>
                  Edit
                </Button>
              </p>
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
          <Button variant="secondary" small onClick={() => startEdit('carry')}>
            Add personal reference
          </Button>
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
          <div className="reference-form-actions">
            <Button small disabled={busy} onClick={() => void submit()}>
              Save
            </Button>
            {baseline && (
              <Button
                variant="secondary"
                small
                disabled={busy}
                onClick={() =>
                  void onDelete(baseline.id, baseline.revision).then(() => {
                    setEditing(null);
                    setBaseline(null);
                  })
                }
              >
                Delete
              </Button>
            )}
            <Button variant="secondary" small disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
          {(localError || error) && (
            <p className="error">{localError || error}</p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One full club profile: a deeper version of the Overview ClubCard — header
 * with badge, readable name and the overall rating ring, headline metrics,
 * category ratings, distribution, benchmarks, direction, facts, personal
 * reference editing and the interactive session history. Exported so the
 * dev showcase can render it on synthetic data.
 */
export function ClubProfileCard({
  view,
  focus,
  bagCount,
  basis,
  scale,
  referenceValues,
  equipmentList,
  onSaveReference,
  onDeleteReference,
  referenceError,
}: {
  view: ClubProfileView;
  focus: boolean;
  bagCount: number;
  basis: Basis;
  scale: { min: number; max: number };
  referenceValues: UserReferenceValueRecord[];
  equipmentList: Equipment[];
  onSaveReference: (input: UserReferenceValueSaveInput) => Promise<void>;
  onDeleteReference: (id: string, expectedRevision: number) => Promise<void>;
  referenceError: string;
}) {
  const { profile, scores, rating, band } = view;
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
  const composite = rating?.composite ?? null;
  const compositeValue = composite?.value ?? null;
  const weakest = rating
    ? weakestEvidence(
        [
          rating.distancePotential,
          rating.consistency,
          rating.directionalControl,
          rating.reliability,
        ]
          .filter((cat) => cat.score !== null)
          .map((cat) => cat.evidence),
      )
    : null;
  const headingId = `club-${club}`;
  return (
    <section className="club-profile ds-card" aria-labelledby={headingId}>
      <header className="club-profile-head">
        <span className="club-badge lg" aria-hidden="true">
          {club.toUpperCase()}
        </span>
        <div className="club-profile-title">
          <h3 id={headingId} tabIndex={-1} ref={heading}>
            <span className="sr-only">{club}</span>
            <span aria-hidden="true">{clubDisplayName(club)}</span>
          </h3>
          <p className="context">
            {basisLabel} · {windowText} · {range.sessions}{' '}
            {range.sessions === 1 ? 'session' : 'sessions'} · {range.shots} shots ·{' '}
            {rangeText}
          </p>
        </div>
        <div className="club-profile-ring">
          <ScoreRing
            value={compositeValue}
            provisional={composite?.provisional ?? false}
            early={weakest === 'early'}
            size={64}
            stroke={6}
            label={
              compositeValue === null
                ? `${club}: no rating yet`
                : `${club} overall rating ${Math.round(compositeValue)} of 100${composite?.provisional ? `, provisional, ${composite.coverage} of 4 categories` : ''}${weakest === 'early' ? ', early estimate' : ''}`
            }
          />
          <span className="club-profile-ring-basis">
            rating · {BASES[RATING_BASIS].label}
          </span>
        </div>
        {/* Evidence badges sit on their own full-width row so they can never
            squeeze the club-name column to zero width at phone widths. */}
        <div className="club-profile-badges">
          {composite?.provisional && (
            <Badge provisional>provisional {composite.coverage}/4</Badge>
          )}
          {weakest === 'early' && <Badge early>early estimate</Badge>}
        </div>
      </header>

      <MetricGrid>
        <Metric
          label="Typical carry"
          value={fmt(recent.typical.median)}
          unit={recent.typical.median === null ? undefined : 'm'}
        />
        <Metric
          label="Strong-strike carry (P80)"
          value={fmt(recent.potential.value)}
          unit={recent.potential.value === null ? undefined : 'm'}
        />
        <Metric
          small
          label="Ball speed"
          value={view.speed.median === null ? '—' : view.speed.median.toFixed(0)}
          unit={view.speed.median === null ? undefined : 'kph'}
        />
        <Metric
          small
          label="Launch"
          value={view.launch.median === null ? '—' : view.launch.median.toFixed(1)}
          unit={view.launch.median === null ? undefined : '°'}
        />
        <Metric
          small
          label="Apex"
          value={view.apex.median === null ? '—' : view.apex.median.toFixed(0)}
          unit={view.apex.median === null ? undefined : 'm'}
        />
      </MetricGrid>
      <div className="profile-extras">
        {recent.typical.n < 10 && recent.typical.n > 0 && (
          <Badge tone="warn">Sample limited</Badge>
        )}
        {(recent.potential.value === null && recent.potential.n > 0) ||
          (recent.potential.value !== null && !recent.potential.reliable) ? (
          <Badge tone="warn">Sample limited</Badge>
        ) : null}
        {recent.spread.iqr === null && recent.spread.n > 0 && (
          <Badge tone="warn">Needs 4 measured shots</Badge>
        )}
        {recent.spread.n > 0 && recent.spread.n < 10 && (
          <Badge tone="warn">Sample limited</Badge>
        )}
        <HelpPopover label="Measurement coverage and cohorts">
          <p>
            Typical carry: {cohortLabel(recent.typical.cohort)} · {recent.typical.n} measured,{' '}
            {recent.typical.missing} missing
            {recent.typical.median === null ? ' · no carry on this basis' : ''}.
          </p>
          <p>
            Strong-strike carry (P80): distance potential when struck well, from{' '}
            {recent.potential.n} measured full swings · not an overall shot-quality score.
          </p>
          <p>
            Carry spread (IQR): middle half of {recent.spread.n} measured carries, mishits and
            flagged shots included · {recent.spread.missing} missing.
          </p>
          <p>
            Launch monitor on the selected cohort: speed {view.speed.n}/{view.total} · launch{' '}
            {view.launch.n}/{view.total} · apex {view.apex.n}/{view.total} · carry{' '}
            {view.carryMeasured.n}/{view.total} measured.
          </p>
          <p>
            Missing measurements stay missing on the {basisLabel} basis — profiles never fall
            back to another basis.
          </p>
        </HelpPopover>
      </div>

      <section className="profile-section">
        <span className="ds-field-label">
          Overall rating
          <HelpPopover label="Rating basis and evidence">
            <p>
              Ratings use the fixed {BASES[RATING_BASIS].label} rating basis — independent of the{' '}
              {basisLabel} view. Weakest category evidence:{' '}
              {weakest ?? 'none'}. Sample sizes, visits, uncertainty intervals and reference
              metadata are in the breakdown below.
            </p>
          </HelpPopover>
        </span>
        {rating ? (
          <RatingBreakdown rating={rating} />
        ) : (
          <p className="context">
            No rating yet — fewer than 10 measured shots on the rating basis.
          </p>
        )}
        <p className="context">
          Ratings use the fixed {BASES[RATING_BASIS].label} basis — independent of the{' '}
          {basisLabel} view.
        </p>
        <CategoryScoresDisclosure scores={scores} />
      </section>

      <section className="profile-section">
        <span className="ds-field-label">
          Carry distribution
          <HelpPopover label="How to read this distribution">
            <p>
              The wide band is the middle 80% of carries (P10–P90); the darker band is the middle
              half (IQR, Q1–Q3); the line is the median. Spread comes from all eligible shots, not
              just the selected performance mode. The scale is shared across every club on this
              page, so bands compare across clubs.
            </p>
          </HelpPopover>
        </span>
        <DistributionPlot
          band={band}
          min={scale.min}
          max={scale.max}
          label={`${club} carry distribution`}
        />
        <p className="context">
          Carry spread (IQR) {fmt(recent.spread.iqr)} m · middle half of {recent.spread.n}{' '}
          measured carries · {recent.spread.missing} missing
          {recent.lowerTail.p10 !== null && (
            <> · Lower carry tail (P10) {fmt(recent.lowerTail.p10)} m from {recent.lowerTail.n} measured carries</>
          )}
        </p>
      </section>

      <section className="profile-section">
        <span className="ds-field-label">
          Distance benchmarks
          <HelpPopover label="How benchmarks compare">
            <p>
              Your personal reference is compared on the current {basisLabel} basis only — a
              range-ball reference never compares with premium-ball measurements and vice versa.
              External references below are link-outs only, never embedded numbers.
            </p>
          </HelpPopover>
        </span>
        {view.benchmark?.comparison.compatible ? (
          <div className="profile-benchmark-bars">
            <BenchmarkBar
              label={`Typical carry vs personal reference (${REFERENCE_TYPE_LABEL[view.benchmark.referenceType].toLowerCase()}${view.benchmark.referenceStatistic !== 'other' ? ` · ${REFERENCE_STATISTIC_LABEL[view.benchmark.referenceStatistic].toLowerCase()}` : ''})`}
              value={view.benchmark.comparison.typical.value}
              reference={view.benchmark.referenceValueM}
            />
            <BenchmarkBar
              label="Strong-strike carry (P80) vs personal reference"
              value={view.benchmark.comparison.strong.value}
              reference={view.benchmark.referenceValueM}
            />
          </div>
        ) : view.benchmark ? (
          <p className="context">Not compared: {view.benchmark.comparison.reason}.</p>
        ) : (
          <p className="context">
            No personal carry reference for {club} yet — add one below to benchmark this club.
          </p>
        )}
        <BenchmarkReferences club={club} basis={basis} />
      </section>

      <section className="profile-section">
        <span className="ds-field-label">Direction</span>
        {view.direction ? (
          <>
            <p className="club-direction">
              <Compass size={13} aria-hidden="true" /> {view.direction.label}:{' '}
              {view.direction.detail}
            </p>
            {view.direction.counts && <DirectionBar counts={view.direction.counts} />}
            {view.direction.launchOnly && (
              <p className="context">
                Launch direction only — no finishing-position data, so landing dispersion is not
                measured.
              </p>
            )}
            <DispersionSection view={view} />
          </>
        ) : (
          <p className="context">Direction not measured on this basis.</p>
        )}
      </section>

      <section className="profile-section">
        <span className="ds-field-label">Facts</span>
        <MetricGrid>
          {best ? (
            <Metric
              small
              label={
                <>
                  Longest carry ·{' '}
                  <a href={sessionHref(best.session.id)}>
                    {visitLabel(best.session)}
                  </a>
                </>
              }
              value={fmt(best.value)}
              unit="m"
              delta={
                <>
                  {best.n} measured, {best.missing} missing for {club}
                  {best.n < 10 && <Badge tone="warn"> Sample limited</Badge>}
                  {best.reviewedShare !== null &&
                    ` · ${percent.format(best.reviewedShare)} of full swings contact-reviewed`}
                  {best.mishit &&
                    ` · ${best.mishit === 'confirmed' ? 'confirmed' : 'auto-flagged'} mishit, treat with care`}
                </>
              }
            />
          ) : (
            <Metric
              small
              label="Longest carry"
              value="—"
              delta={`No measured carry on this basis for ${club} yet`}
            />
          )}
          {gap && gap.gap !== null && (
            <Metric
              small
              label="Gap to the next longer club"
              value={decimal.format(gap.gap)}
              unit="m"
              delta={gapFlag(gap) ?? undefined}
            />
          )}
          {latest && latestCarry && latestSpread && (
            <Metric
              small
              label={
                <>
                  Latest session ·{' '}
                  <a href={sessionHref(latest.session.id)}>
                    {visitLabel(latest.session)}
                  </a>
                </>
              }
              value={fmt(latestCarry.current.value)}
              unit="m"
              delta={
                <>
                  typical carry from {latestCarry.current.measured} measured shots · spread{' '}
                  {fmt(latestSpread.current.value)} m ·{' '}
                  <a href={sessionHref(latest.session.id)}>session recap</a>
                  {contact &&
                    contact.full > 0 &&
                    ` (contact reviewed for ${contact.reviewed} of ${contact.full} full swings${
                      contact.reviewedShare !== null
                        ? `, ${percent.format(contact.reviewedShare)}`
                        : ''
                    })`}
                </>
              }
            />
          )}
        </MetricGrid>
        {bagCount > 0 && (
          <p className="context">
            <Wrench size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Equipment ·{' '}
            {equipment.assigned} of {equipment.shots} shots assigned · {equipment.coverage}
            {equipment.needsReview > 0 && (
              <>
                {' '}
                · <Badge tone="warn">Needs review: {equipment.needsReview}</Badge>
              </>
            )}
            {equipment.equipment.length > 0 && (
              <> · {equipment.equipment.map(equipmentDisplayName).join(', ')}</>
            )}
          </p>
        )}
      </section>

      <PersonalReference
        club={club}
        values={referenceValues}
        equipment={equipmentList}
        onSave={onSaveReference}
        onDelete={onDeleteReference}
        error={referenceError}
      />

      <section className="profile-section">
        <span className="ds-field-label">Session history</span>
        <ClubHistoryChart club={club} points={history} />
        <Disclosure
          summary={`Session table (${history.length} ${history.length === 1 ? 'session' : 'sessions'})`}
        >
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
                        <Badge tone="warn">Sample limited</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </section>
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
  // All figures come from the shared domain functions via clubProfileViews;
  // ratings stay on the fixed premium-flat rating basis (ADR-0005).
  const views = useMemo(
    () => clubProfileViews(data, basis, settings),
    [data, basis, settings],
  );
  // One shared scale for every profile's distribution band, so the plots
  // compare across clubs.
  const bandScale = useMemo(
    () => sharedBandScale(views.map((view) => view.band)),
    [views],
  );
  // A deep-linked club (#clubs/7i) shows that one full profile; the plain
  // #clubs view lists every profile.
  const focused = focusClub
    ? views.find((view) => view.profile.club === focusClub)
    : undefined;
  const visibleViews = focused ? [focused] : views;
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
  return (
    <>
      <div className="section-heading">
        <h1>Club profiles</h1>
      </div>
      <Card className="club-profiles-head">
        <SectionHeader
          title={
            focused
              ? `Profile: ${clubDisplayName(focused.profile.club)}`
              : 'One profile per club'
          }
          sub={`${settings.mode === 'recent' ? 'Last 60 days' : 'All-time'} · ${
            settings.hideLikelyMishits ? 'Unusual-shot filter on · ' : ''
          }${views.length} ${views.length === 1 ? 'club' : 'clubs'}${focused ? ' · showing 1' : ''}`}
          aside={
            <div className="card-controls">
              <Button variant="secondary" small onClick={onManageBag}>
                Manage bag
              </Button>
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
          }
        />
        {views.length > 0 && (
          <ClubPicker clubs={views.map((view) => view.profile.club)} active={focusClub} />
        )}
        <Disclosure summary="How these profiles are derived">
          <p>
            Profiles are derived from your sessions and never change saved data. Archived
            sessions and excluded shots are left out, and a corrected club label counts as the
            club. Typical carry uses reviewed full swings with typical contact when at least 10
            are measured, otherwise the broader estimate; wedges need an explicit full intent.
            Carry spread is the middle half (IQR) of measured carries and includes mishits and
            flagged shots, even when Hide likely mishits is on. Missing measurements stay
            missing on the chosen basis — profiles never fall back to another basis. The
            latest-session line matches that session’s recap; the history below matches
            Progress.
          </p>
        </Disclosure>
        {views.length === 0 && (
          <EmptyState title="No club profiles yet">
            Import a session with club labels to build them.
          </EmptyState>
        )}
      </Card>
      <div className="club-profile-list">
        {visibleViews.map((view) => (
          <ClubProfileCard
            key={view.profile.club}
            view={view}
            focus={focusClub === view.profile.club}
            bagCount={data.equipment.length}
            basis={basis}
            scale={bandScale}
            referenceValues={data.userReferenceValues}
            equipmentList={data.equipment}
            onSaveReference={saveReference}
            onDeleteReference={deleteReference}
            referenceError={referenceError}
          />
        ))}
      </div>
    </>
  );
}
