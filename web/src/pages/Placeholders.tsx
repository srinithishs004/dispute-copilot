import { Link } from 'react-router-dom';
import { usePageTitle } from '../lib/usePageTitle';
import { EmptyState } from '../components/EmptyState';
import { FileTextIcon, LayoutIcon } from '../components/Icons';

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

/** Stands in for the Review page until Task 7. */
export function ReviewPlaceholder() {
  usePageTitle('Dispute review');
  return (
    <div className="page page--wide">
      <header className="page__head">
        <h1 className="t-h1">Dispute review</h1>
      </header>
      <EmptyState
        glyph={<FileTextIcon size={24} />}
        title="The review page is on its way"
        actions={
          <Link to="/dashboard" className="k-btn">
            Back to the dashboard
          </Link>
        }
      >
        The evidence, the recommendation and the draft letter for this dispute will show here, ready to approve.
      </EmptyState>
    </div>
  );
}
