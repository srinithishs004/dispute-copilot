import { Link } from 'react-router-dom';
import type { CustomCellRendererProps } from 'ag-grid-react';

/** Grid cells for the dispute id link to the Review page; other columns keep Studio's rendering. */
export function DisputeLinkCell({ value }: CustomCellRendererProps) {
  if (typeof value !== 'string' || !value) return null;
  return (
    <Link className="grid-link" to={`/disputes/${encodeURIComponent(value)}`}>
      {value}
    </Link>
  );
}
