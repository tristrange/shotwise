import { GAP_THRESHOLDS } from '../domain/analytics';
import { type GappingRow, gapPairs } from './gappingData';
import { Badge, Card, HelpPopover, SectionHeader } from './ds';

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function flagText(flag: GappingRow['flag']) {
  return flag === 'small'
    ? 'small median gap'
    : flag === 'reversed'
      ? 'medians reversed'
      : flag === 'large'
        ? 'large gap'
        : null;
}

function flagTone(flag: GappingRow['flag']): 'warn' | 'neg' | 'brand' | null {
  return flag === 'small'
    ? 'warn'
    : flag === 'reversed'
      ? 'neg'
      : flag === 'large'
        ? 'brand'
        : null;
}

/**
 * Concise adjacent-club gap comparison: one row per neighbouring pair, a bar
 * scaled to the largest gap in the bag and the approved domain flags (small /
 * large / reversed). No new thresholds are introduced here — the flags come
 * straight from `clubGaps` — and overlap is shown as information only.
 */
export function AdjacentGaps({ rows }: { rows: readonly GappingRow[] }) {
  const pairs = gapPairs(rows);
  const maxAbs = Math.max(...pairs.map((p) => Math.abs(p.gap)), 1);
  return (
    <Card className="adjacent-gaps">
      <SectionHeader
        title="Adjacent club gaps"
        sub="Median carry difference to the next longer club"
        aside={
          <HelpPopover label="How gaps and flags are calculated">
            <p>
              The gap is the median carry of the club above minus this club's
              median, using the selected cohort on the selected measurement
              basis. Medians come from comparable visits on multiple dates, so
              a single session cannot flag a gap on its own.
            </p>
            <p>
              Flags appear only when both clubs have at least{' '}
              {GAP_THRESHOLDS.minSamples} measured band shots: a negative gap
              means the medians are reversed, up to {GAP_THRESHOLDS.smallM} m
              is a small median gap, and above {GAP_THRESHOLDS.largeM} m a
              large gap. Sample-limited pairs show the gap without a flag.
            </p>
            <p>
              Overlap is information, not a verdict: Shotwise never recommends
              removing equipment based solely on distance overlap.
            </p>
          </HelpPopover>
        }
      />
      {pairs.length === 0 ? (
        <p className="context">
          Add a second club with comparable shots to see adjacent gaps.
        </p>
      ) : (
        <ul className="gap-pair-list" aria-label="Adjacent club gaps">
          {pairs.map((pair) => {
            const text = flagText(pair.flag);
            return (
              <li key={`${pair.upper}->${pair.lower}`}>
                <span className="gap-pair-clubs">
                  {pair.upper} → {pair.lower}
                </span>
                <span className="gap-pair-track" aria-hidden="true">
                  <span
                    className={`gap-pair-fill${pair.flag ? ` ${pair.flag}` : ''}`}
                    style={{
                      width: `${Math.max(6, (Math.abs(pair.gap) / maxAbs) * 100)}%`,
                    }}
                  />
                </span>
                <span className="gap-pair-value">
                  {pair.gap >= 0 ? '+' : '−'}
                  {decimal.format(Math.abs(pair.gap))} m
                </span>
                {text && (
                  <Badge tone={flagTone(pair.flag) ?? 'neutral'}>{text}</Badge>
                )}
                {!pair.bothReliable && (
                  <span className="pill">Sample limited</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
