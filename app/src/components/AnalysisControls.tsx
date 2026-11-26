import { BASES, type Basis } from '../domain/model';
import type { AnalysisSettings } from '../domain/analytics';
import { Button, SegmentedControl, type SegmentedOption } from './ds';

/**
 * Shared analysis controls, rebuilt on the ds primitives. Accessible names
 * and titles are unchanged ('All' / 'Typical' / 'Strong-strike', 'Recent' /
 * 'All-time', 'Hide likely mishits', 'Change measurement basis') so existing
 * e2e flows keep working.
 */

export function MishitToggle({
  settings,
  onChange,
}: {
  settings: AnalysisSettings;
  onChange: (settings: AnalysisSettings) => void;
}) {
  return (
    <button
      type="button"
      className="ds-toggle"
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
    <Button
      variant="secondary"
      small
      onClick={() =>
        onChange(bases[(bases.indexOf(basis) + 1) % bases.length]!)
      }
      title="Change measurement basis"
    >
      {BASES[basis].label}
    </Button>
  );
}

const PERFORMANCE_OPTIONS: readonly SegmentedOption<AnalysisSettings['contact']>[] = [
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
    <SegmentedControl
      label="Performance mode"
      options={PERFORMANCE_OPTIONS}
      value={settings.contact}
      onChange={(contact) =>
        onChange({
          ...settings,
          contact,
          // Strong-strike view is about strike strength only; the mishit
          // filter is normalized off so auto-flagged unusual shots are not
          // silently dropped from it (mirrors selectCohort).
          ...(contact === 'strong' ? { hideLikelyMishits: false } : {}),
        })
      }
    />
  );
}

const WINDOW_OPTIONS: readonly SegmentedOption<'recent' | 'all'>[] = [
  {
    value: 'recent',
    label: 'Recent',
    title: 'Latest 50 shots per club from the last 60 days',
  },
  { value: 'all', label: 'All-time', title: 'Every non-archived session' },
];

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: 'recent' | 'all';
  onChange: (mode: 'recent' | 'all') => void;
}) {
  return (
    <SegmentedControl
      label="Analysis window"
      options={WINDOW_OPTIONS}
      value={mode}
      onChange={onChange}
    />
  );
}
