import type { ReactNode } from 'react';
import { clamp } from './hooks';
import { scoreBand } from './scoreBand';

/**
 * One labelled rating bar: label, track, numeric score. The fill AND the
 * numeric score take the shared score-band colour (data-band → --rating-*
 * tokens in ds.css). A withheld category (insufficient data) renders a dimmed
 * track and a grey em dash — never zero; a genuine 0 shows a red "0".
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
    <div
      className={`ds-score-bar rating-row${score === null ? ' withheld' : ''}`}
      data-band={scoreBand(score)}
    >
      <span className="ds-score-bar-label rating-label">{label}</span>
      <span className="ds-score-bar-score rating-score">
        {score === null ? '—' : String(Math.round(score))}
      </span>
      <span className="ds-score-bar-track rating-track" aria-hidden="true">
        {score !== null && (
          <span
            className="ds-score-bar-fill rating-fill"
            style={{ width: `${clamp(score, 0, 100)}%` }}
          />
        )}
      </span>
      {sub && <span className="rating-sub">{sub}</span>}
    </div>
  );
}
