import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { manualMessage } from '../components/review/ManualBanner';
import { json, mockFetch } from '../test/http';
import { DISPUTE_ID, LETTER, readyDetail } from '../test/disputeFixtures';
import type { DisputeDetail } from '../lib/types';
import { Review } from './Review';

const DETAIL_URL = `/api/disputes/${DISPUTE_ID}`;
const APPROVE_URL = `/api/disputes/${DISPUTE_ID}/approve`;

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderReview() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/disputes/${DISPUTE_ID}`]}>
        <Routes>
          <Route path="/disputes/:id" element={<Review />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** Serves the detail from a queue (last one repeats) and the approve call from `approve`. */
function serve(details: DisputeDetail[] | (() => Response), approve?: Handler) {
  const queue = Array.isArray(details) ? [...details] : null;
  return mockFetch((url, init) => {
    if (url === APPROVE_URL) return approve ? approve(init) : json(500, { error: 'unexpected' });
    if (url === DETAIL_URL) {
      if (!queue) return (details as () => Response)();
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return json(200, next);
    }
    return json(404, { error: 'not found' });
  });
}

const detailCalls = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls.filter(([u]) => String(u) === DETAIL_URL).length;
const approveCalls = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls.filter(([u]) => String(u) === APPROVE_URL);

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function openConfirm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  return screen.findByRole('dialog');
}

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('Review page', () => {
  it('READY renders the recommendation, evidence and the letter', async () => {
    serve([readyDetail()]);
    renderReview();
    const rec = await screen.findByRole('region', { name: 'AI recommendation' });
    expect(within(rec).getByText('Offer a partial refund')).toBeTruthy();
    expect(within(rec).getByText('80')).toBeTruthy();
    expect(within(rec).getByText('Weak evidence')).toBeTruthy();
    expect(within(rec).getByText(/Downgraded from FIGHT/)).toBeTruthy();
    expect(within(rec).getByText('$12.50')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Logo T-Shirt' })).toBeTruthy();
    expect(screen.getByText('Item not received')).toBeTruthy();
    expect(screen.getByText('Ready for review')).toBeTruthy();
    expect(screen.getByText('6 days left')).toBeTruthy();
    // The editor is filled by an effect after the first render; wait for it under load.
    await waitFor(() => expect((screen.getByLabelText('Letter') as HTMLTextAreaElement).value).toBe(LETTER));
    expect((screen.getByLabelText('Offer amount') as HTMLInputElement).value).toBe('12.50');
    expect(screen.getByText('Nothing is sent to PayPal until you approve.')).toBeTruthy();
    // Picker limited to allowed actions, recommended preselected.
    const picker = screen.getByRole('group', { name: 'Action' });
    expect(within(picker).getByRole('button', { name: /Partial refund/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(`${LETTER.length} / 2000`)).toBeTruthy();
  });

  it('only offers the actions PayPal allows', async () => {
    serve([readyDetail({ allowedActions: { fight: false, offer: true, accept: true, message: true, escalate: false, adjudicate: false } })]);
    renderReview();
    const picker = await screen.findByRole('group', { name: 'Action' });
    expect(within(picker).queryByRole('button', { name: /Fight/ })).toBeNull();
    expect(within(picker).getAllByRole('button')).toHaveLength(2);
  });

  it('NEEDS_MANUAL without analysis shows the banner and an empty, usable editor', async () => {
    serve([
      readyDetail({ localState: 'NEEDS_MANUAL', manualReason: 'AI draft unavailable (gemini:timeout groq:http_429)', latestAnalysis: null }),
    ]);
    renderReview();
    expect(await screen.findByText('The AI could not draft a letter. Write it yourself and approve.')).toBeTruthy();
    const letter = screen.getByLabelText('Letter') as HTMLTextAreaElement;
    expect(letter.value).toBe('');
    expect(letter.disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('manual banner copy by reason prefix', () => {
    expect(manualMessage('AI draft unavailable')).toBe('The AI could not draft a letter. Write it yourself and approve.');
    expect(manualMessage('PayPal rejected the action (UNPROCESSABLE_ENTITY)')).toBe(
      'PayPal rejected the last action. Check the case in PayPal before approving again.',
    );
    expect(manualMessage('no matching order')).toBe('We could not match this dispute to a store order.');
    expect(manualMessage('No PayPal action is open for this dispute')).toBe('PayPal has no action open for you right now.');
    expect(manualMessage('Could not reach PayPal')).toBe('Could not reach PayPal');
  });

  it('approve posts the exact body after the confirm dialog', async () => {
    const fn = serve([readyDetail()], () => json(202, { actionId: 7, state: 'PENDING' }));
    renderReview();
    const offer = (await screen.findByLabelText('Offer amount')) as HTMLInputElement;
    fireEvent.change(offer, { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Letter'), { target: { value: `${LETTER}\nThanks again.` } });
    const dialog = await openConfirm();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText('Offer a partial refund')).toBeTruthy();
    expect(within(dialog).getByText('$10.00')).toBeTruthy();
    expect(within(dialog).getByText('Hello,')).toBeTruthy();
    expect(within(dialog).getByText(/Thank you for your patience/)).toBeTruthy();
    expect(within(dialog).queryByText(/Our records show/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    expect(await screen.findByText('Sent to PayPal queue')).toBeTruthy();
    const calls = approveCalls(fn);
    expect(calls).toHaveLength(1);
    const init = calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'OFFER', note: `${LETTER}\nThanks again.`, offerAmount: '10.00' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('FIGHT and ACCEPT send no offer amount', async () => {
    const fn = serve([readyDetail()], () => json(202, { actionId: 8, state: 'PENDING' }));
    renderReview();
    const picker = await screen.findByRole('group', { name: 'Action' });
    fireEvent.click(within(picker).getByRole('button', { name: /Fight/ }));
    expect(screen.queryByLabelText('Offer amount')).toBeNull();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    await screen.findByText('Sent to PayPal queue');
    expect(JSON.parse(String(approveCalls(fn)[0]![1]!.body))).toEqual({ action: 'FIGHT', note: LETTER });
  });

  it('a double click sends one request and the button is disabled while pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = serve([readyDetail()], async () => {
      await gate;
      return json(202, { actionId: 9, state: 'PENDING' });
    });
    renderReview();
    const dialog = await openConfirm();
    const send = within(dialog).getByRole('button', { name: 'Send to PayPal' }) as HTMLButtonElement;
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(send.disabled).toBe(true));
    expect(approveCalls(fn)).toHaveLength(1);
    await act(async () => release());
    await screen.findByText('Sent to PayPal queue');
    expect(approveCalls(fn)).toHaveLength(1);
  });

  it.each([
    [{ error: 'action already pending' }, 'An action is already pending'],
    [{ error: 'not ready' }, 'This dispute changed, reloading'],
    [{ error: 'action not allowed now', allowed: { fight: false, offer: true, accept: true } }, 'PayPal no longer allows this action'],
  ])('409 %o shows a plain message and reloads', async (body, message) => {
    const fn = serve([readyDetail()], () => json(409, body));
    renderReview();
    const dialog = await openConfirm();
    const before = detailCalls(fn);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(body.error)).toBeNull();
    await waitFor(() => expect(detailCalls(fn)).toBeGreaterThan(before));
  });

  it.each([
    [{ error: 'action already pending' }, 'An action is already pending'],
    [{ error: 'not ready' }, 'This dispute changed, reloading'],
  ])('409 %o message clears once the reload shows a new state', async (body, message) => {
    serve([readyDetail(), readyDetail({ localState: 'ACTION_PENDING' })], () => json(409, body));
    renderReview();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    await screen.findByText('Sending to PayPal');
    expect(screen.queryByText(message)).toBeNull();
  });

  it('an unknown 409 gets the safe message', async () => {
    serve([readyDetail()], () => json(409, { error: 'something new from the server' }));
    renderReview();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    expect(await screen.findByText('This dispute changed, reloading')).toBeTruthy();
    expect(screen.queryByText(/something new/)).toBeNull();
  });

  it.each([
    [19, false],
    [20, true],
    [2000, true],
    [2001, false],
  ])('a letter of %i characters opens the dialog: %s', async (len, opens) => {
    serve([readyDetail()]);
    renderReview();
    fireEvent.change(await screen.findByLabelText('Letter'), { target: { value: 'x'.repeat(len) } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    if (opens) expect(await screen.findByRole('dialog')).toBeTruthy();
    else {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByText('Write between 20 and 2000 characters.')).toBeTruthy();
    }
  });

  it.each(['0', '25', '25.00', '12.345'])('offer %s is rejected before the dialog', async (value) => {
    serve([readyDetail()]);
    renderReview();
    fireEvent.change(await screen.findByLabelText('Offer amount'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Enter an amount above $0.00 and below $25.00.')).toBeTruthy();
  });

  it('offer $12.5 is accepted and sent as 12.50', async () => {
    const fn = serve([readyDetail()], () => json(202, { actionId: 10, state: 'PENDING' }));
    renderReview();
    fireEvent.change(await screen.findByLabelText('Offer amount'), { target: { value: '$12.5' } });
    const dialog = await openConfirm();
    expect(within(dialog).getByText('$12.50')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    await screen.findByText('Sent to PayPal queue');
    expect(JSON.parse(String(approveCalls(fn)[0]![1]!.body)).offerAmount).toBe('12.50');
  });

  it('the FIGHT dialog shows the disputed amount', async () => {
    serve([readyDetail()]);
    renderReview();
    const picker = await screen.findByRole('group', { name: 'Action' });
    fireEvent.click(within(picker).getByRole('button', { name: /Fight/ }));
    const dialog = await openConfirm();
    expect(within(dialog).getByText('Disputed')).toBeTruthy();
    expect(within(dialog).getByText('$25.00')).toBeTruthy();
  });

  it('focus stays inside the dialog while sending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    serve([readyDetail()], async () => {
      await gate;
      return json(202, { actionId: 11, state: 'PENDING' });
    });
    renderReview();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => release());
    await screen.findByText('Sent to PayPal queue');
  });

  it('closing the dialog returns focus to Approve even if focus was elsewhere at open', async () => {
    serve([readyDetail()]);
    renderReview();
    const approve = await screen.findByRole('button', { name: 'Approve' });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(approve);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(approve);
  });

  it('a rejected action is told once: the alert, not the banner too', async () => {
    serve([
      readyDetail({
        localState: 'NEEDS_MANUAL',
        manualReason: 'PayPal rejected the action (UNPROCESSABLE_ENTITY)',
        actions: [
          { id: 2, type: 'FIGHT', state: 'FAILED', error: 'UNPROCESSABLE_ENTITY: x', createdAt: '2026-10-28T09:00:00.000Z', sentAt: null },
        ],
      }),
    ]);
    renderReview();
    expect(await screen.findByText('Your last action did not go through')).toBeTruthy();
    expect(screen.queryByText('PayPal rejected the last action. Check the case in PayPal before approving again.')).toBeNull();
  });

  it('400 on the note shows a field error without the server text', async () => {
    serve([readyDetail()], () => json(400, { error: 'note must be 20-2000 characters' }));
    renderReview();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    expect(await screen.findByText('Write between 20 and 2000 characters.')).toBeTruthy();
    expect(screen.queryByText(/note must be/)).toBeNull();
    expect(screen.getByLabelText('Letter').getAttribute('aria-invalid')).toBe('true');
  });

  it('400 on the offer shows a field error on the amount', async () => {
    serve([readyDetail()], () => json(400, { error: 'offerAmount must be greater than 0 and less than the disputed amount' }));
    renderReview();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    expect(await screen.findByText('Enter an amount above $0.00 and below $25.00.')).toBeTruthy();
    expect(screen.getByLabelText('Offer amount').getAttribute('aria-invalid')).toBe('true');
  });

  it('502 says PayPal could not be reached', async () => {
    serve([readyDetail()], () => json(502, { error: 'could not reach PayPal' }));
    renderReview();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to PayPal' }));
    expect(await screen.findByText('Could not reach PayPal. Try again in a minute.')).toBeTruthy();
  });

  it('checks the letter and offer before opening the dialog', async () => {
    const fn = serve([readyDetail()]);
    renderReview();
    fireEvent.change(await screen.findByLabelText('Letter'), { target: { value: 'Too short' } });
    fireEvent.change(screen.getByLabelText('Offer amount'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Write between 20 and 2000 characters.')).toBeTruthy();
    expect(screen.getByText('Enter an amount above $0.00 and below $25.00.')).toBeTruthy();
    expect(approveCalls(fn)).toHaveLength(0);
  });

  it('Escape closes the dialog and focus returns to Approve', async () => {
    serve([readyDetail()]);
    renderReview();
    const approve = await screen.findByRole('button', { name: 'Approve' });
    approve.focus();
    fireEvent.click(approve);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(approve);
  });

  it('Tab stays inside the dialog', async () => {
    serve([readyDetail()]);
    renderReview();
    const dialog = await openConfirm();
    const keep = within(dialog).getByRole('button', { name: 'Keep editing' });
    const send = within(dialog).getByRole('button', { name: 'Send to PayPal' });
    send.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(send);
  });

  it('ANALYZING shows a calm line and keeps approve disabled', async () => {
    serve([readyDetail({ localState: 'ANALYZING', latestAnalysis: null })]);
    renderReview();
    expect(await screen.findByText('The AI is reading the evidence')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ACTION_PENDING replaces the approve area with a status summary', async () => {
    serve([
      readyDetail({
        localState: 'ACTION_PENDING',
        actions: [{ id: 1, type: 'OFFER', state: 'PENDING', error: null, createdAt: '2026-10-28T10:00:00.000Z', sentAt: null }],
      }),
    ]);
    renderReview();
    expect(await screen.findByText('Sending to PayPal')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByLabelText('Letter')).toBeNull();
  });

  it('RESOLVED shows the outcome and the amount kept', async () => {
    serve([
      readyDetail({
        localState: 'RESOLVED',
        status: 'RESOLVED',
        outcome: 'RESOLVED_BUYER_FAVOUR',
        amount: '12.50',
        originalAmount: '25.00',
        actions: [
          { id: 1, type: 'OFFER', state: 'SENT', error: null, createdAt: '2026-10-27T14:05:00.000Z', sentAt: '2026-10-27T14:05:02.000Z' },
        ],
      }),
    ]);
    renderReview();
    const summary = await screen.findByRole('region', { name: 'Outcome' });
    expect(within(summary).getByText('You kept')).toBeTruthy();
    expect(within(summary).getByText('$12.50')).toBeTruthy();
    expect(within(summary).getByText(/of \$25\.00/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('a failed action is explained and the seller can approve again', async () => {
    serve([
      readyDetail({
        localState: 'NEEDS_MANUAL',
        manualReason: 'PayPal rejected the action (UNPROCESSABLE_ENTITY)',
        actions: [
          {
            id: 2,
            type: 'FIGHT',
            state: 'FAILED',
            error: 'UNPROCESSABLE_ENTITY: The requested action could not be performed',
            createdAt: '2026-10-28T09:00:00.000Z',
            sentAt: null,
          },
        ],
      }),
    ]);
    renderReview();
    expect(await screen.findByText('Your last action did not go through')).toBeTruthy();
    expect(screen.getAllByText(/PayPal did not accept Fight/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('404 shows a not found state with a link back', async () => {
    serve(() => json(404, { error: 'not found' }));
    renderReview();
    expect(await screen.findByText('We could not find this dispute')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All disputes' }).getAttribute('href')).toBe('/dashboard');
  });

  it('401 sends the visitor to sign in with the return path', async () => {
    serve(() => json(401, { error: 'unauthorized' }));
    renderReview();
    const where = await screen.findByTestId('where');
    expect(where.textContent).toBe(`/login?next=${encodeURIComponent(`/disputes/${DISPUTE_ID}`)}`);
  });
});

describe('Review polling', () => {
  it('polls every 5 s while ANALYZING and stops after ACTION_SENT', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fn = serve([
      readyDetail({ localState: 'ANALYZING', latestAnalysis: null }),
      readyDetail({ localState: 'ACTION_PENDING' }),
      readyDetail({ localState: 'ACTION_SENT' }),
    ]);
    renderReview();
    await screen.findByText('The AI is reading the evidence');
    expect(detailCalls(fn)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(detailCalls(fn)).toBe(2);
    await screen.findByText('Sending to PayPal');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(detailCalls(fn)).toBe(3);
    await screen.findByText('Sent to PayPal');
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(detailCalls(fn)).toBe(3);
  });

  it('a tab return during polling does not double up with the timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (() => void) | null = null;
    let calls = 0;
    mockFetch(async (url) => {
      if (url !== DETAIL_URL) return json(404, {});
      calls += 1;
      if (calls === 2) await new Promise<void>((r) => (release = r));
      return json(200, readyDetail({ localState: 'ANALYZING', latestAnalysis: null }));
    });
    renderReview();
    await screen.findByText('The AI is reading the evidence');
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await waitFor(() => expect(calls).toBe(2));
    // The tab-return load is still in flight: the 5 s timer must not fire another one.
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(calls).toBe(2);
    await act(async () => release!());
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(calls).toBe(3);
  });

  it('pauses while the tab is hidden and resumes when visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fn = serve([readyDetail({ localState: 'ANALYZING', latestAnalysis: null })]);
    renderReview();
    await screen.findByText('The AI is reading the evidence');
    act(() => setVisibility('hidden'));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(detailCalls(fn)).toBe(1);
    act(() => setVisibility('visible'));
    await waitFor(() => expect(detailCalls(fn)).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(detailCalls(fn)).toBe(3);
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fn = serve([readyDetail({ localState: 'ANALYZING', latestAnalysis: null })]);
    const view = renderReview();
    await screen.findByText('The AI is reading the evidence');
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(detailCalls(fn)).toBe(1);
  });

  it('keeps the edited letter when a refresh returns the same analysis', async () => {
    const fn = serve([readyDetail()]);
    renderReview();
    const letter = (await screen.findByLabelText('Letter')) as HTMLTextAreaElement;
    fireEvent.change(letter, { target: { value: 'My own words for the buyer, written by hand.' } });
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await waitFor(() => expect(detailCalls(fn)).toBe(2));
    expect((screen.getByLabelText('Letter') as HTMLTextAreaElement).value).toBe('My own words for the buyer, written by hand.');
    expect(screen.queryByText('The analysis was updated.')).toBeNull();
  });

  it('offers to reload the letter when the analysis changed, without losing edits', async () => {
    const newer = readyDetail();
    newer.latestAnalysis = { ...newer.latestAnalysis!, letterDraft: 'A fresh draft from the newer analysis run.', createdAt: '2026-10-28T09:00:00.000Z' };
    const fn = serve([readyDetail(), newer]);
    renderReview();
    const letter = (await screen.findByLabelText('Letter')) as HTMLTextAreaElement;
    fireEvent.change(letter, { target: { value: 'My own words for the buyer, written by hand.' } });
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await waitFor(() => expect(detailCalls(fn)).toBe(2));
    expect(await screen.findByText('The analysis was updated.')).toBeTruthy();
    expect((screen.getByLabelText('Letter') as HTMLTextAreaElement).value).toBe('My own words for the buyer, written by hand.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload the letter' }));
    expect((screen.getByLabelText('Letter') as HTMLTextAreaElement).value).toBe('A fresh draft from the newer analysis run.');
    expect(screen.queryByText('The analysis was updated.')).toBeNull();
  });

  it('adopts a new draft silently when the letter was not edited', async () => {
    const fn = serve([
      readyDetail({ localState: 'ANALYZING', latestAnalysis: null }),
      readyDetail(),
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderReview();
    await screen.findByText('The AI is reading the evidence');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(detailCalls(fn)).toBe(2));
    await waitFor(() => expect((screen.getByLabelText('Letter') as HTMLTextAreaElement).value).toBe(LETTER));
    expect(screen.queryByText('The analysis was updated.')).toBeNull();
  });
});
