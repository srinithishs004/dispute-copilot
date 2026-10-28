import type { AgWidgetParams } from 'ag-studio';
import { money } from '../../lib/format';
import { WidgetError } from './ActionNeededWidget';
import { num, str, useStudioRows, type PlainRow } from './studioRows';

export const MONEY_FIELDS = ['disputeId', 'resolved', 'originalAmount', 'amountKept', 'amountRefunded', 'currency'] as const;

export type MoneyTotals = { kept: number; refunded: number; disputed: number; resolvedCount: number; currency: string };

const add = (a: number, b: number) => Math.round((a + b) * 100) / 100;

/** Real sums over resolved disputes: what the seller kept and what went back to buyers. */
export function moneyTotals(rows: PlainRow[]): MoneyTotals {
  const t: MoneyTotals = { kept: 0, refunded: 0, disputed: 0, resolvedCount: 0, currency: 'USD' };
  for (const r of rows) {
    const kept = num(r.amountKept);
    if (r.resolved !== true || kept === null) continue;
    const original = num(r.originalAmount) ?? kept;
    t.kept = add(t.kept, kept);
    t.refunded = add(t.refunded, num(r.amountRefunded) ?? Math.max(0, original - kept));
    t.disputed = add(t.disputed, original);
    t.resolvedCount += 1;
    t.currency = str(r.currency) ?? t.currency;
  }
  return t;
}

export function MoneyProtectedView({ rows }: { rows: PlainRow[] }) {
  const t = moneyTotals(rows);
  if (t.resolvedCount === 0) {
    return (
      <div className="dw dw--empty">
        <p className="dw__empty-title">No resolved disputes yet</p>
        <p className="dw__empty-text">When PayPal closes a dispute, what you kept and what was refunded shows here.</p>
      </div>
    );
  }
  const keptShare = t.disputed > 0 ? Math.round((t.kept / t.disputed) * 100) : 0;
  return (
    <div className="dw mw">
      <div className="mw__stats">
        <div className="k-stat">
          <span className="k-eyebrow">Kept</span>
          <span className="k-stat__value mw__value" data-testid="money-kept">
            {money(t.kept, t.currency)}
          </span>
          <span className="mw__hint">Stayed with you</span>
        </div>
        <div className="k-stat">
          <span className="k-eyebrow">Refunded</span>
          <span className="k-stat__value mw__value mw__value--muted" data-testid="money-refunded">
            {money(t.refunded, t.currency)}
          </span>
          <span className="mw__hint">Went back to buyers</span>
        </div>
      </div>
      <div
        className="mw__bar"
        role="img"
        aria-label={`Kept ${keptShare} percent of the disputed amount`}
      >
        <span className="mw__bar-kept" style={{ width: `${keptShare}%` }} />
      </div>
      <p className="mw__foot">
        Over {t.resolvedCount} resolved {t.resolvedCount === 1 ? 'dispute' : 'disputes'},{' '}
        <span className="mw__mono">{money(t.disputed, t.currency)}</span> disputed.
      </p>
    </div>
  );
}

/** Studio custom widget: kept versus refunded over resolved disputes. */
export function MoneyProtectedWidget(params: AgWidgetParams) {
  const { rows, failed } = useStudioRows(params, 'disputes', MONEY_FIELDS);
  if (failed) return <WidgetError />;
  if (!rows) return null;
  return <MoneyProtectedView rows={rows} />;
}
