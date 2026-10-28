import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { json, mockFetch } from '../test/http';
import { feed, OCT27, openDispute } from '../test/dashboardFixtures';
import type { DashboardFeed } from '../lib/types';
import { Dashboard, updatedText } from './Dashboard';

// The real report pulls in AG Studio (about 5.8 MB); the page logic is tested against a stand-in.
vi.mock('../studio/StudioReport', () => ({
  default: ({ feed, ai }: { feed: DashboardFeed; ai?: unknown }) => (
    <div data-testid="studio" data-count={feed.sources.disputes.length} data-at={feed.generatedAt} data-ai={ai === 'analyst-ai' ? 'yes' : 'no'} />
  ),
}));
vi.mock('../studio/agent/harness', () => ({ analystAi: 'analyst-ai' }));

const URL_ = '/api/dashboard/data';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderDashboard() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

const calls = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls.filter(([u]) => String(u) === URL_).length;

afterEach(() => setVisibility('visible'));

describe('Dashboard page', () => {
  it('shows a skeleton, then the Studio report with the feed', async () => {
    let resolve!: (r: Response) => void;
    mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    renderDashboard();
    expect(screen.getByTestId('dashboard-skeleton')).toBeTruthy();
    await act(async () => resolve(json(200, feed([OCT27, openDispute({})]))));
    const studio = await screen.findByTestId('studio');
    expect(studio.getAttribute('data-count')).toBe('2');
    expect(screen.queryByTestId('dashboard-skeleton')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dashboard');
  });

  it('passes the Dispute Analyst harness to Studio on the first render, with the phone note', async () => {
    mockFetch(() => json(200, feed([OCT27, openDispute({})])));
    renderDashboard();
    const studio = await screen.findByTestId('studio');
    expect(studio.getAttribute('data-ai')).toBe('yes');
    // Shown only under 720px by CSS, where Studio hides its side panels.
    expect(screen.getByTestId('analyst-note').textContent).toBe('The Dispute Analyst chat works on wider screens.');
  });

  it('shows an empty state with a link to the guide when there are no disputes', async () => {
    mockFetch(() => json(200, feed([])));
    renderDashboard();
    expect(await screen.findByText('No disputes yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: /judge guide/i }).getAttribute('href')).toBe('/guide');
    expect(screen.queryByTestId('studio')).toBeNull();
    expect(screen.queryByTestId('analyst-note')).toBeNull();
  });

  it('refreshes every 60 seconds while the tab is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fn = mockFetch(() => json(200, feed([OCT27])));
    renderDashboard();
    await screen.findByTestId('studio');
    expect(calls(fn)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(calls(fn)).toBe(2);
    setVisibility('hidden');
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    expect(calls(fn)).toBe(2);
    // Coming back catches up at once, then the 60 s rhythm resumes.
    await act(async () => setVisibility('visible'));
    expect(calls(fn)).toBe(3);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(calls(fn)).toBe(4);
  });

  it('refreshes on demand and shows when it last updated', async () => {
    let n = 0;
    const fn = mockFetch(() => json(200, { ...feed([OCT27]), generatedAt: `2026-10-28T12:0${n++}:00.000Z` }));
    renderDashboard();
    await screen.findByTestId('studio');
    expect(screen.getByTestId('updated').textContent).toBe('Updated just now');
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await vi.waitFor(() => expect(screen.getByTestId('studio').getAttribute('data-at')).toBe('2026-10-28T12:01:00.000Z'));
    expect(calls(fn)).toBe(2);
  });

  it('keeps the last data and says so when a refresh fails', async () => {
    let fail = false;
    mockFetch(() => (fail ? json(500, { error: 'boom' }) : json(200, feed([OCT27]))));
    renderDashboard();
    await screen.findByTestId('studio');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(await screen.findByText(/Could not refresh/)).toBeTruthy();
    expect(screen.getByTestId('studio')).toBeTruthy();
  });

  it('offers a retry when the first load fails', async () => {
    let fail = true;
    mockFetch(() => (fail ? json(500, { error: 'boom' }) : json(200, feed([OCT27]))));
    renderDashboard();
    expect(await screen.findByText('We could not load the dashboard')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByTestId('studio')).toBeTruthy();
  });

  it('sends a signed-out visitor to the login page', async () => {
    mockFetch(() => json(401, { error: 'unauthorized' }));
    renderDashboard();
    expect((await screen.findByTestId('where')).textContent).toBe('/login?next=%2Fdashboard');
  });
});

describe('updatedText', () => {
  const at = Date.parse('2026-10-28T12:00:00.000Z');
  it.each([
    [10_000, 'Updated just now'],
    [59_000, 'Updated just now'],
    [60_000, 'Updated 1 min ago'],
    [125_000, 'Updated 2 min ago'],
    [3_600_000, 'Updated 60 min ago'],
  ])('%i ms later says %s', (ms, text) => {
    expect(updatedText(at, at + ms)).toBe(text);
  });
});
