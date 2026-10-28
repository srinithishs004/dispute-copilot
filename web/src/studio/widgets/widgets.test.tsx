import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AgWidgetParams } from 'ag-studio';
import { ActionNeededView, ActionNeededWidget, actionNeededItems } from './ActionNeededWidget';
import { MoneyProtectedView, MoneyProtectedWidget, moneyTotals } from './MoneyProtectedWidget';
import { bumpFeedVersion } from './studioRows';
import { studioDisputeRows } from '../dataSources';
import { feed, OCT27, openDispute } from '../../test/dashboardFixtures';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const iso = (days: number) => new Date(NOW + days * DAY + 3_600_000).toISOString();

const OPEN = [
  openDispute({ disputeId: 'PP-D-LATER', daysLeft: 9, responseDueAt: iso(9), originalAmount: 40 }),
  openDispute({ disputeId: 'PP-D-LATE', daysLeft: -2, responseDueAt: iso(-3), deadlineFlag: 'overdue', originalAmount: 18 }),
  openDispute({ disputeId: 'PP-D-SOON', daysLeft: 2, responseDueAt: iso(1), deadlineFlag: 'due_soon', originalAmount: 60, reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' }),
  openDispute({ disputeId: 'PP-D-NODUE', daysLeft: null, responseDueAt: null, localState: 'ANALYZING' }),
];

/** Studio rows for the views: same shape the widgets get back from widgetApi. */
const rowsOf = (...ds: Parameters<typeof feed>[0]) => studioDisputeRows(feed(ds)) as unknown as Record<string, unknown>[];

describe('Action needed', () => {
  it('lists open disputes by days left, with no deadline last', () => {
    const items = actionNeededItems(rowsOf(OCT27, ...OPEN));
    expect(items.map((i) => i.disputeId)).toEqual(['PP-D-LATE', 'PP-D-SOON', 'PP-D-LATER', 'PP-D-NODUE']);
  });

  it('shows countdowns, deadline colours and a link to each review', () => {
    render(
      <MemoryRouter>
        <ActionNeededView rows={rowsOf(OCT27, ...OPEN)} now={NOW} />
      </MemoryRouter>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]!.textContent).toContain('Overdue by 2 days');
    expect(items[0]!.querySelector('.aw__due')!.className).toMatch(/aw__due--danger/);
    expect(items[1]!.textContent).toContain('1 day left');
    expect(items[1]!.textContent).toContain('Item not received');
    expect(items[1]!.querySelector('.aw__due')!.className).toMatch(/aw__due--warning/);
    expect(items[2]!.textContent).toContain('9 days left');
    expect(items[2]!.querySelector('.aw__due')!.className).not.toMatch(/warning|danger/);
    expect(items[3]!.textContent).toContain('No deadline yet');
    const link = within(items[1]!).getByRole('link', { name: /open review/i });
    expect(link.getAttribute('href')).toBe('/disputes/PP-D-SOON');
    expect(screen.queryByText(/PP-R-NZM-10194801/)).toBeNull();
  });

  it('says so when nothing is open', () => {
    render(
      <MemoryRouter>
        <ActionNeededView rows={rowsOf(OCT27)} now={NOW} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Nothing needs you right now')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Money protected', () => {
  it('sums kept and refunded over resolved disputes only', () => {
    expect(moneyTotals(rowsOf(OCT27, ...OPEN))).toEqual({ kept: 12.5, refunded: 12.5, disputed: 25, resolvedCount: 1, currency: 'USD' });
  });

  it('shows the Oct 27 result: $12.50 kept and $12.50 refunded', () => {
    const { container } = render(<MoneyProtectedView rows={rowsOf(OCT27, ...OPEN)} />);
    expect(screen.getByTestId('money-kept').textContent).toContain('$12.50');
    expect(screen.getByTestId('money-refunded').textContent).toContain('$12.50');
    expect(container.querySelector('.mw__foot')!.textContent).toBe('Over 1 resolved dispute, $25.00 disputed.');
  });

  it('shows an empty state until a dispute resolves', () => {
    render(<MoneyProtectedView rows={rowsOf(...OPEN)} />);
    expect(screen.getByText('No resolved disputes yet')).toBeTruthy();
    expect(screen.queryByTestId('money-kept')).toBeNull();
  });
});

/** A minimal stand-in for Studio's widget params: a schema and a getData that returns keyed rows. */
function fakeParams(rows: Record<string, unknown>[]) {
  const ids = Object.keys(rows[0] ?? { disputeId: '' });
  const fields = ids.map((id) => ({ fieldId: `disputes.${id}`, key: `disputes.${id}` }));
  const getData = vi.fn(async (q: { fields: { key: string }[] }) => ({
    results: {
      rows: rows.map((r) => Object.fromEntries(q.fields.map((f) => [f.key, r[f.key.replace('disputes.', '')]]))),
    },
  }));
  const setDisplayState = vi.fn();
  const params = {
    widgetId: 'w',
    widgetType: 'x',
    dataMapping: {},
    widgetApi: { getSchema: () => [{ id: 'disputes', name: 'Disputes', type: 'table', fields }], getData, setDisplayState },
  } as unknown as AgWidgetParams;
  return { params, getData, setDisplayState };
}

describe('Studio widget wrappers', () => {
  it('Money protected reads rows through widgetApi.getData', async () => {
    const { params, getData, setDisplayState } = fakeParams(rowsOf(OCT27));
    render(<MoneyProtectedWidget {...params} />);
    expect((await screen.findByTestId('money-kept')).textContent).toContain('$12.50');
    expect(getData).toHaveBeenCalledTimes(1);
    expect(getData.mock.calls[0]![0].fields.map((f) => f.key)).toContain('disputes.amountKept');
    expect(setDisplayState).toHaveBeenCalledWith('displayed');
    // A dashboard refresh queries again.
    await act(async () => bumpFeedVersion());
    expect(getData).toHaveBeenCalledTimes(2);
  });

  it('Action needed links to the review page', async () => {
    const { params } = fakeParams(rowsOf(...OPEN));
    render(
      <MemoryRouter>
        <ActionNeededWidget {...params} />
      </MemoryRouter>,
    );
    const links = await screen.findAllByRole('link', { name: /open review/i });
    expect(links[0]!.getAttribute('href')).toBe('/disputes/PP-D-LATE');
  });
});
