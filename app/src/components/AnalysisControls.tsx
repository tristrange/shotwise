import { BASES, type Basis } from '../domain/model';
import type { AnalysisSettings } from '../domain/analytics';

export function MishitToggle({
  settings,
  onChange,
}: {
  settings: AnalysisSettings;
  onChange: (settings: AnalysisSettings) => void;
}) {
  return (
    <button
      className="pill pill-button"
      aria-label="Hide likely mishits"
      aria-pressed={settings.hideLikelyMishits ?? false}
      title="Filter reviewed mishits and unusually short, slow shots. Unassessed shots stay included. Saved shots and reviews do not change."
      onClick={() =>
        onChange({
          ...settings,
          hideLikelyMishits: !settings.hideLikelyMishits,
        })
      }
    >
      Likely mishits: {settings.hideLikelyMishits ? 'hidden' : 'included'}
    </button>
  );
}

const bases = Object.keys(BASES) as Basis[];

export function BasisButton({
  basis,
  onChange,
}: {
  basis: Basis;
  onChange: (basis: Basis) => void;
}) {
  return (
    <button
      className="pill pill-button"
      onClick={() =>
        onChange(bases[(bases.indexOf(basis) + 1) % bases.length]!)
      }
      title="Change measurement basis"
    >
      {BASES[basis].label}
    </button>
  );
}

const PERFORMANCE_OPTIONS: {
  value: AnalysisSettings['contact'];
  label: string;
  title: string;
}[] = [
  {
    value: 'all',
    label: 'All',
    title: 'All shots, including mishits — real-world reliability',
  },
  {
    value: 'typical',
    label: 'Typical',
    title: 'Shots with typical contact, full or partial — expected carry and gapping',
  },
  {
    value: 'strong',
    label: 'Strong-strike',
    title: 'Only strong strikes (at or above each club’s P80 carry) — distance potential',
  },
];

/** Performance mode: All / Typical / Strong-strike (roadmap §6.1). */
export function PerformanceToggle({
  settings,
  onChange,
}: {
  settings: AnalysisSettings;
  onChange: (settings: AnalysisSettings) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Performance mode">
      {PERFORMANCE_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={settings.contact === option.value ? 'active' : ''}
          aria-pressed={settings.contact === option.value}
          title={option.title}
          onClick={() =>
            onChange({
              ...settings,
              contact: option.value,
              // Strong-strike view is about strike strength only; the mishit
              // filter is normalized off so auto-flagged unusual shots are not
              // silently dropped from it (mirrors selectCohort).
              ...(option.value === 'strong' ? { hideLikelyMishits: false } : {}),
            })
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: 'recent' | 'all';
  onChange: (mode: 'recent' | 'all') => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Analysis window">
      <button
        className={mode === 'recent' ? 'active' : ''}
        aria-pressed={mode === 'recent'}
        title="Latest 50 shots per club from the last 60 days"
        onClick={() => onChange('recent')}
      >
        Recent
      </button>
      <button
        className={mode === 'all' ? 'active' : ''}
        aria-pressed={mode === 'all'}
        title="Every non-archived session"
        onClick={() => onChange('all')}
      >
        All-time
      </button>
    </div>
  );
}
