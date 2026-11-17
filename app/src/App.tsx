import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  Flag,
  FolderOpen,
  LogOut,
  Ruler,
  ScatterChart,
  Settings,
} from 'lucide-react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { backend } from './data/repository';
import { emptyDataset, type Dataset } from './domain/model';
import { parseBackup, serializeBackup } from './domain/backup';
import { Analysis } from './components/Analysis';
import { Sessions } from './components/Sessions';
import { ShotReview } from './components/ShotReview';
import { ThemeToggle, useTheme } from './components/ThemeToggle';
import { ClubSuggestions } from './components/ClubSuggestions';
import { ClubGaps } from './components/ClubGaps';
import { ShotShapes } from './components/ShotShapes';
import type { AnalysisSettings } from './domain/analytics';

const initialAnalysisSettings: AnalysisSettings = {
  mode: 'recent',
  basis: 'premium-flat',
  intent: 'all',
  contact: 'all',
};

type Page =
  'overview' | 'sessions' | 'review' | 'gapping' | 'progress' | 'shape' | 'settings';
const nav: { id: Page; label: string; icon: typeof Flag }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'sessions', label: 'Sessions & import', icon: FolderOpen },
  { id: 'review', label: 'Review', icon: ClipboardCheck },
  { id: 'gapping', label: 'Gapping', icon: Ruler },
  { id: 'progress', label: 'Progress', icon: Flag },
  { id: 'shape', label: 'Shot shape', icon: ScatterChart },
  { id: 'settings', label: 'Settings', icon: Settings },
];
function pageFromHash(): Page {
  const hash = window.location.hash.slice(1);
  return nav.some((item) => item.id === hash) ? (hash as Page) : 'overview';
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [analysisSettings, setAnalysisSettings] = useState(
    initialAnalysisSettings,
  );
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [data, setData] = useState<Dataset>(emptyDataset);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>(pageFromHash);
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
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (window.location.hash.slice(1) !== page) window.location.hash = page;
  }, [page]);
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
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              {label}
            </button>
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
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              <span>{id === 'sessions' ? 'Sessions' : label}</span>
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
            {page === 'shape' && (
              <ShotShapes
                data={data}
                settings={analysisSettings}
                onSettingsChange={setAnalysisSettings}
              />
            )}
            {page === 'sessions' && (
              <Sessions data={data} repository={repository} refresh={refresh} />
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
              <section className="panel">
                <ShotReview
                  data={data}
                  repository={repository}
                  refresh={refresh}
                />
              </section>
            )}
            {page === 'settings' && <Backup data={data} refresh={refresh} />}
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
    data.events.length === 0;
  return (
    <>
      <div className="section-heading">
        <h1>Settings</h1>
      </div>
      <section className="panel">
        <h2>Backups</h2>
        <p>
          Download a private JSON backup containing your original imports,
          sessions and reviews. Keep this file somewhere safe; it contains your
          personal data.
        </p>
        <button onClick={download}>Download backup</button>
        <hr />
        <h3>Restore a backup</h3>
        <p>
          Restore is available only when your dataset is empty. It will not
          overwrite existing sessions.
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
          Your data syncs through your configured project. Free-tier projects
          may pause when inactive; keep a backup.
        </p>
      </section>
    </>
  );
}
