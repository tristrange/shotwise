import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Check,
  Flag,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { BASES, localToday, type Basis } from '../domain/model';
import { explorerPlot } from '../domain/explorer';
import { clubCardRows } from '../components/clubCardData';
import { ClubCard } from '../components/ClubCard';
import { PerformanceTrendCard } from '../components/PerformanceTrendCard';
import { ThemeToggle, useTheme } from '../components/ThemeToggle';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Disclosure,
  Divider,
  EmptyState,
  HelpPopover,
  IconButton,
  LoadingState,
  Metric,
  MetricGrid,
  RangeSlider,
  SectionHeader,
  SegmentedControl,
  Select,
  Slider,
} from '../components/ds';
import {
  BenchmarkBar,
  DistributionPlot,
  PerformanceScatterPlot,
  ScoreRing,
  Sparkline,
  DispersionPlot,
  type ScatterDatum,
  type ScatterTick,
} from '../components/charts';
import { syntheticDataset } from './fixtures';
import './showcase.css';

const SWATCH_TOKENS = [
  '--bg', '--surface', '--surface-2', '--border', '--text', '--text-2', '--text-3',
  '--brand', '--data', '--compare', '--pos', '--warn', '--neg', '--focus',
];

const TYPE_STEPS: { name: string; size: string }[] = [
  { name: '28 / xl', size: 'var(--text-xl)' },
  { name: '20 / lg', size: 'var(--text-lg)' },
  { name: '16 / md', size: 'var(--text-md)' },
  { name: '14 / sm', size: 'var(--text-sm)' },
  { name: '12 / xs', size: 'var(--text-xs)' },
];

const SPACES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Development-only visual approval surface. Rendered only when
 * `import.meta.env.DEV` and the hash is `#showcase` (see App.tsx); the whole
 * module — including this stylesheet — is dropped from production builds.
 * All data is the deterministic synthetic fixture; no auth, no real data.
 */
