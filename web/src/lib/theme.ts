// Kaala theme choice. public/theme-init.js runs the same logic before first paint.
export type Theme = 'night' | 'day';
export const THEME_KEY = 'kaala-theme';

const isTheme = (v: unknown): v is Theme => v === 'night' || v === 'day';

export function getSavedTheme(): Theme | null {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return isTheme(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function getDeviceTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'day' : 'night';
  } catch {
    return 'night';
  }
}

/** Saved choice, else the device setting, else night. */
export function getInitialTheme(): Theme {
  return getSavedTheme() ?? getDeviceTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the switch still works for this visit.
  }
}
