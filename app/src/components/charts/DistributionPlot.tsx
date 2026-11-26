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
  const span = max - min || 1;
  // 4px horizontal padding so the rounded band ends are never clipped.
  const x = (v: number) => 4 + ((v - min) / span) * 292;
  const complete =
    band.p10 !== null && band.q1 !== null && band.median !== null &&
    band.q3 !== null && band.p90 !== null;
  const inScale =
    compare !== undefined && compare !== null && compare >= min && compare <= max;
  const fmt = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}${unit}`);
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
        viewBox="0 0 300 40"
        preserveAspectRatio={stretch ? 'none' : undefined}
        aria-hidden="true"
      >
        {complete && (
          <>
            {/* outer band P10–P90: 12px tall, fully rounded ends (rx = h/2) */}
            <rect
              className="band-p"
              x={x(band.p10!)}
              y={6}
              width={Math.max(12, x(band.p90!) - x(band.p10!))}
              height={12}
              rx={6}
            />
            {/* inner band Q1–Q3 (IQR): 6px tall, fully rounded ends */}
            <rect
              className="band-iqr"
              x={x(band.q1!)}
              y={9}
              width={Math.max(6, x(band.q3!) - x(band.q1!))}
              height={6}
              rx={3}
            />
            {labels && (
              <>
                <text x={x(band.p10!)} y={37} textAnchor="middle">
                  {band.p10!.toFixed(0)}
                </text>
                <text x={x(band.p90!)} y={37} textAnchor="middle">
                  {band.p90!.toFixed(0)}
                </text>
              </>
            )}
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
          <text x={150} y={22} textAnchor="middle">
            spread needs 10+ measured shots
          </text>
        )}
      </svg>
    </div>
  );
}
