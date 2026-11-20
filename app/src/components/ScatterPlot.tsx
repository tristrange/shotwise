export type ScatterDatum = {
  id: string;
  x: number;
  y: number;
  /** Accessible name of the point, e.g. "Plot 7i row 3 · …". */
  label: string;
  /** Tooltip text shown on hover and focus. */
  title: string;
};

export type ScatterTick = { value: number; text: string };

/**
 * Reusable accessible SVG scatter plot in the Shot shape style: a labelled
 * group whose points are buttons, so tap, click, and keyboard (Enter/Space)
 * all select a point, including points that overlap exactly.
 */
export function ScatterPlot({
  label,
  caption,
  xLabel,
  yLabel,
  xTicks,
  yTicks,
  xDomain,
  yDomain,
  points,
  selectedId,
  onSelect,
}: {
  label: string;
  /** Extra chart text such as the selected measurement basis. */
  caption?: string;
  xLabel: string;
  yLabel: string;
  xTicks: ScatterTick[];
  yTicks: ScatterTick[];
  xDomain: [number, number];
  yDomain: [number, number];
  points: ScatterDatum[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;
  const px = (x: number) => 60 + ((x - xMin) / (xMax - xMin)) * 300;
  const py = (y: number) => 250 - ((y - yMin) / (yMax - yMin)) * 220;
  return (
    <svg
      className="shape-plot"
      viewBox="0 0 400 320"
      role="group"
      aria-label={label}
    >
      <rect
        x="60"
        y="30"
        width="300"
        height="220"
        fill="none"
        stroke="var(--border)"
      />
      {caption && (
        <text x="60" y="20">
          {caption}
        </text>
      )}
      {xTicks.map((tick) => (
        <text
          key={`x-${tick.value}-${tick.text}`}
          x={px(tick.value)}
          y="270"
          textAnchor="middle"
        >
          {tick.text}
        </text>
      ))}
      <text x="210" y="300" textAnchor="middle">
        {xLabel}
      </text>
      {yTicks.map((tick) => (
        <text
          key={`y-${tick.value}-${tick.text}`}
          x="52"
          y={py(tick.value) + 4}
          textAnchor="end"
        >
          {tick.text}
        </text>
      ))}
      <text transform="translate(16 140) rotate(-90)" textAnchor="middle">
        {yLabel}
      </text>
      {points.map((point) => (
        <circle
          className="shape-point"
          key={point.id}
          cx={px(point.x)}
          cy={py(point.y)}
          r={selectedId === point.id ? 7 : 5}
          role="button"
          tabIndex={0}
          aria-label={point.label}
          aria-pressed={selectedId === point.id}
          onClick={() => onSelect(point.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(point.id);
            }
          }}
        >
          <title>{point.title}</title>
        </circle>
      ))}
    </svg>
  );
}
