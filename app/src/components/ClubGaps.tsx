import { useState } from 'react';
import { clubGaps } from '../domain/analytics';
import { BASES, type Basis, type Dataset } from '../domain/model';

export function ClubGaps({ data }: { data: Dataset }) {
  const [basis, setBasis] = useState<Basis>('premium-flat');
  const rows = clubGaps(data, basis);
  const scale = Math.max(...rows.map((row) => row.high ?? row.median), 1) * 1.1;

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Your bag</span>
          <h1>Club gapping</h1>
          <p>
            See where your clubs leave a hole and where they overlap, so you
            know what to spend practice time on.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Carry by club</span>
            <h2>Typical carry and the gap to the next club</h2>
          </div>
          <label>
            Basis
            <select
              value={basis}
              onChange={(e) => setBasis(e.target.value as Basis)}
            >
              {Object.entries(BASES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          Full swings with typical contact only. The dot is the median carry;
          the bar is the middle 80% of shots. Fewer than ten shots is shown in
          grey and not flagged.
        </p>
        {rows.length === 0 ? (
          <p>No full swings with typical contact yet.</p>
        ) : (
          <div className="gap-list">
            <div className="gap-head">
              <span>Club</span>
              <span>Typical carry · spread</span>
              <span>Shots</span>
              <span>Gap</span>
            </div>
            {rows.map((row) => {
              const low = row.low ?? row.median;
              const high = row.high ?? row.median;
              return (
                <div
                  className={`gap-row${row.reliable ? '' : ' low'}`}
                  key={row.club}
                >
                  <span className="gap-club">{row.club}</span>
                  <div className="gap-track">
                    <span
                      className="gap-band"
                      style={{
                        left: `${(low / scale) * 100}%`,
                        width: `${((high - low) / scale) * 100}%`,
                      }}
                    />
                    <span
                      className="gap-dot"
                      style={{ left: `${(row.median / scale) * 100}%` }}
                    />
                  </div>
                  <span className="gap-n">{row.n}</span>
                  <span
                    className={`gap-value${row.flag === 'large' ? ' big' : ''}`}
                  >
                    {row.flag === 'overlap' ? (
                      <>overlap</>
                    ) : row.gap === null ? (
                      '—'
                    ) : (
                      `${row.gap.toFixed(0)} m`
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
