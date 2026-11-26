import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  BarChart3,
  ClipboardCheck,
  Club,
  Flag,
  FolderOpen,
  Home,
  LogOut,
  MoreHorizontal,
  Radar,
  Ruler,
  ScatterChart,
  Settings,
  TrendingUp,
} from 'lucide-react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { backend } from './data/repository';
import { emptyDataset, idSchema, type Dataset } from './domain/model';
import { parseBackup, serializeBackup } from './domain/backup';
import { Analysis } from './components/Analysis';
import { Sessions } from './components/Sessions';
import { ShotReview } from './components/ShotReview';
import { ThemeToggle, useTheme } from './components/ThemeToggle';
import { Button, Card, Divider, SectionHeader } from './components/ds';
import { ClubSuggestions } from './components/ClubSuggestions';
import { ClubGaps } from './components/ClubGaps';
import { ClubProfiles } from './components/ClubProfiles';
import { ManageBag } from './components/ManageBag';
import { ShotShapes } from './components/ShotShapes';
import { BallFlightExplorer } from './components/BallFlightExplorer';
import type { AnalysisSettings } from './domain/analytics';
import { useScrollReveal } from './reveal';

/**
 * Dev-only component showcase. The `import.meta.env.DEV` ternary is replaced
 * with `false` at build time, so production builds drop the lazy import and
 * never emit the showcase chunk (guarded by src/showcase/fixtures.test.ts).
 */
const Showcase = import.meta.env.DEV
  ? lazy(() => import('./showcase/Showcase'))
  : null;

const initialAnalysisSettings: AnalysisSettings = {
  mode: 'recent',
  basis: 'premium-flat',
  intent: 'all',
  contact: 'all',
  hideLikelyMishits: false,
};

type Page =
  | 'overview'
  | 'sessions'
  | 'review'
  | 'gapping'
  | 'progress'
  | 'clubs'
  | 'shape'
  | 'settings';
