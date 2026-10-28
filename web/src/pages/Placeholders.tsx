import { Link } from 'react-router-dom';
import { usePageTitle } from '../lib/usePageTitle';
import { EmptyState } from '../components/EmptyState';
import { LayoutIcon } from '../components/Icons';

/** Stands in for the AG Studio dashboard until Task 8. */
export function DashboardPlaceholder() {
  usePageTitle('Dashboard');
  return (
    <div className="page page--wide">
      <header className="page__head">
        <h1 className="t-h1">Dashboard</h1>
      </header>
      <EmptyState
        glyph={<LayoutIcon size={24} />}
        title="The dispute dashboard is on its way"
        actions={
          <Link to="/guide" className="k-btn">
            Open the judge guide
          </Link>
        }
      >
        Open disputes, deadlines and money protected will show here. Until then, the guide explains the demo.
      </EmptyState>
    </div>
  );
}
