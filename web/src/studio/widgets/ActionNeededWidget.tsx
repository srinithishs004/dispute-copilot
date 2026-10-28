import { Link } from 'react-router-dom';
import type { AgWidgetParams } from 'ag-studio';
import { deadlineText, money } from '../../lib/format';
import { num, str, useStudioRows, type PlainRow } from './studioRows';

export const ACTION_NEEDED_FIELDS = [
  'disputeId',
  'reason',
  'localState',
  'resolved',
  'originalAmount',
  'currency',
  'responseDueAt',
  'daysLeft',
  'deadlineFlag',
] as const;

export type ActionItem = {
  disputeId: string;
  reason: string;
  state: string;
  amount: string;
  dueAt: string | null;
  daysLeft: number | null;
  tone: 'danger' | 'warning' | 'plain';
};

const asIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : str(v));

/** Open disputes, soonest deadline first; disputes without a deadline go last. */
export function actionNeededItems(rows: PlainRow[], now: number = Date.now()): ActionItem[] {
  return rows
    .filter((r) => r.resolved !== true && str(r.disputeId))
    .map((r) => {
      const flag = str(r.deadlineFlag);
      const dueAt = asIso(r.responseDueAt);
      // Past the deadline reads as overdue even before the server flag catches up.
      const overdue = flag === 'overdue' || (dueAt !== null && Date.parse(dueAt) < now);
      return {
        disputeId: str(r.disputeId)!,
        reason: str(r.reason) ?? 'Unknown reason',
        state: str(r.localState) ?? '',
        amount: money(num(r.originalAmount), str(r.currency)),
        dueAt,
        daysLeft: num(r.daysLeft),
        tone: overdue ? 'danger' : flag === 'due_soon' ? 'warning' : 'plain',
      } satisfies ActionItem;
    })
    .sort((a, b) => {
      if (a.daysLeft === null || b.daysLeft === null) return a.daysLeft === null ? (b.daysLeft === null ? 0 : 1) : -1;
      return a.daysLeft - b.daysLeft || (a.dueAt ?? '').localeCompare(b.dueAt ?? '');
    });
}

export function ActionNeededView({ rows, now = Date.now() }: { rows: PlainRow[]; now?: number }) {
  const items = actionNeededItems(rows, now);
  if (items.length === 0) {
    return (
      <div className="dw dw--empty">
        <p className="dw__empty-title">Nothing needs you right now</p>
        <p className="dw__empty-text">New disputes show here with their deadline.</p>
      </div>
    );
  }
  return (
    <div className="dw">
      <ul className="aw__list">
        {items.map((it) => (
          <li key={it.disputeId} className="aw__item">
            <div className="aw__main">
              <span className="aw__reason">{it.reason}</span>
              <span className="aw__meta">
                <span className="aw__amount">{it.amount}</span>
                {it.state ? <span>{it.state}</span> : null}
              </span>
            </div>
            <span className={`aw__due aw__due--${it.tone}`}>{deadlineText(it.dueAt, now) ?? 'No deadline yet'}</span>
            <Link className="k-btn k-btn--sm aw__open" to={`/disputes/${encodeURIComponent(it.disputeId)}`}>
              Open review
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Studio custom widget: open disputes by deadline. */
export function ActionNeededWidget(params: AgWidgetParams) {
  const { rows, failed } = useStudioRows(params, 'disputes', ACTION_NEEDED_FIELDS);
  if (failed) return <WidgetError />;
  if (!rows) return null;
  return <ActionNeededView rows={rows} />;
}

export function WidgetError() {
  return (
    <div className="dw dw--empty">
      <p className="dw__empty-title">This widget could not load its data</p>
      <p className="dw__empty-text">Refresh the dashboard to try again.</p>
    </div>
  );
}