type ShapeView = 'shape' | 'explorer';
type NavItem = {
  label: string;
  /** Compact label for the mobile sub-nav. */
  shortLabel?: string;
  hash: string;
  page: Page;
  icon: typeof Flag;
  /** Secondary-nav key; distinguishes the two shot-shape views. */
  key: string;
};
/** Screens reachable from the Clubs tab (secondary navigation). */
const clubScreens: NavItem[] = [
  { label: 'Club profiles', hash: 'clubs', page: 'clubs', icon: Club, key: 'clubs' },
  { label: 'Gapping', hash: 'gapping', page: 'gapping', icon: Ruler, key: 'gapping' },
  { label: 'Shot shape', hash: 'shape', page: 'shape', icon: ScatterChart, key: 'shape:shape' },
  { label: 'Ball-flight explorer', shortLabel: 'Explorer', hash: 'shape/explorer', page: 'shape', icon: Radar, key: 'shape:explorer' },
];
/** Screens reachable from the More tab (secondary navigation). */
const moreScreens: NavItem[] = [
  { label: 'Settings', hash: 'settings', page: 'settings', icon: Settings, key: 'settings' },
  { label: 'Shot review', hash: 'review', page: 'review', icon: ClipboardCheck, key: 'review' },
];
/** Desktop sidebar: the same logical grouping as the five mobile tabs. */
const sidebarGroups: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { label: 'Overview', hash: 'overview', page: 'overview', icon: BarChart3, key: 'overview' },
    ],
  },
  { label: 'Clubs', items: clubScreens },
  {
    label: null,
    items: [
      { label: 'Progress', hash: 'progress', page: 'progress', icon: TrendingUp, key: 'progress' },
      { label: 'Sessions & import', hash: 'sessions', page: 'sessions', icon: FolderOpen, key: 'sessions' },
    ],
  },
  { label: 'More', items: moreScreens },
];
type Tab = 'home' | 'clubs' | 'progress' | 'sessions' | 'more';
/** Five primary mobile tabs; each opens its primary content directly. */
const tabs: { id: Tab; label: string; icon: typeof Flag; page: Page }[] = [
  { id: 'home', label: 'Home', icon: Home, page: 'overview' },
  { id: 'clubs', label: 'Clubs', icon: Club, page: 'clubs' },
  { id: 'progress', label: 'Progress', icon: TrendingUp, page: 'progress' },
  { id: 'sessions', label: 'Sessions', icon: FolderOpen, page: 'sessions' },
  { id: 'more', label: 'More', icon: MoreHorizontal, page: 'settings' },
];
function secondaryKey(page: Page, shapeView: ShapeView | undefined) {
  return page === 'shape' ? `shape:${shapeView ?? 'shape'}` : page;
}
function tabForPage(page: Page): Tab {
  switch (page) {
    case 'overview':
      return 'home';
    case 'clubs':
    case 'gapping':
    case 'shape':
      return 'clubs';
    case 'progress':
      return 'progress';
    case 'sessions':
      return 'sessions';
    case 'review':
    case 'settings':
      return 'more';
  }
}
function decodeSegment(segment: string | undefined) {
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
const pages: Page[] = [
  'overview',
  'sessions',
  'review',
  'gapping',
  'progress',
  'clubs',
  'shape',
  'settings',
];
function routeFromHash() {
  const [path, query] = window.location.hash.slice(1).split('?');
  const [name, id, extra] = (path ?? '').split('/');
  const page = pages.find((item) => item === name) ?? 'overview';
  const sessionsPath = page === 'sessions' && !extra;
  return {
    page,
    sessionId:
      sessionsPath && id !== 'compare'
        ? idSchema.safeParse(id).data
        : undefined,
    compare: sessionsPath === true && id === 'compare',
    club: page === 'clubs' && !extra ? decodeSegment(id) : undefined,
    shapeView:
      page === 'shape'
        ? id === 'explorer'
          ? ('explorer' as const)
          : ('shape' as const)
        : undefined,
    evidence: query ?? '',
  };
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const manageBagHeading = useRef<HTMLHeadingElement>(null);
  const pendingBagFocus = useRef(false);
  const [analysisSettings, setAnalysisSettings] = useState(
    initialAnalysisSettings,
  );
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [data, setData] = useState<Dataset>(emptyDataset);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [{ page, sessionId, compare, club, shapeView, evidence }, setRoute] =
    useState(routeFromHash);
  useScrollReveal(`${page}:${data.sessions.length}:${data.shots.length}`);
  const identity = useRef<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (backend.kind !== 'configured' || !identity.current) return;
    const user = identity.current;
    const request = ++generation.current;
    try {
      const result = await backend.repository.load();
      if (identity.current === user && generation.current === request) {
        setData(result);
        setError('');
        setLoading(false);
      }
    } catch (e) {
      if (identity.current === user && generation.current === request) {
        setError(
          e instanceof Error
            ? e.message
            : 'Could not load your data. Check your connection and try again.',
        );
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    if (backend.kind !== 'configured') return;
    let alive = true;
    const client = backend.client;
    const applySession = (next: AuthSession | null) => {
      if (!alive) return;
      const user = next?.user.id ?? null;
      if (identity.current !== user) {
        identity.current = user;
        generation.current++;
        setData(emptyDataset);
        setAnalysisSettings(initialAnalysisSettings);
        setSession(next);
        if (user) void Promise.resolve().then(refresh);
      }
      setAuthLoading(false);
    };
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, next) => {
        applySession(next);
      },
    );
    return () => {
      alive = false;
      identity.current = null;
      subscription.subscription.unsubscribe();
    };
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [session, refresh]);
  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (page === 'settings' && pendingBagFocus.current) {
      pendingBagFocus.current = false;
      manageBagHeading.current?.focus();
      manageBagHeading.current?.scrollIntoView({ block: 'start' });
    }
  }, [page]);
  if (import.meta.env.DEV && window.location.hash.startsWith('#showcase'))
    return (
      <Suspense
        fallback={
          <div className="auth-shell">
            <p role="status">Loading showcase…</p>
          </div>
        }
      >
        {Showcase ? <Showcase /> : null}
      </Suspense>
    );
  if (backend.kind === 'unconfigured')
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <Brand />
          <span className="eyebrow">Setup required</span>
          <h1>Connect Supabase to start logging sessions.</h1>
          <p>
            Shotwise needs a private Supabase project before you can sign in.
          </p>
          <p>
            Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your environment,
            apply the project migrations, and provision your personal account.
            Restart the app after configuring it.
          </p>
        </div>
      </div>
    );
  if (authLoading)
    return (
      <div className="auth-shell">
        <p role="status">Loading Shotwise…</p>
      </div>
    );
  if (!session) return <Login client={backend.client} error={error} />;
  const repository = backend.repository;
  const client = backend.client;
  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Main navigation">
          {sidebarGroups.map((group) => (
            <Fragment key={group.label ?? 'primary'}>
              {group.label && (
                <span className="nav-group-label">{group.label}</span>
              )}
              {group.items.map(({ label, hash, icon: Icon, key }) => {
                const active = secondaryKey(page, shapeView) === key;
                return (
                  <button
                    key={hash}
                    className={active ? 'active' : ''}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      window.location.hash = hash;
                    }}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </nav>
        <div className="side-footer">
          <span>Range sessions</span>
          <p>Import, review, compare.</p>
          <div className="side-footer-actions">
            <button
              className="signout"
              onClick={() => void client.auth.signOut()}
            >
              <LogOut size={18} /> Sign out
            </button>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </aside>
      <main>
        <header className="mobile-header">
          <Brand />
          <div className="mobile-header-actions">
            <button
              className="text-button"
              onClick={() => void client.auth.signOut()}
            >
              Sign out
            </button>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </header>
        {(() => {
          const tab = tabForPage(page);
          const items = tab === 'clubs' ? clubScreens : tab === 'more' ? moreScreens : null;
          if (!items) return null;
          return (
            <nav
              className="sub-nav"
              aria-label={tab === 'clubs' ? 'Clubs sections' : 'More sections'}
            >
              {items.map(({ label, shortLabel, hash, icon: Icon, key }) => (
                <button
                  key={hash}
                  aria-current={
                    secondaryKey(page, shapeView) === key ? 'page' : undefined
                  }
                  onClick={() => {
                    window.location.hash = hash;
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {shortLabel ?? label}
                </button>
              ))}
            </nav>
          );
        })()}
        <nav className="bottom-nav" aria-label="Primary navigation">
          {tabs.map(({ id, label, icon: Icon, page: target }) => (
            <button
              key={id}
              aria-current={tabForPage(page) === id ? 'page' : undefined}
              onClick={() => {
                // Re-tapping Clubs keeps the current club screen (and any
                // deep link such as #clubs/7i or #shape/explorer) instead of
                // resetting to club profiles.
                if (id === 'clubs' && tabForPage(page) === 'clubs') return;
                window.location.hash = target;
              }}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="main-content">
          {loading && (
            <div className="loading" role="status">
              Refreshing your data…
            </div>
          )}
          {error && (
            <div className="panel">
              <h1>Couldn’t load your data</h1>
              <p role="alert">{error}</p>
              <button onClick={() => void refresh()}>Try again</button>
            </div>
          )}
          {loading && !error && (
            <div className="panel">Loading your sessions…</div>
          )}
          <div key={session.user.id} hidden={!!error || loading}>
            {page === 'overview' && (
              <Analysis
                data={data}
                settings={analysisSettings}
                onSettingsChange={setAnalysisSettings}
              />
            )}
            {page === 'gapping' && (
              <ClubGaps
                data={data}
                settings={analysisSettings}
                onSettingsChange={setAnalysisSettings}
              />
            )}
            {page === 'progress' && (
              <Analysis
                key="progress"
                data={data}
                settings={analysisSettings}
                onSettingsChange={setAnalysisSettings}
                progressView
              />
            )}
            {page === 'clubs' && (
              <ClubProfiles
                data={data}
                settings={analysisSettings}
                onSettingsChange={setAnalysisSettings}
                focusClub={club}
                repository={repository}
                refresh={refresh}
                onManageBag={() => {
                  pendingBagFocus.current = true;
                  window.location.hash = 'settings';
                }}
              />
            )}
            {page === 'shape' &&
              (shapeView === 'explorer' ? (
                <BallFlightExplorer
                  data={data}
                  settings={analysisSettings}
                  onSettingsChange={setAnalysisSettings}
                />
              ) : (
                <ShotShapes
                  data={data}
                  settings={analysisSettings}
                  onSettingsChange={setAnalysisSettings}
                />
              ))}
            {page === 'sessions' && (
              <Sessions
                data={data}
                repository={repository}
                refresh={refresh}
                sessionId={sessionId}
                compare={compare}
                evidenceQuery={evidence}
                basis={analysisSettings.basis}
                onBasisChange={(basis) =>
                  setAnalysisSettings((current) => ({ ...current, basis }))
                }
              />
            )}
            {page === 'review' && (
              <div className="section-heading">
                <h1>Review</h1>
              </div>
            )}
            <ClubSuggestions
              active={page === 'review'}
              data={data}
              repository={repository}
              refresh={refresh}
            />
            {page === 'review' && (
              <ShotReview
                data={data}
                repository={repository}
                refresh={refresh}
              />
            )}
            {page === 'settings' && (
              <>
                <div className="section-heading">
                  <h1>Settings</h1>
                </div>
                <div className="settings-stack">
                  <ManageBag
                    data={data}
                    repository={repository}
                    refresh={refresh}
                    headingRef={manageBagHeading}
                  />
                  <Backup data={data} refresh={refresh} />
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Flag size={18} />
      </span>
      <span>
        shotwise<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Login({
  client,
  error: initialError,
}: {
  client: Extract<typeof backend, { kind: 'configured' }>['client'];
  error: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Brand />
        <span className="eyebrow">Your practice, clearer</span>
        <h1>Carry, speed and apex, session by session.</h1>
        <p>Sign in to your private practice log.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            void client.auth
              .signInWithPassword({ email, password })
              .then(({ error }) => {
                if (error) setError(error.message);
                setBusy(false);
              });
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
        <details>
          <summary>Forgot your password?</summary>
          <p>
            This is a personally provisioned account. Reset the password through
            your Supabase project dashboard or ask the project administrator.
          </p>
        </details>
      </div>
    </div>
  );
}
function Backup({
  data,
  refresh,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  if (backend.kind !== 'configured') return null;
  const repository = backend.repository;
  function download() {
    const url = URL.createObjectURL(
      new Blob([serializeBackup(data)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `shotwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restore(file: File) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const parsed = await parseBackup(await file.text());
      await repository.restore(parsed);
      await refresh();
      setStatus('Backup restored.');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not restore this backup.',
      );
    }
    setBusy(false);
  }
  const empty =
    data.sessions.length === 0 &&
    data.shots.length === 0 &&
    data.imports.length === 0 &&
    data.events.length === 0 &&
    data.equipment.length === 0 &&
    data.equipmentAssignments.length === 0 &&
    data.userReferenceValues.length === 0;
  return (
    <Card className="backup-card">
      <SectionHeader
        title="Backups"
        sub="Download a private JSON backup containing your original imports, sessions, reviews, and equipment. Keep this file somewhere safe; it contains your personal data."
      />
      <div className="actions">
        <Button onClick={download}>Download backup</Button>
      </div>
      <p className="muted">
        Refresh any other open Shotwise tabs before downloading so the backup
        includes the latest equipment and assignments.
      </p>
      <Divider />
      <h3>Restore a backup</h3>
      <p>
        Restore is available only when your dataset is empty. It will not
        overwrite existing data.
      </p>
      <label className="file-button">
        Choose backup
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy || !empty}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void restore(file);
            e.target.value = '';
          }}
        />
      </label>
      {!empty && (
        <p className="notice">
          Your dataset is not empty, so restore is unavailable.
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        Your data syncs through your configured project. Free-tier projects may
        pause when inactive; keep a backup.
      </p>
    </Card>
  );
}
