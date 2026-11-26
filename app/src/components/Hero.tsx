/** Hero for the overview page. Pure presentation; takes already-computed figures. */
export function Hero({
  shots,
  sessions,
  dateRange,
  compact = false,
}: {
  shots: number;
  sessions: number;
  dateRange: string;
  /** Compact variant for the authenticated Overview: analytics appear early. */
  compact?: boolean;
}) {
  const paths = [
    ['#ff6fb5', 'M-40 70 C 380 70, 560 70, 700 150 S 980 210, 1640 210'],
    ['#ffb84a', 'M-40 120 C 330 120, 520 120, 660 250 S 1040 270, 1640 270'],
    ['#9a86ff', 'M-40 180 C 300 180, 490 180, 640 330 S 1080 330, 1640 330'],
    ['#4f9dff', 'M-40 250 C 360 250, 580 290, 740 250 S 1120 250, 1640 250'],
    ['#3fe0ae', 'M-40 320 C 340 320, 560 360, 730 300 S 1160 300, 1640 300'],
    ['#9bafff', 'M-40 390 C 380 390, 620 320, 800 350 S 1180 350, 1640 350'],
    ['#ff6fb5', 'M-40 460 C 420 460, 660 380, 870 210 S 1240 210, 1640 210'],
    ['#4f9dff', 'M-40 510 C 460 510, 700 300, 910 270 S 1280 270, 1640 270'],
    ['#ffb84a', 'M-40 550 C 500 550, 760 350, 960 330 S 1320 330, 1640 330'],
  ] as const;

  return (
    <>
      <div className={`hero reveal${compact ? ' compact' : ''}`} data-reveal>
        <div className="hero-dots" aria-hidden="true" />
        <svg
          className="hero-lanes"
          viewBox="0 0 1600 600"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <filter id="lane-glow" x="-20%" y="-40%" width="140%" height="180%">
              <feGaussianBlur stdDeviation="9" />
            </filter>
            <linearGradient id="lane-fade" x1="0" x2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".18" stopColor="#fff" stopOpacity="1" />
              <stop offset=".82" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="lane-mask">
              <rect width="1600" height="600" fill="url(#lane-fade)" />
            </mask>
          </defs>
          <g mask="url(#lane-mask)">
            <g filter="url(#lane-glow)" opacity=".5">
              {paths.map(([color, d], i) => (
                <path key={`glow-${i}`} d={d} fill="none" stroke={color} strokeWidth="7" />
              ))}
            </g>
            {paths.map(([color, d], i) => (
              <path key={i} d={d} fill="none" stroke={color} strokeWidth="2.6" />
            ))}
          </g>
        </svg>
        <div className="hero-copy">
          <span className="eyebrow night">Shotwise / Range log</span>
          <h2>Every shot, accounted for.</h2>
          {!compact && (
            <p className="hero-dek">
              Carry, speed and shape by club — and the shots that should never
              have been counted. Session by session, without changing what was
              recorded.
            </p>
          )}
          <p className="hero-meta mono">
            {dateRange} <span>·</span> {shots} recorded shots across {sessions}{' '}
            {sessions === 1 ? 'session' : 'sessions'}
          </p>
        </div>
      </div>
    </>
  );
}
