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
  const x = (v: number) => ((v - min) / span) * 300;
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
      <svg viewBox="0 0 300 44" aria-hidden="true">
        {complete && (
          <>
            <rect
              className="band-p"
              x={x(band.p10!)}
              y={10}
              width={Math.max(1, x(band.p90!) - x(band.p10!))}
              height={16}
              rx={8}
            />
            <rect
              className="band-iqr"
              x={x(band.q1!)}
              y={10}
              width={Math.max(1, x(band.q3!) - x(band.q1!))}
              height={16}
              rx={8}
            />
            <line
              className="median"
              x1={x(band.median!)}
              x2={x(band.median!)}
              y1={6}
              y2={30}
            />
            <text x={x(band.p10!)} y={42} textAnchor="middle">
              {band.p10!.toFixed(0)}
            </text>
            <text x={x(band.p90!)} y={42} textAnchor="middle">
              {band.p90!.toFixed(0)}
            </text>
          </>
        )}
        {!complete && (
          <text x={150} y={24} textAnchor="middle">
            spread needs 10+ measured shots
          </text>
        )}
      </svg>
    </div>
  );
}
