import type { ReactNode } from 'react';
import type { AnalysisSettings } from '../domain/analytics';
import { BASES, basisSchema, reviewSchema } from '../domain/model';

export function AnalysisControls({
  settings,
  onChange,
  children,
}: {
  settings: AnalysisSettings;
  onChange: (settings: AnalysisSettings) => void;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="filters panel" role="group" aria-label="Analysis filters">
        <label>
          View
          <select
            value={settings.mode}
            onChange={(event) => {
              const mode = event.target.value;
              if (mode === 'recent' || mode === 'all')
                onChange({ ...settings, mode });
            }}
          >
            <option value="recent">Recent</option>
            <option value="all">All-time</option>
          </select>
        </label>
        <label>
          Measurement basis
          <select
            value={settings.basis}
            onChange={(event) =>
              onChange({
                ...settings,
                basis: basisSchema.parse(event.target.value),
              })
            }
          >
            {Object.entries(BASES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Intent
          <select
            value={settings.intent}
            onChange={(event) =>
              onChange({
                ...settings,
                intent:
                  event.target.value === 'all'
                    ? 'all'
                    : reviewSchema.shape.intent.parse(event.target.value),
              })
            }
          >
            <option value="all">All intent</option>
            <option value="full">Full</option>
            <option value="partial">Partial</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          Contact
          <select
            value={settings.contact}
            onChange={(event) =>
              onChange({
                ...settings,
                contact: event.target.value === 'typical' ? 'typical' : 'all',
              })
            }
          >
            <option value="all">All contact</option>
            <option value="typical">Reviewed typical</option>
          </select>
        </label>
        {children}
      </div>
      <p className="notice">
        {settings.mode === 'recent'
          ? 'Recent targets the latest 50 shots per club in the last 60 days, keeping the full cutoff date. Review filters apply afterward; older shots never fill a sparse sample.'
          : 'All-time includes all non-archived sessions, using the selected review filters.'}
      </p>
    </>
  );
}
