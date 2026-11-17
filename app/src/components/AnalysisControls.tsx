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
