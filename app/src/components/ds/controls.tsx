import { useId } from 'react';
import { clamp, normalizeRange, percent } from './rangeMath';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
};

/** Single-choice control. Real buttons with aria-pressed inside a labelled group. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ds-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : ''}
          aria-pressed={value === option.value}
          title={option.title}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Labelled native text input (also number/date) with the ds field chrome. */
export function TextField({
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  type = 'text',
  min,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  type?: 'text' | 'number' | 'date' | 'time' | 'email' | 'password';
  min?: string;
  maxLength?: number;
  inputMode?: 'numeric' | 'text';
}) {
  const id = useId();
  return (
    <span className="ds-field ds-text">
      <label className="ds-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        min={min}
        maxLength={maxLength}
        inputMode={inputMode}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/** Labelled native select — the accessible default for few options. */
export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className="ds-field ds-select">
      <label className="ds-field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Single-thumb slider with immediate numerical feedback. The native range
 * input keeps keyboard and touch behaviour; the visible output mirrors the
 * value for sighted users and as aria-valuetext context.
 */
export function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  format = (v: number) => String(v),
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const id = useId();
  return (
    <span className="ds-field ds-slider">
      <label className="ds-field-label" htmlFor={id}>
        {label}
      </label>
      <span className="ds-slider-row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={format(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output className="ds-slider-output" htmlFor={id}>
          {format(value)}
        </output>
      </span>
    </span>
  );
}

/**
 * Two-thumb range slider over one custom track. Both thumbs are real range
 * inputs (keyboard accessible), stacked with pointer-events only on thumbs.
 */
export function RangeSlider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  format = (v: number) => String(v),
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  format?: (value: number) => string;
}) {
  const [lo, hi] = value;
  const move = (which: 0 | 1, raw: number) => {
    // Clamp the moving thumb against its neighbour instead of swapping: with
    // overlapping thumbs, ArrowRight on the minimum must move the minimum,
    // never the maximum.
    const clamped = which === 0 ? Math.min(raw, hi) : Math.max(raw, lo);
    const next = normalizeRange(
      which === 0 ? [clamped, hi] : [lo, clamped],
      min,
      max,
      step,
    );
    onChange(next);
  };
  return (
    <span className="ds-field ds-slider">
      <span className="ds-field-label" id={`${label}-label`}>
        {label}
      </span>
      <span
        className="ds-range"
        role="group"
        aria-labelledby={`${label}-label`}
      >
        <span className="ds-range-track" aria-hidden="true">
          <span
            className="ds-range-fill"
            style={{
              left: `${percent(lo, min, max)}%`,
              width: `${percent(hi, min, max) - percent(lo, min, max)}%`,
            }}
          />
        </span>
        <input
          type="range"
          aria-label={`${label} minimum`}
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-valuetext={format(lo)}
          onChange={(e) => move(0, Number(e.target.value))}
        />
        <input
          type="range"
          aria-label={`${label} maximum`}
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-valuetext={format(hi)}
          onChange={(e) => move(1, Number(e.target.value))}
        />
      </span>
      <span className="ds-range-outputs">
        <span>{format(lo)}</span>
        <span>{format(hi)}</span>
      </span>
    </span>
  );
}

export { clamp };
