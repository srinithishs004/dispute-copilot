import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { WakingUpGate } from './WakingUp';
import { json, mockFetch } from '../test/http';

const MESSAGE = 'Starting the demo server, this takes about 30 seconds.';

async function flush() {
  // Let pending fetch promises and state updates settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('WakingUpGate', () => {
  it('shows the waking screen while /health fails, retries every 3 s, then shows the app', async () => {
    vi.useFakeTimers();
    let up = false;
    const fetch = mockFetch((url) => {
      expect(url).toBe('/health');
      if (!up) throw new TypeError('Failed to fetch');
      return json(200, { ok: true });
    });

    render(
      <WakingUpGate>
        <p>The app</p>
      </WakingUpGate>,
    );
    await flush();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText(MESSAGE)).toBeTruthy();

    up = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await flush();
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(screen.getByText('The app')).toBeTruthy();

    // No more health polling once the server is up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('never shows the waking screen when the server is already up', async () => {
    mockFetch(() => json(200, { ok: true }));
    render(
      <WakingUpGate>
        <p>The app</p>
      </WakingUpGate>,
    );
    expect(await screen.findByText('The app')).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