export default function Showcase() {
  const { theme, toggle } = useTheme();
  const data = useMemo(() => syntheticDataset(), []);
  const basis: Basis = 'premium-flat';
  const rows = useMemo(() => clubCardRows(data, basis, 'all'), [data]);
  const styles = getComputedStyle(document.documentElement);
  const tokenValue = (name: string) => styles.getPropertyValue(name).trim();

  // --- interactive control state ---
  const [mode, setMode] = useState<'all' | 'typical' | 'strong'>('typical');
  const [window_, setWindow] = useState<'recent' | 'all'>('recent');
  const [clubSel, setClubSel] = useState('7i');
  const [slider, setSlider] = useState(60);
  const [range, setRange] = useState<[number, number]>([40, 80]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // --- chart data from the shared domain functions ---
  const explorer = useMemo(
    () =>
      explorerPlot(data, {
        club: '7i',
        x: 'carry',
        y: 'apex',
        basis,
        scope: 'all',
        intent: 'all',
        contact: 'all',
        today: localToday(),
      }),
    [data],
  );
  const scatterPoints: ScatterDatum[] = useMemo(
    () =>
      explorer.points.map((p) => ({
        id: p.shot.id,
        x: p.x,
        y: p.y,
        label: `${explorer.club} shot row ${p.shot.rowIndex}`,
        title: `${explorer.xAxis.label} ${p.x.toFixed(1)}, ${explorer.yAxis.label} ${p.y.toFixed(1)}`,
      })),
    [explorer],
  );
  const [scatterSelected, setScatterSelected] = useState<string>('');
  const scatterDomains = useMemo(() => {
    const xs = scatterPoints.map((p) => p.x);
    const ys = scatterPoints.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const ticks = (min: number, max: number): ScatterTick[] =>
      [0, 0.5, 1].map((t) => {
        const v = min + (max - min) * t;
        return { value: v, text: v.toFixed(0) };
      });
    return {
      xDomain: [xMin - 2, xMax + 2] as [number, number],
      yDomain: [yMin - 1, yMax + 1] as [number, number],
      xTicks: ticks(xMin, xMax),
      yTicks: ticks(yMin, yMax),
    };
  }, [scatterPoints]);

  const dispersionPoints = useMemo(() => {
    const shots = data.shots.filter(
      (s) =>
        s.recordedClub === '7i' &&
        s.measurements.flatCarryPremium !== null &&
        s.measurements.fromCentre !== null,
    );
    return shots.slice(-40).map((s) => ({
      id: s.id,
      x: s.measurements.flatCarryPremium!,
      y: s.measurements.fromCentre!,
      label: `7i row ${s.rowIndex}: carry ${s.measurements.flatCarryPremium!.toFixed(0)} m, lateral ${s.measurements.fromCentre!.toFixed(1)} m`,
      title: `Carry ${s.measurements.flatCarryPremium!.toFixed(0)} m · lateral ${s.measurements.fromCentre!.toFixed(1)} m`,
    }));
  }, [data]);
  const [dispersionSelected, setDispersionSelected] = useState<string | null>(null);

  const sparkValues = useMemo(() => {
    const perSession = new Map<string, number[]>();
    for (const s of data.shots) {
      if (s.recordedClub !== 'D' || s.measurements.flatCarryPremium === null) continue;
      perSession.set(s.sessionId, [...(perSession.get(s.sessionId) ?? []), s.measurements.flatCarryPremium]);
    }
    const sessions = [...data.sessions].sort((a, b) => a.date.localeCompare(b.date));
    return sessions
      .map((s) => perSession.get(s.id))
      .map((vs) => (vs && vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null));
  }, [data]);

  const row7i = rows.find((r) => r.club === '7i');

  return (
    <div className="showcase">
      <header>
        <div>
          <h1>Design system showcase</h1>
          <p className="section-note">
            Dev-only · synthetic data · <code>#showcase</code> — never shipped in production builds
          </p>
        </div>
        <div className="showcase-row">
          <Badge tone="brand">fixtures: deterministic</Badge>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
      </header>

      <section aria-labelledby="sc-tokens">
        <h2 id="sc-tokens">Tokens</h2>
        <p className="section-note">Semantic colour tokens — live values from tokens.css in the active theme.</p>
        <div className="swatch-grid">
          {SWATCH_TOKENS.map((name) => (
            <div className="swatch" key={name}>
              <div className="swatch-chip" style={{ background: `var(${name})` }} />
              <div className="swatch-meta">
                <code>{name}</code>
                <span>{tokenValue(name)}</span>
              </div>
            </div>
          ))}
        </div>
        <Divider />
        <div className="showcase-grid">
          <Card>
            <SectionHeader title="Type scale" sub="Instrument Sans · tabular numerals on metrics" />
            <div className="type-sample">
              {TYPE_STEPS.map((t) => (
                <div className="type-row" key={t.name}>
                  <span className="type-name">{t.name}</span>
                  <span style={{ fontSize: t.size, fontWeight: 600, letterSpacing: '-0.01em' }}>
                    172.4 m carry
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <SectionHeader title="Spacing" sub="4px base scale" />
            <div className="showcase-stack" style={{ width: '100%' }}>
              {SPACES.map((n) => (
                <div className="showcase-row" key={n}>
                  <code style={{ width: 56, fontSize: 11, color: 'var(--text-3)' }}>space-{n}</code>
                  <div className="space-bar" style={{ width: `var(--space-${n})` }} />
                  <code style={{ fontSize: 11, color: 'var(--text-3)' }}>{n * 4}px</code>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section aria-labelledby="sc-controls">
        <h2 id="sc-controls">Controls</h2>
        <p className="section-note">Native elements styled by the ds — keyboard, focus and touch targets included.</p>
        <div className="showcase-grid">
          <Card>
            <SectionHeader title="Buttons" />
            <div className="showcase-row">
              <Button>Primary action</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button small>Small</Button>
              <Button disabled>Disabled</Button>
            </div>
            <Divider />
            <div className="showcase-row">
              <IconButton label="Search shots"><Search size={18} /></IconButton>
              <IconButton label="Notifications"><Bell size={18} /></IconButton>
              <IconButton label="Sliders"><SlidersHorizontal size={18} /></IconButton>
              <IconButton label="Open externally" small><ArrowUpRight size={16} /></IconButton>
            </div>
          </Card>
          <Card>
            <SectionHeader title="Badges" />
            <div className="showcase-row">
              <Badge>neutral</Badge>
              <Badge tone="brand">brand</Badge>
              <Badge tone="pos">pos</Badge>
              <Badge tone="warn">warn</Badge>
              <Badge tone="neg">neg</Badge>
              <Badge provisional>provisional 3/4</Badge>
              <Badge early>early</Badge>
            </div>
            <Divider />
            <div className="showcase-stack">
              <SegmentedControl
                label="Performance mode"
                options={[
                  { value: 'all', label: 'All', title: 'All shots, including mishits' },
                  { value: 'typical', label: 'Typical', title: 'Typical contact' },
                  { value: 'strong', label: 'Strong-strike', title: 'At or above P80' },
                ] as const}
                value={mode}
                onChange={setMode}
              />
              <SegmentedControl
                label="Analysis window"
                options={[
                  { value: 'recent', label: 'Recent' },
                  { value: 'all', label: 'All-time' },
                ] as const}
                value={window_}
                onChange={setWindow}
              />
            </div>
          </Card>
          <Card>
            <SectionHeader title="Select, sliders" />
            <div className="showcase-stack" style={{ width: '100%' }}>
              <Select
                label="Club"
                value={clubSel}
                onChange={setClubSel}
                options={rows.map((r) => ({ value: r.club, label: r.club }))}
              />
              <Slider
                label="Sample window (shots)"
                min={10}
                max={100}
                step={5}
                value={slider}
                onChange={setSlider}
                format={(v) => `${v} shots`}
              />
              <RangeSlider
                label="Carry filter"
                min={80}
                max={240}
                step={1}
                value={range}
                onChange={setRange}
                format={(v) => `${v} m`}
              />
            </div>
          </Card>
          <Card>
            <SectionHeader title="Disclosure & help" />
            <div className="showcase-stack" style={{ width: '100%' }}>
              <Disclosure summary="How is the overall rating calculated?">
                <p>
                  A designed performance index (ratings-2) over four 0–100 categories — distance
                  potential, consistency, directional control, reliability — with provisional
                  weights 20/25/30/25. It is not a validated skill or handicap measure.
                </p>
              </Disclosure>
              <div className="showcase-row">
                <span style={{ fontSize: 13 }}>Sample &amp; uncertainty</span>
                <HelpPopover label="Sample sizes and uncertainty behind a rating">
                  <p>96 shots · 8 visits · well supported.</p>
                  <p>Wilson 95% interval on the mishit share is sampling-only; missingness sensitivity is reported separately.</p>
                </HelpPopover>
              </div>
              <div className="showcase-row">
                <Button variant="secondary" small onClick={() => setDialogOpen(true)}>
                  Open dialog
                </Button>
                <Dialog
                  open={dialogOpen}
                  onClose={() => setDialogOpen(false)}
                  title="Example dialog"
                  actions={
                    <div className="ds-dialog-actions">
                      <Button variant="ghost" small onClick={() => setDialogOpen(false)}>Cancel</Button>
                      <Button small onClick={() => setDialogOpen(false)}><Check size={14} aria-hidden="true" /> Confirm</Button>
                    </div>
                  }
                >
                  <p>Native <code>&lt;dialog&gt;</code>: focus trap, Escape and backdrop click built in.</p>
                </Dialog>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section aria-labelledby="sc-clubs">
        <h2 id="sc-clubs">Club cards</h2>
        <p className="section-note">
          The whole header row expands the card; the arrow icon opens the full profile. Ratings are computed
          by the shared <code>ratings-2</code> domain module on the fixed premium-flat basis.
        </p>
        <div className="club-card-list">
          {rows.map((row, i) => (
            <ClubCard
              key={row.club}
              data={row}
              href={`#clubs/${encodeURIComponent(row.club)}`}
              basisLabel={BASES[basis].label}
              defaultOpen={i === 1}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="sc-charts">
        <h2 id="sc-charts">Charts &amp; analytics components</h2>
        <p className="section-note">
          Interactive compositions on the shared cohort functions. Missing measurements are gaps, never zero;
          no historical rating series is fabricated.
        </p>
        <div className="showcase-grid">
          <div style={{ gridColumn: '1 / -1' }}>
            <PerformanceTrendCard data={data} basis={basis} mode="all" />
          </div>
          <Card>
            <SectionHeader title="Score rings" sub="full · provisional · early · none" />
            <div className="showcase-row">
              <ScoreRing value={95} label="Driver: rating 95 of 100" />
              <ScoreRing value={72} provisional label="5 iron: provisional rating 72 of 100, 3 of 4 categories" />
              <ScoreRing value={88} early label="9 iron: early estimate 88 of 100" />
              <ScoreRing value={null} label="No rating yet" />
            </div>
          </Card>
          <Card>
            <SectionHeader title="Distribution & benchmark" sub="percentile band vs IQR · target marker" />
            <div className="showcase-stack" style={{ width: '100%' }}>
              {row7i && (
                <DistributionPlot
                  band={row7i.band}
                  min={120}
                  max={180}
                  label="7i carry distribution"
                />
              )}
              <DistributionPlot
                band={{ p10: null, q1: null, median: null, q3: null, p90: null }}
                min={100}
                max={150}
                label="limited sample distribution"
              />
              <BenchmarkBar label="7i typical carry vs goal" value={149} reference={160} />
              <BenchmarkBar label="PW vs range-ball reference" value={106} reference={null} />
            </div>
          </Card>
          <Card>
            <SectionHeader title="Sparklines" sub="driver mean carry per session" />
            <div className="showcase-row">
              <Sparkline values={sparkValues} label={`Driver mean carry over ${sparkValues.length} sessions`} />
              <Sparkline values={[...sparkValues.slice(0, 4), null, ...sparkValues.slice(5)]} />
            </div>
            <MetricGrid>
              <Metric label="Sessions" value={sparkValues.length} />
              <Metric
                label="Latest mean"
                value={sparkValues.at(-1)?.toFixed(1) ?? '—'}
                unit="m"
                delta={sparkValues.length > 1 ? `${((sparkValues.at(-1)! - sparkValues[0]!) >= 0 ? '+' : '−')}${Math.abs(sparkValues.at(-1)! - sparkValues[0]!).toFixed(1)} m` : undefined}
                deltaTone="pos"
              />
            </MetricGrid>
          </Card>
          <Card>
            <SectionHeader title="Dispersion (7i)" sub="carry vs lateral, corridor ±5% of carry" />
            <DispersionPlot
              points={dispersionPoints}
              corridorHalfWidth={0.05}
              selectedId={dispersionSelected}
              onSelect={setDispersionSelected}
            />
            <p className="shot-note">
              {dispersionSelected
                ? `Selected: ${dispersionPoints.find((p) => p.id === dispersionSelected)?.title ?? ''}`
                : 'Tap a point or use arrow keys to inspect a shot.'}
            </p>
          </Card>
          <Card>
            <SectionHeader title="Ball-flight scatter (7i)" sub="carry vs apex — explorer domain function" />
            <PerformanceScatterPlot
              label="7i carry versus apex"
              caption={`${explorer.basisLabel} · ${explorer.points.length} plotted, ${explorer.missingX + explorer.missingY} missing axis values`}
              xLabel={explorer.xAxis.label}
              yLabel={explorer.yAxis.label}
              xTicks={scatterDomains.xTicks}
              yTicks={scatterDomains.yTicks}
              xDomain={scatterDomains.xDomain}
              yDomain={scatterDomains.yDomain}
              points={scatterPoints}
              selectedId={scatterSelected || (scatterPoints[0]?.id ?? '')}
              onSelect={setScatterSelected}
            />
            <p className="shot-note">
              {scatterSelected
                ? `Selected: ${scatterPoints.find((p) => p.id === scatterSelected)?.title ?? ''}`
                : 'Tap a point or use arrow keys to inspect a shot.'}
            </p>
          </Card>
        </div>
      </section>

      <section aria-labelledby="sc-states">
        <h2 id="sc-states">States</h2>
        <div className="showcase-grid">
          <EmptyState title="No shots in this view">
            Import a session or widen the filters to see analytics here.
          </EmptyState>
          <LoadingState label="Loading your sessions…" />
          <Card>
            <SectionHeader title="Metric grid" />
            <MetricGrid>
              <Metric label="Shots in view" value="462" />
              <Metric label="Sessions" value="8" />
              <Metric label="Clubs" value={rows.length} />
              <Metric label="Median carry" value="149.2" unit="m" delta="+3.1 m vs first session" deltaTone="pos" />
            </MetricGrid>
          </Card>
        </div>
      </section>

      <footer style={{ marginTop: 48 }}>
        <p className="section-note">
          <Flag size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Shotwise dev showcase —
          synthetic fixtures only; this route is excluded from production builds at compile time.
        </p>
      </footer>
    </div>
  );
}
