import { afterEach, describe, expect, it } from 'vitest';
import { kaalaStudioParams, kaalaStudioTheme, readKaalaTokens } from './studioTheme';

// jsdom does not load kaala/tokens.css, so give it the few tokens the theme reads, per theme.
function tokens() {
  const style = document.createElement('style');
  style.id = 'test-tokens';
  style.textContent = `
    [data-theme="night"] { --canvas: #0a0a0b; --surface-1: #111113; --surface-2: #18181b; --surface-3: #212125; --line: #26262b;
      --line-strong: #3a3a40; --line-control: #66666e; --ink: #ededef; --ink-2: #a1a1a8; --ink-3: #8a8a92; --secondary: #8b83e6;
      --secondary-ink: #8b83e6; --popover: #212125; --font-sans: "Manrope", sans-serif; --font-mono: "JetBrains Mono", monospace; }
    [data-theme="day"] { --canvas: #f5f5f7; --surface-1: #ffffff; --surface-2: #ececef; --surface-3: #e2e2e6; --line: #e4e4e8;
      --line-strong: #d1d1d7; --line-control: #77777f; --ink: #111113; --ink-2: #4f4f57; --ink-3: #5f5f67; --secondary: #8b83e6;
      --secondary-ink: #5a50c8; --popover: #ffffff; --font-sans: "Manrope", sans-serif; --font-mono: "JetBrains Mono", monospace; }`;
  document.head.appendChild(style);
}

afterEach(() => document.getElementById('test-tokens')?.remove());

describe('Kaala studio theme', () => {
  it('reads each theme’s tokens whatever the page theme is', () => {
    tokens();
    document.documentElement.setAttribute('data-theme', 'night');
    expect(readKaalaTokens('day').canvas).toBe('#f5f5f7');
    expect(readKaalaTokens('night').canvas).toBe('#0a0a0b');
    expect(readKaalaTokens('day').fontSans).toContain('Manrope');
  });

  it('gives night and day different canvas colours', () => {
    tokens();
    const night = kaalaStudioParams(readKaalaTokens('night'), 'night');
    const day = kaalaStudioParams(readKaalaTokens('day'), 'day');
    expect(night.studioCanvasBackgroundColor).toBe('#0a0a0b');
    expect(day.studioCanvasBackgroundColor).toBe('#f5f5f7');
    expect(night.browserColorScheme).toBe('dark');
    expect(day.browserColorScheme).toBe('light');
    expect(day.accentColor).toBe('#5a50c8');
    expect(day.chartTextColor).toBe('#4f4f57');
  });

  it('keeps violet to one palette slot and greys for the rest', () => {
    tokens();
    const p = kaalaStudioParams(readKaalaTokens('night'), 'night');
    const fills = Object.entries(p)
      .filter(([k]) => /^chartPaletteFills\d+Color$/.test(k))
      .map(([, v]) => v);
    expect(fills.filter((v) => v === '#8b83e6')).toHaveLength(1);
    expect(p.chartPaletteFills1Color).toBe('#a1a1a8');
  });

  it('builds a theme object per mode', () => {
    tokens();
    const night = kaalaStudioTheme('night');
    const day = kaalaStudioTheme('day');
    expect(night).toBeTruthy();
    expect(night).not.toBe(day);
  });
});
