import type { ReactNode } from 'react';
import { clamp } from './hooks';

/**
 * One labelled rating bar: label, track, numeric score. A withheld category
 * (insufficient data) renders a dimmed track and an em dash — never zero.
 * Keeps the legacy rating-row classes so existing e2e selectors still match.
 */
export function ScoreBar({
  label,
  score,
  sub,
}: {
  label: string;
  score: number | null;
  sub?: ReactNode;
}) {
  return (
    <div className={`ds-score-bar rating-row${score === null ? ' withheld' : ''}`}>
      <span className="ds-score-bar-label rating-label">{label}</span>
      <span className="ds-score-bar-track rating-track" aria-hidden="true">
        {score !== null && (
          <span
            className="ds-score-bar-fill rating-fill"
            style={{ width: `${clamp(score, 0, 100)}%` }}
          />
        )}
      </span>
      <span className="ds-score-bar-score rating-score">
        {score === null ? '—' : String(Math.round(score))}
      </span>
      {sub && <span className="rating-sub">{sub}</span>}
    </div>
  );
}
