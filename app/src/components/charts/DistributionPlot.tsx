import { SrOnly } from '../ds';

export type DistributionBand = {
  p10: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  p90: number | null;
};

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
}: {
  band: DistributionBand;
  min: number;
  max: number;
  unit?: string;
  label: string;
}) {
  const span = max - min || 1;
  // 4px horizontal padding so the rounded band ends are never clipped.
  const x = (v: number) => 4 + ((v - min) / span) * 292;
  const complete =
    band.p10 !== null && band.q1 !== null && band.median !== null &&
    band.q3 !== null && band.p90 !== null;
  const fmt = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}${unit}`);
  return (
    <div className="ds-distribution">
      <SrOnly>
        {label}: P10 {fmt(band.p10)}, first quartile {fmt(band.q1)}, median{' '}
        {fmt(band.median)}, third quartile {fmt(band.q3)}, P90 {fmt(band.p90)}.
      </SrOnly>
      <svg viewBox="0 0 300 40" aria-hidden="true">
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
            <line
              className="median"
              x1={x(band.median!)}
              x2={x(band.median!)}
              y1={3}
              y2={21}
            />
            <text x={x(band.p10!)} y={37} textAnchor="middle">
              {band.p10!.toFixed(0)}
            </text>
            <text x={x(band.p90!)} y={37} textAnchor="middle">
              {band.p90!.toFixed(0)}
            </text>
          </>
        )}
        {!complete && (
          <text x={150} y={22} textAnchor="middle">
            spread needs 10+ measured shots
          </text>
        )}
      </svg>
    </div>
  );
}
