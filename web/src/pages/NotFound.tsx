import { Link } from 'react-router-dom';
import { usePageTitle } from '../lib/usePageTitle';

export function NotFound() {
  usePageTitle('Page not found');
  return (
    <div className="page page--narrow status-page">
      <p className="t-eyebrow eyebrow">Error 404</p>
      <h1 className="t-h1">Page not found</h1>
      <p className="t-body-lg muted">This page does not exist or has moved. Check the address, or start again from the home page.</p>
      <div className="status-page__actions">
        <Link to="/" className="k-btn k-btn--primary">
          Go to the home page
        </Link>
        <Link to="/guide" className="k-btn">
          Open the judge guide
        </Link>
      </div>
    </div>
  );
}
