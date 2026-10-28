import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, UnauthorizedError } from '../lib/api';
import type { DashboardFeed } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { EmptyState } from '../components/EmptyState';
import { AlertIcon, LayoutIcon } from '../components/Icons';

// AG Studio is about 5.8 MB, so it loads only here; the feed downloads at the same time.
const StudioReport = lazy(() => import('../studio/StudioReport'));

const REFRESH_MS = 60_000;
const CAPTION_TICK_MS = 15_000;

export function updatedText(at: number, now: number = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  return min < 1 ? 'Updated just now' : `Updated ${min} min ago`;
}

export function DashboardSkeleton() {
  return (
    <div className="dash-skel" data-testid="dashboard-skeleton" aria-busy="true" aria-label="Loading the dashboard">
      <div className="dash-skel__row">
        <div className="k-skel dash-skel__card dash-skel__card--wide" />
        <div className="k-skel dash-skel__card" />
      </div>
      <div className="dash-skel__row dash-skel__row--even">
        <div className="k-skel dash-skel__card" />
        <div className="k-skel dash-skel__card" />
      </div>
    </div>
  );
}

export function Dashboard() {
  usePageTitle('Dashboard');
  const navigate = useNavigate();
  const location = useLocation();

  const [feed, setFeed] = useState<DashboardFeed | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [firstError, setFirstError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');

  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setRefreshing(true);
    try {
      const data = await api<DashboardFeed>('/api/dashboard/data');
      if (!alive.current || mine !== seq.current) return;
      setFeed(data);
      setLoadedAt(Date.now());
      setNow(Date.now());
      setFirstError(false);
      setRefreshError(false);
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      if (err instanceof UnauthorizedError) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
        return;
      }
      setFirstError(true);
      setRefreshError(true);
    } finally {
      if (alive.current && mine === seq.current) setRefreshing(false);
    }
  }, [navigate, location.pathname, location.search]);

  const loadRef = useRef(load);
  loadRef.current = load;

  // First load.
  useEffect(() => {
    void loadRef.current();
  }, []);

  // Track tab visibility; catch up at once when the tab comes back.
  useEffect(() => {
    const onChange = () => {
      const v = document.visibilityState !== 'hidden';
      setVisible(v);
      if (v) void loadRef.current();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  // Refresh every 60 s while visible. Re-armed after each load so a manual refresh resets the rhythm.
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') void loadRef.current();
    }, REFRESH_MS);
    return () => window.clearTimeout(t);
  }, [visible, loadedAt, refreshError]);

  // Keep "Updated N min ago" current.
  useEffect(() => {
    if (!visible) return;
    const t = window.setInterval(() => setNow(Date.now()), CAPTION_TICK_MS);
    return () => window.clearInterval(t);
  }, [visible]);

  const header = (
    <header className="dash-head">
      <div className="dash-head__title">
        <span className="k-eyebrow">Seller disputes</span>
        <h1 className="t-h1">Dashboard</h1>
      </div>
      {feed ? (
        <div className="dash-head__meta">
          <span className="dash-updated" data-testid="updated" role="status">
            {refreshError && loadedAt ? `Could not refresh. ${updatedText(loadedAt, now)}` : loadedAt ? updatedText(loadedAt, now) : ''}
          </span>
          <button type="button" className="k-btn k-btn--sm" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      ) : null}
    </header>
  );

  let body;
  if (!feed && firstError) {
    body = (
      <EmptyState
        glyph={<AlertIcon size={24} />}
        title="We could not load the dashboard"
        actions={
          <button type="button" className="k-btn" onClick={() => void load()}>
            Try again
          </button>
        }
      >
        The server did not answer. It may be starting up.
      </EmptyState>
    );
  } else if (!feed) {
    body = <DashboardSkeleton />;
  } else if (feed.sources.disputes.length === 0) {
    body = (
      <EmptyState
        glyph={<LayoutIcon size={24} />}
        title="No disputes yet"
        actions={
          <Link to="/guide" className="k-btn">
            Open the judge guide
          </Link>
        }
      >
        When a buyer opens a PayPal dispute, it shows here with the AI recommendation and its deadline. The guide
        explains how to open one in the sandbox.
      </EmptyState>
    );
  } else {
    body = (
      <Suspense fallback={<DashboardSkeleton />}>
        <StudioReport feed={feed} />
      </Suspense>
    );
  }

  return (
    <div className="page page--dash">
      {header}
      {body}
    </div>
  );
}
