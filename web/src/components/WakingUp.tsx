import { useEffect, useState, type ReactNode } from 'react';

const RETRY_MS = 3000;
/** Show the waking screen if the first health check has not answered by then. */
const SLOW_MS = 1500;
const ATTEMPT_TIMEOUT_MS = 10_000;

export function WakingUp() {
  return (
    <main className="waking" id="main">
      <div className="waking__box" role="status" aria-live="polite">
        <span className="k-wordmark t-wordmark-sm">Dispute Copilot</span>
        <p className="t-body-lg waking__text">Starting the demo server, this takes about 30 seconds.</p>
        <p className="t-body waking__sub">The demo runs on a free server that sleeps when idle. This page will open by itself.</p>
        <div className="k-skel waking__bar" aria-hidden="true" />
      </div>
    </main>
  );
}

async function healthy(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch('/health', { signal: ctrl.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * On first load only: hold the app until /health answers, showing WakingUp while it fails.
 * Later API errors are handled by the pages, not here.
 */
export function WakingUpGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'down' | 'up'>('checking');

  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const slow = setTimeout(() => live && setState((s) => (s === 'checking' ? 'down' : s)), SLOW_MS);

    const check = async () => {
      const ok = await healthy();
      if (!live) return;
      if (ok) {
        clearTimeout(slow);
        setState('up');
      } else {
        setState('down');
        retry = setTimeout(check, RETRY_MS);
      }
    };
    void check();

    return () => {
      live = false;
      clearTimeout(slow);
      clearTimeout(retry);
    };
  }, []);

  if (state === 'up') return <>{children}</>;
  if (state === 'down') return <WakingUp />;
  return null;
}
