import { useId } from 'react';

export type DispersionPoint = {
  id: string;
  /** Carry distance (x axis). */
  x: number;
  /** Lateral finishing position from the intended line, metres (y axis, + right). */
  y: number;
  label: string;
  title: string;
};

/**
 * Directional dispersion plot: carry (x) vs lateral position (y) with the
 * corridor band (± corridorHalfWidth × carry) drawn as a funnel. Points are
 * real focusable SVG buttons — tap/click/Enter selects, arrow keys move —
 * matching the existing ScatterPlot interaction pattern. Only measured shots
 * are plotted; missing lateral data is never drawn as zero.
 */
export function DispersionPlot({
  points,
  corridorHalfWidth,
  xLabel = 'Carry (m)',
  yLabel = 'Lateral (m)',
  selectedId,
  onSelect,
}: {
  points: DispersionPoint[];
  corridorHalfWidth: number;
  xLabel?: string;
  yLabel?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const labelId = useId();
  const W = 400;
  const H = 300;
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 34;
  const xs = points.map((p) => p.x);
  const ys = points.flatMap((p) => [p.y, -p.y, corridorHalfWidth * p.x, -corridorHalfWidth * p.x]);
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const yMax = ys.length ? Math.max(...ys) * 1.15 : 1;
  const px = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const py = (y: number) => padT + (1 - (y + yMax) / (2 * yMax)) * (H - padT - padB);
  const xTicks = 4;
  const tabStop = points.some((p) => p.id === selectedId) ? selectedId : (points[0]?.id ?? null);
  return (
    <svg
      className="ds-scatter ds-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-labelledby={labelId}
    >
      <title id={labelId}>Shot dispersion: carry versus lateral position</title>
      {/* corridor funnel */}
      {points.length > 0 && (
        <polygon
          className="corridor"
          points={`${px(xMin)},${py(corridorHalfWidth * xMin)} ${px(xMax)},${py(corridorHalfWidth * xMax)} ${px(xMax)},${py(-corridorHalfWidth * xMax)} ${px(xMin)},${py(-corridorHalfWidth * xMin)}`}
        />
      )}
      {/* axes */}
      <line className="axis" x1={padL} x2={W - padR} y1={py(0)} y2={py(0)} />
      <line className="axis" x1={padL} x2={padL} y1={padT} y2={H - padB} />
      {Array.from({ length: xTicks + 1 }, (_, i) => {
        const v = xMin + ((xMax - xMin) * i) / xTicks;
        return (
          <text key={`x${i}`} x={px(v)} y={H - padB + 16} textAnchor="middle">
            {v.toFixed(0)}
          </text>
        );
      })}
      {[-1, 0, 1].map((k) => (
        <text key={`y${k}`} x={padL - 6} y={py(k * yMax) + 4} textAnchor="end">
          {k === 0 ? '0' : `${(k * yMax).toFixed(0)}`}
        </text>
      ))}
      <text x={(padL + W - padR) / 2} y={H - 4} textAnchor="middle">
        {xLabel}
      </text>
      <text transform={`translate(12 ${(padT + H - padB) / 2}) rotate(-90)`} textAnchor="middle">
        {yLabel}
      </text>
      {points.map((point, index) => (
        <circle
          key={point.id}
          className="ds-scatter-point"
          cx={px(point.x)}
          cy={py(point.y)}
          r={selectedId === point.id ? 7 : 5}
          role="button"
          tabIndex={point.id === tabStop ? 0 : -1}
          aria-label={point.label}
          aria-pressed={selectedId === point.id}
          onClick={() => onSelect(point.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(point.id);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const next = points[index + (event.key === 'ArrowLeft' ? -1 : 1)];
              const element =
                event.key === 'ArrowLeft'
                  ? event.currentTarget.previousElementSibling
                  : event.currentTarget.nextElementSibling;
              if (next && element instanceof SVGElement) {
                element.focus();
                onSelect(next.id);
              }
            }
          }}
        >
          <title>{point.title}</title>
        </circle>
      ))}
    </svg>
  );
}
