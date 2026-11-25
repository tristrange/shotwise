import { useEffect, useRef } from 'react';
import { clubProfiles, type ClubProfile } from '../domain/clubProfiles';
import {
  BENCHMARK_SOURCES,
  attributionFor,
  benchmarkReferencesForClub,
} from '../domain/benchmarks';
import {
  CATEGORY_SCORES_VERSION,
  CATEGORY_SCORE_DEFINITIONS,
  CATEGORY_SCORE_ORDER,
  categoryScores,
  type CategoryScore,
  type CategoryScores,
} from '../domain/scores';
import { bagStandings, ordinal, type BagStandings } from '../domain/standings';
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
 * The four category scores from ADR-0003 / `category-scores-1`, shown as raw
 * metrics from the golfer's own shots — no composite score (roadmap §8.3).
 * Insufficient categories show "not enough data" with the reason in a pill.
 */
function CategoryScoresSection({
  scores,
  standings,
}: {
  scores: CategoryScores;
  standings: BagStandings[string];
}) {
  return (
    <div className="category-scores">
      <ul className="profile-stats">
        {CATEGORY_ORDER.map((id) => {
          const score = scores[id];
          const standing = standings[id];
          return (
            <li key={id}>
              <strong>{score.label}</strong> {formatScore(score)} · from{' '}
              {score.n}{' '}
              {score.unit === 'm'
                ? 'measured shots'
                : score.unit === 'deg'
                  ? 'shots with launch direction'
                  : 'assessed full swings'}
              {standing && (
                <span>
                  {' '}
                  · {ordinal(standing.rank)} of {standing.of} clubs in your bag
                </span>
              )}
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
          “not enough data” rather than a guess. There is no composite 0–100
          overall score — carry, direction and mishit share cannot be combined
          meaningfully — so each category instead shows your standing within
          your own bag (ADR-0004). Methodology version{' '}
          {CATEGORY_SCORES_VERSION}.
        </p>
      </details>
    </div>
  );
}

function ProfileCard({
  profile,
  focus,
  bagCount,
  basis,
  scores,
  standings,
}: {
  profile: ClubProfile;
  focus: boolean;
  bagCount: number;
  basis: Basis;
  scores: CategoryScores;
  standings: BagStandings[string];
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
      <h3 id={`club-${club}`} tabIndex={-1} ref={heading}>
        {club}
      </h3>
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
          {best.mishit && ' · confirmed mishit, treat with care'}.
        </p>
      ) : (
        <p>No measured carry on this basis for {club} yet.</p>
      )}
      {gapText && <p>{gapText}.</p>}
      <CategoryScoresSection scores={scores} standings={standings} />
      <BenchmarkReferences club={club} basis={basis} />
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
}: {
  data: Dataset;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
  focusClub?: string;
  onManageBag: () => void;
}) {
  const { basis, ...filters } = settings;
  const query = { ...filters, today: localToday() };
  const profiles = clubProfiles(data, basis, query);
  // Scores reuse the profiles computed above; within-bag standings are
  // derived once for the whole bag (ADR-0004).
  const scoresByClub = profiles.map((profile) => ({
    profile,
    scores: categoryScores(data, basis, query, profile.club, profile),
  }));
  const standings = bagStandings(
    scoresByClub.map(({ profile, scores }) => ({ club: profile.club, scores })),
  );
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
            standings={standings[profile.club]!}
          />
        ))}
      </section>
    </>
  );
}
