import { useId, useState } from 'react';
import { ArrowUpRight, ChevronDown, Compass } from 'lucide-react';
import { RATING_BASIS, weakestEvidence } from '../domain/ratings';
import { BASES } from '../domain/model';
import type { ClubCardData } from './clubCardData';
import { clubDisplayName } from './clubNames';
import { Badge, HelpPopover, Metric, MetricGrid } from './ds';
import {
  BenchmarkBar,
  DistributionPlot,
  RatingBreakdown,
  ScoreRing,
} from './charts';

const fmtM = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)} m`);

/**
 * The signature Shotwise component (reference: club-cards screenshot).
 *
 * Collapsed: the WHOLE header row is one accessible expansion button — club
 * badge, name, "carry · potential" line, compact score ring, chevron. The
 * full-profile link is a separate control next to it, never nested inside the
 * button.
 *
 * Expanded (progressive disclosure, animated via grid-rows): launch-monitor
 * metrics, four-category rating bars, carry distribution band, benchmark bar
 * and directional summary. Missing measurements show as —, never zero;
 * provisional/early ratings keep their dashed/dotted ring + badge.
 */
export function ClubCard({
  data,
  href,
  basisLabel,
  carryLabel = 'carry',
  defaultOpen = false,
  scaleMin,
  scaleMax,
}: {
  data: ClubCardData;
  href: string;
  basisLabel: string;
  /** Word after the median: 'carry', 'typical carry', 'strong-strike median'. */
  carryLabel?: string;
  defaultOpen?: boolean;
  /** Shared distribution scale across clubs so plots compare; falls back to this card's own band. */
  scaleMin?: number;
  scaleMax?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const detailId = useId();
  const rating = data.rating;
  const weakest = rating
    ? weakestEvidence(
        [rating.distancePotential, rating.consistency, rating.directionalControl, rating.reliability]
          .filter((cat) => cat.score !== null)
          .map((cat) => cat.evidence),
      )
    : null;
  const composite = rating?.composite ?? null;
  const ringValue = composite?.value ?? null;
  const bandValues = [
    data.band.p10,
    data.band.q1,
    data.band.median,
    data.band.q3,
    data.band.p90,
  ].filter((v): v is number => v !== null);
  const ownMin = bandValues.length ? Math.min(...bandValues) : 0;
  const ownMax = bandValues.length ? Math.max(...bandValues) : 1;
  const pad = (ownMax - ownMin) * 0.12 || 1;
  const plotMin = scaleMin ?? ownMin - pad;
  const plotMax = scaleMax ?? ownMax + pad;
  return (
    <article className={`club-card${open ? ' open' : ''}`}>
      <div className="club-card-top">
        <button
          type="button"
          className="club-card-header"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="club-badge" aria-hidden="true">
            {data.club.toUpperCase()}
          </span>
          <span className="club-id">
            <strong>{clubDisplayName(data.club)}</strong>
            {/* Carry and potential stay on one truncating line; the shot count
                is a separate fixed element so it cannot squeeze the headline
                numbers off-screen at phone widths. */}
            <small>
              {fmtM(data.median)} {carryLabel} · {fmtM(data.potential)} potential
              {!data.reliable && <span className="club-few"> · few shots</span>}
            </small>
          </span>
          <span className="club-shots" title={`${data.total} shots in this view`}>
            {data.total}
          </span>
          <span className="club-card-ring">
            <ScoreRing
              value={ringValue}
              provisional={composite?.provisional ?? false}
              early={weakest === 'early'}
              size={44}
              label={
                ringValue === null
                  ? `${data.club}: no rating yet`
                  : `${data.club} overall rating ${Math.round(ringValue)} of 100${composite?.provisional ? `, provisional, ${composite.coverage} of 4 categories` : ''}${weakest === 'early' ? ', early estimate' : ''}`
              }
            />
          </span>
          <ChevronDown
            size={18}
            className={`club-chevron${open ? ' open' : ''}`}
            aria-hidden="true"
          />
        </button>
        <a
          className="ds-icon-button small club-profile-link"
          href={href}
          aria-label={`Open the full ${data.club} profile`}
          title={`Full ${data.club} profile`}
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
      <div
        className={`club-card-detail${open ? ' open' : ''}`}
        id={detailId}
        // Collapsed content stays out of the tab order and a11y tree while the
        // grid-rows animation plays (visibility handled in ds.css).
        inert={!open}
      >
        <div className="club-card-detail-inner">
          <div className="club-card-row" style={{ marginTop: 0 }}>
            <span className="ds-field-label">
              Launch monitor
              <HelpPopover label="Measurement coverage for this club">
                <p>
                  {data.total} shots in this view · measured: speed {data.speed.n}/{data.total} ·
                  launch {data.launch.n}/{data.total} ·
                  apex {data.apex.n}/{data.total} · carry {data.n}/{data.total}
                  {data.potential !== null && ` · P80 from ${data.potentialN} full swings`}
                </p>
                <p>
                  Missing measurements stay missing on the {basisLabel} basis — they are shown as —,
                  never as zero, and never fall back to another basis.
                </p>
              </HelpPopover>
            </span>
          </div>
          <MetricGrid>
            <Metric
              small
              label="Ball speed"
              value={data.speed.median === null ? '—' : data.speed.median.toFixed(0)}
              unit={data.speed.median === null ? undefined : 'kph'}
            />
            <Metric
              small
              label="Launch"
              value={data.launch.median === null ? '—' : data.launch.median.toFixed(1)}
              unit={data.launch.median === null ? undefined : '°'}
            />
            <Metric
              small
              label="Apex"
              value={data.apex.median === null ? '—' : data.apex.median.toFixed(0)}
              unit={data.apex.median === null ? undefined : 'm'}
            />
            <Metric
              small
              label="Strong-strike P80"
              value={data.potential === null ? '—' : data.potential.toFixed(0)}
              unit={data.potential === null ? undefined : 'm'}
            />
          </MetricGrid>
          {rating && <RatingBreakdown rating={rating} />}
          {!rating && (
            <p className="context">
              No rating yet — fewer than 10 measured shots on the rating basis.
            </p>
          )}
          <div className="club-card-row">
            <span className="ds-field-label">
              Carry distribution · P10–P90 band, IQR, median
              <HelpPopover label="How to read this distribution">
                <p>
                  The wide band is the middle 80% of carries (P10–P90); the darker band is the
                  middle half (IQR, Q1–Q3); the line is the median. Spread comes from all
                  eligible shots, not just the selected performance mode.
                </p>
              </HelpPopover>
            </span>
            <DistributionPlot
              band={data.band}
              min={plotMin}
              max={plotMax}
              label={`${data.club} carry distribution`}
            />
          </div>
          {data.benchmark && (
            <div className="club-card-row">
              {data.benchmark.compatible ? (
                <BenchmarkBar
                  label={`Typical carry vs reference (${basisLabel})`}
                  value={data.benchmark.value}
                  reference={data.benchmark.reference}
                />
              ) : (
                <p className="context">Reference not comparable on this basis — {data.benchmark.reason}.</p>
              )}
            </div>
          )}
          {data.direction && (
            <p className="club-direction">
              <Compass size={13} aria-hidden="true" /> {data.direction.label}: {data.direction.detail}
            </p>
          )}
          <div className="club-card-footer">
            <a className="text-button" href={href}>
              Full club profile →
            </a>
            <span className="context">
              Ratings use the fixed {BASES[RATING_BASIS].label} basis — independent of the{' '}
              {basisLabel} view.
            </span>
          </div>
          {(composite?.provisional || weakest === 'early') && (
            <p className="context">
              {composite?.provisional && (
                <Badge provisional>provisional {composite.coverage}/4 categories</Badge>
              )}{' '}
              {weakest === 'early' && <Badge early>early estimate</Badge>}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
