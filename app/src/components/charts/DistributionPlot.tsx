import { SrOnly } from '../ds';

export type DistributionBand = {
  p10: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  p90: number | null;
};

/**
 * One shared scale for several distribution plots that are meant to be
 * compared across clubs: the padded range of every band value, rounded
 * outward to whole 10-unit steps so neighbouring clubs read on the same
 * meaningful scale instead of each plot zooming to its own band.
 */
export function sharedBandScale(bands: readonly DistributionBand[]): {
  min: number;
  max: number;
} {
  const values = bands
    .flatMap((band) => [band.p10, band.q1, band.median, band.q3, band.p90])
    .filter((v): v is number => v !== null);
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.12 || Math.max(1, max * 0.05);
  const lo = Math.floor((min - pad) / 10) * 10;
  const hi = Math.ceil((max + pad) / 10) * 10;
  return hi > lo ? { min: lo, max: hi } : { min: lo, max: lo + 10 };
}

/* The plot's SVG geometry lives in exactly one place: a 300-unit viewBox with
   4px horizontal padding. `bandX` maps a value to an SVG x coordinate and
   `bandPercent` to a percentage of the plot width — the gapping axis row uses
   the same mapping so its tick labels align with the stretched band rows. */
export const BAND_VIEWBOX = { width: 300, height: 40, pad: 4 } as const;

export function bandX(value: number, min: number, max: number): number {
  const span = max - min || 1;
  return BAND_VIEWBOX.pad + ((value - min) / span) * (BAND_VIEWBOX.width - 2 * BAND_VIEWBOX.pad);
}

export function bandPercent(value: number, min: number, max: number): number {
  return (bandX(value, min, max) / BAND_VIEWBOX.width) * 100;
}

/**
 * Carry distribution band: outer band = P10–P90 (middle 80%), inner band =
 * IQR (Q1–Q3, the middle half), line = median. Percentile range and IQR stay
 * visually distinct. All values in the same unit; missing stats simply don't
 * render — never zero. The scale is [min, max] supplied by the caller so
 * several clubs can share one scale.
 */
export function DistributionPlot({
  band,
  min,
  max,
  unit = 'm',
  label,
  compare,
  labels = true,
  stretch = false,
}: {
  band: DistributionBand;
  min: number;
  max: number;
  unit?: string;
  label: string;
  /**
   * Optional comparison marker (e.g. strong-strike P80) drawn as a dashed
   * line in --compare at the same scale — used by the shared gapping chart.
   */
  compare?: number | null;
  /** P10/P90 end labels; off when rows share one axis drawn elsewhere. */
  labels?: boolean;
  /**
   * Stretch the 300-unit viewBox to the full container width
   * (preserveAspectRatio="none") for full-width band rows such as the gapping
   * chart. Only marks are drawn then — no text, which would distort.
   */
  stretch?: boolean;
}) {
  const x = (v: number) => bandX(v, min, max);
  const complete =
    band.p10 !== null && band.q1 !== null && band.median !== null &&
    band.q3 !== null && band.p90 !== null;
  const inScale =
    compare !== undefined && compare !== null && compare >= min && compare <= max;
  const fmt = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}${unit}`);
  // Bands render at their true scaled coordinates — a minimum pixel width
  // would overstate narrow ranges and shift the visual endpoint to the right.
  // Coincident endpoints (zero-width band) draw as a tick instead.
  const p10x = band.p10 === null ? null : x(band.p10);
  const p90x = band.p90 === null ? null : x(band.p90);
  const q1x = band.q1 === null ? null : x(band.q1);
  const q3x = band.q3 === null ? null : x(band.q3);
  const outerWidth = p10x !== null && p90x !== null ? p90x - p10x : null;
  const innerWidth = q1x !== null && q3x !== null ? q3x - q1x : null;
  // Endpoint labels overlap when the band is narrower than ~two label widths;
  // then one combined "a–b" label is drawn instead of two colliding texts.
  const closeLabels =
    labels && p10x !== null && p90x !== null && outerWidth !== null && outerWidth < 26;
  return (
    <div className="ds-distribution">
      <SrOnly>
        {label}: P10 {fmt(band.p10)}, first quartile {fmt(band.q1)}, median{' '}
        {fmt(band.median)}, third quartile {fmt(band.q3)}, P90 {fmt(band.p90)}
        {compare !== undefined && compare !== null
          ? `, comparison ${fmt(compare)}`
          : ''}.
      </SrOnly>
      <svg
        viewBox={`0 0 ${BAND_VIEWBOX.width} ${BAND_VIEWBOX.height}`}
        preserveAspectRatio={stretch ? 'none' : undefined}
        aria-hidden="true"
      >
        {complete && (
          <>
            {/* outer band P10–P90: 12px tall, fully rounded ends (rx = h/2) */}
            {outerWidth! > 0.5 ? (
              <rect
                className="band-p"
                x={p10x!}
                y={6}
                width={outerWidth!}
                height={12}
                rx={6}
              />
            ) : (
              <line className="band-p band-tick" x1={p10x!} x2={p10x!} y1={6} y2={18} strokeWidth={12} />
            )}
            {/* inner band Q1–Q3 (IQR): 6px tall, fully rounded ends */}
            {innerWidth! > 0.5 ? (
              <rect
                className="band-iqr"
                x={q1x!}
                y={9}
                width={innerWidth!}
                height={6}
                rx={3}
              />
            ) : (
              <line className="band-iqr band-tick" x1={q1x!} x2={q1x!} y1={9} y2={15} strokeWidth={6} />
            )}
            {labels &&
              (closeLabels ? (
                <text x={(p10x! + p90x!) / 2} y={37} textAnchor="middle">
                  {band.p10!.toFixed(0)}–{band.p90!.toFixed(0)}
                </text>
              ) : (
                <>
                  <text x={p10x!} y={37} textAnchor="middle">
                    {band.p10!.toFixed(0)}
                  </text>
                  <text x={p90x!} y={37} textAnchor="middle">
                    {band.p90!.toFixed(0)}
                  </text>
                </>
              ))}
          </>
        )}
        {/* median and comparison markers render even when the full band is
            sample-limited — a measured median is never hidden, never zero */}
        {band.median !== null && band.median >= min && band.median <= max && (
          <line
            className="median"
            x1={x(band.median)}
            x2={x(band.median)}
            y1={3}
            y2={21}
          />
        )}
        {inScale && (
          <line
            className="band-compare"
            x1={x(compare!)}
            x2={x(compare!)}
            y1={3}
            y2={21}
          />
        )}
        {!complete && !stretch && (
          <text x={BAND_VIEWBOX.width / 2} y={22} textAnchor="middle">
            P10–P90 needs 10+ measured shots
          </text>
        )}
      </svg>
    </div>
  );
}
