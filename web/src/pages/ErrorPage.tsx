import { useEffect } from 'react';

/**
 * Shown by ErrorBoundary. Uses plain links and no router or context,
 * so it still works when the failure is in the app shell itself.
 */
export function ErrorPage({ reference, landmark = false }: { reference: string; landmark?: boolean }) {
  const Root = landmark ? 'main' : 'div';
  useEffect(() => {
    document.title = 'Something went wrong · Dispute Copilot';
  }, []);
  return (
    <Root className="page page--narrow status-page" id={landmark ? 'main' : undefined}>
      <h1 className="t-h1">Something went wrong</h1>
      <p className="t-body-lg muted">
        This page ran into a problem. Try again. If it keeps happening, send the team the reference code below.
      </p>
      <p className="ref">
        <span className="t-eyebrow">Reference</span>
        <code className="ref__code">{reference}</code>
      </p>
      <div className="status-page__actions">
        <button type="button" className="k-btn k-btn--primary" onClick={() => window.location.reload()}>
          Try again
        </button>
        <a href="/" className="k-btn">
          Go to the home page
        </a>
      </div>
    </Root>
  );
}
