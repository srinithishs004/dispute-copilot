import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no matchMedia; default to "no preference". Tests override per case.
export function mockColorScheme(scheme: 'light' | 'dark' | null) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: scheme !== null && query.includes(`prefers-color-scheme: ${scheme}`),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

mockColorScheme(null);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mockColorScheme(null);
});
