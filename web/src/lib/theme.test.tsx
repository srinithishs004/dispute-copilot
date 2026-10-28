import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { applyTheme, getInitialTheme, THEME_KEY } from './theme';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { mockColorScheme } from '../test/setup';

describe('getInitialTheme', () => {
  it('defaults to night with no saved choice and no device preference', () => {
    expect(getInitialTheme()).toBe('night');
  });

  it('follows a light device preference', () => {
    mockColorScheme('light');
    expect(getInitialTheme()).toBe('day');
  });

  it('follows a dark device preference', () => {
    mockColorScheme('dark');
    expect(getInitialTheme()).toBe('night');
  });

  it('prefers the saved choice over the device setting', () => {
    mockColorScheme('light');
    window.localStorage.setItem(THEME_KEY, 'night');
    expect(getInitialTheme()).toBe('night');
  });

  it('ignores an unknown saved value', () => {
    window.localStorage.setItem(THEME_KEY, 'purple');
    mockColorScheme('light');
    expect(getInitialTheme()).toBe('day');
  });

  it('applyTheme sets data-theme on <html>', () => {
    applyTheme('day');
    expect(document.documentElement.getAttribute('data-theme')).toBe('day');
  });
});

describe('ThemeSwitch', () => {
  it('shows the current theme as pressed and persists a switch', () => {
    render(<ThemeSwitch />);
    const night = screen.getByRole('button', { name: /night/i });
    const day = screen.getByRole('button', { name: /day/i });
    expect(night.getAttribute('aria-pressed')).toBe('true');
    expect(day.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(day);

    expect(day.getAttribute('aria-pressed')).toBe('true');
    expect(night.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.getAttribute('data-theme')).toBe('day');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('day');
  });

  it('starts from the saved theme', () => {
    window.localStorage.setItem(THEME_KEY, 'day');
    render(<ThemeSwitch />);
    expect(screen.getByRole('button', { name: /day/i }).getAttribute('aria-pressed')).toBe('true');
  });
});
