import { useEffect, useState } from 'react';
import { applyTheme, getInitialTheme, getSavedTheme, saveTheme, type Theme } from '../lib/theme';
import { MoonIcon, SunIcon } from './Icons';

const OPTIONS: { value: Theme; label: string; Icon: typeof MoonIcon }[] = [
  { value: 'night', label: 'Night', Icon: MoonIcon },
  { value: 'day', label: 'Day', Icon: SunIcon },
];

/** Two-option Night / Day switch. A manual choice is saved; otherwise the device setting is followed. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow the device setting live until the visitor picks a theme.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq?.addEventListener) return;
    const onChange = (e: MediaQueryListEvent) => {
      if (!getSavedTheme()) setTheme(e.matches ? 'day' : 'night');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const choose = (t: Theme) => {
    saveTheme(t);
    setTheme(t);
  };

  return (
    <div className="k-seg theme-switch" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" aria-pressed={theme === value} onClick={() => choose(value)}>
          <Icon size={14} />
          <span className="theme-switch__label">{label}</span>
        </button>
      ))}
    </div>
  );
}
