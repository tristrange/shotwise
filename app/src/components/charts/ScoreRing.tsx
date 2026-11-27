import { clamp } from './hooks';
import { scoreBand } from './scoreBand';

/**
 * Compact score ring for a 0–100 rating (reference: club-card screenshot).
 * The ring arc AND the numeric score take the shared score-band colour
 * (data-band → --rating-* tokens in ds.css); provisional (dashed) and early
 * (dotted) outlines wrap the ring so evidence state is never colour-only and
 * stays independent of the score colour. A missing rating shows an empty
 * ring with a grey em dash — never zero; a genuine 0 shows a red "0".
 */
export function ScoreRing({
  value,
  provisional = false,
  early = false,
  size = 44,
  stroke = 5,
  label,
}: {
  value: number | null;
  provisional?: boolean;
  early?: boolean;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = value === null ? 0 : clamp(value, 0, 100) / 100;
  const text = value === null ? '—' : String(Math.round(value));
  const band = scoreBand(value);
  const outlineR = size / 2 - 1.5;
  const ariaLabel =
    label ??
    (value === null
      ? 'No rating yet'
      : `Rating ${text} out of 100${provisional ? ', provisional' : ''}${early ? ', early estimate' : ''}`);
  return (
    <span
      className={`ds-score-ring${provisional ? ' provisional' : ''}${early ? ' early' : ''}`}
      data-band={band}
      role="img"
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ring-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        {value !== null && (
          <circle
            className="ring-fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        {(provisional || early) && (
          <circle
            className={`ring-outline${early ? ' early' : ''}`}
            cx={size / 2}
            cy={size / 2}
            r={outlineR}
            fill="none"
            strokeWidth={1}
          />
        )}
        <text
          className={`ring-value${size <= 40 ? ' small' : ''}`}
          x="50%"
          y="50%"
          dy="0.35em"
          textAnchor="middle"
        >
          {text}
        </text>
      </svg>
    </span>
  );
}
