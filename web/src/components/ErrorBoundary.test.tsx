import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom with secret details');
}

describe('ErrorBoundary', () => {
  it('shows the error page with a reference code and no technical details', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // React re-dispatches render errors on window; stop jsdom printing the expected one.
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', quiet);
    vi.spyOn(Date, 'now').mockReturnValue(1_761_000_000_000);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/something went wrong/i);
    expect(screen.getByText((1_761_000_000_000).toString(36))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/');
    expect(document.body.textContent).not.toContain('kaboom');
    window.removeEventListener('error', quiet);
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });
});
