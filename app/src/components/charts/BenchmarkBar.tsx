import { percent } from '../ds/rangeMath';

/**
 * Benchmark comparison bar with a target marker (reference value). The fill
 * is the measured value on a scale shared with the reference; the marker is
 * the reference itself. Delta text colours by sign; basis-incompatible
 * references are never compared silently — the caller passes reference=null
 * and shows the reason instead.
 */
export function BenchmarkBar({
  label,
  value,
  reference,
  unit = 'm',
  valueLabel,
}: {
  label: string;
  value: number | null;
  reference: number | null;
  unit?: string;
  valueLabel?: string;
}) {
  const scaleMax = Math.max(value ?? 0, reference ?? 0, 1) * 1.12;
  const delta =
    value !== null && reference !== null ? value - reference : null;
  const pct = delta !== null && reference ? delta / reference : null;
  const fmtDelta = delta === null ? null : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} ${unit}`;
  return (
    <div className="ds-benchmark">
      <div className="ds-benchmark-head">
        <span className="ds-benchmark-label">{label}</span>
        <span className="ds-benchmark-value">
          {value === null ? '—' : `${value.toFixed(0)} ${unit}`}
          {valueLabel && <span className="ds-benchmark-label"> · {valueLabel}</span>}
        </span>
      </div>
      <div
        className="ds-benchmark-track"
        role="img"
        aria-label={`${label}: ${value === null ? 'not measured' : `${value.toFixed(0)} ${unit}`}${reference !== null ? ` vs reference ${reference.toFixed(0)} ${unit}` : ''}${fmtDelta ? `, ${fmtDelta}` : ''}`}
      >
        {value !== null && (
          <span
            className="ds-benchmark-fill"
            style={{ width: `${percent(value, 0, scaleMax)}%` }}
          />
        )}
        {reference !== null && (
          <span
            className="ds-benchmark-target"
            style={{ left: `${percent(reference, 0, scaleMax)}%` }}
          />
        )}
      </div>
      <div className="ds-benchmark-sub">
        {reference !== null && delta !== null && (
          <>
            target {reference.toFixed(0)} {unit} ·{' '}
            <span className={delta >= 0 ? 'pos' : 'neg'}>
              {fmtDelta} ({pct === null ? '—' : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(0)}%`})
            </span>
          </>
        )}
        {reference === null && <span>no compatible reference set</span>}
      </div>
    </div>
  );
}
