import { useEffect, useMemo, useState } from 'react';
import { studioTheme } from 'ag-studio';
import type { AgStudioTheme, AgStudioThemeParams } from 'ag-studio';
import type { Theme } from '../lib/theme';

/**
 * AG Studio theme built from Kaala tokens. Starts from the stock `studioTheme` (keeps its icon set
 * and input styling; `createStudioTheme()` loses the icons) and sets Kaala values with
 * `withParams`. Charts draw on canvas, where CSS variables do not resolve, so the token values are
 * read from computed styles.
 */

export type KaalaTokens = {
  canvas: string;
  surface1: string;
  surface2: string;
  surface3: string;
  line: string;
  lineStrong: string;
  lineControl: string;
  ink: string;
  ink2: string;
  ink3: string;
  secondary: string;
  secondaryInk: string;
  popover: string;
  fontSans: string;
  fontMono: string;
};

const TOKEN_VARS: Record<keyof KaalaTokens, string> = {
  canvas: '--canvas',
  surface1: '--surface-1',
  surface2: '--surface-2',
  surface3: '--surface-3',
  line: '--line',
  lineStrong: '--line-strong',
  lineControl: '--line-control',
  ink: '--ink',
  ink2: '--ink-2',
  ink3: '--ink-3',
  secondary: '--secondary',
  secondaryInk: '--secondary-ink',
  popover: '--popover',
  fontSans: '--font-sans',
  fontMono: '--font-mono',
};

/**
 * Token values for a theme. Reads them from a hidden probe element carrying `data-theme`, so the
 * values are right for the requested theme even while <html> is still switching.
 */
export function readKaalaTokens(theme: Theme): KaalaTokens {
  const probe = document.createElement('div');
  probe.setAttribute('data-theme', theme);
  probe.setAttribute('aria-hidden', 'true');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  try {
    const cs = getComputedStyle(probe);
    const out = {} as KaalaTokens;
    for (const [k, v] of Object.entries(TOKEN_VARS) as [keyof KaalaTokens, string][]) out[k] = cs.getPropertyValue(v).trim();
    return out;
  } finally {
    probe.remove();
  }
}

const PALETTE_SLOTS = 20;

export function kaalaStudioParams(t: KaalaTokens, theme: Theme): Partial<AgStudioThemeParams> {
  // Neutral first; violet is the single accent (slot 2), never repeated.
  const greys = [t.ink2, t.lineControl, t.ink3, t.lineStrong, t.surface3];
  const palette = [t.ink2, t.secondary, t.lineControl, t.ink3, t.lineStrong, t.surface3];
  const paletteParams: Record<string, string> = {};
  for (let i = 0; i < PALETTE_SLOTS; i += 1) {
    const c = palette[i] ?? greys[(i - palette.length) % greys.length]!;
    paletteParams[`chartPaletteFills${i + 1}Color`] = c;
    paletteParams[`chartPaletteStrokes${i + 1}Color`] = c;
  }
  const hairline = { style: 'solid', width: 1, color: t.line };

  return {
    browserColorScheme: theme === 'day' ? 'light' : 'dark',
    backgroundColor: t.surface1,
    foregroundColor: t.ink,
    textColor: t.ink,
    subtleTextColor: t.ink3,
    borderColor: t.line,
    accentColor: t.secondaryInk,
    iconColor: t.ink2,
    invalidColor: t.ink,
    fontFamily: t.fontSans,
    fontSize: 13,
    borderRadius: 6,
    rowHoverColor: t.surface2,
    menuBackgroundColor: t.popover,
    menuTextColor: t.ink,
    menuBorder: hairline,
    menuSeparatorColor: t.line,
    tooltipBackgroundColor: t.popover,
    tooltipTextColor: t.ink,
    tooltipBorder: hairline,

    studioWrapperBackgroundColor: t.canvas,
    studioWrapperBorder: false,
    studioWrapperBorderRadius: 0,
    studioCanvasBackgroundColor: t.canvas,
    studioCanvasBorder: false,
    studioCanvasShadow: false,
    studioCanvasGridLineColor: t.line,
    studioCanvasFontFamily: t.fontSans,
    studioPanelContainerBackgroundColor: t.surface1,
    studioPanelContainerBorder: hairline,
    studioPanelContainerBorderRadius: 16,
    studioPanelDividerColor: t.line,
    studioPanelDividerActiveColor: t.secondaryInk,
    studioPanelHeaderFontFamily: t.fontSans,
    studioPanelHeaderFontWeight: 600,
    studioPanelSectionBorderColor: t.line,
    studioPanelGroupBackgroundColor: t.surface1,
    studioPanelGroupTitleBarTextColor: t.ink2,
    studioPanelChevronButtonHoverBackgroundColor: t.surface2,
    studioPanelChevronButtonHoverColor: t.ink,
    studioFormLabelColor: t.ink2,
    studioFiltersPanelCardSubtleColor: t.ink3,
    studioAiPanelButtonHoverBackgroundColor: t.surface2,
    studioAiPanelInputMessageBackgroundColor: t.surface2,
    studioAiPanelRichTextAccentBackgroundColor: t.surface2,

    studioWidgetBackgroundColor: t.surface1,
    studioWidgetBorder: hairline,
    studioWidgetBorderRadius: 16,
    studioWidgetPadding: 16,
    studioWidgetTitleFontFamily: t.fontSans,
    studioWidgetTitleFontSize: 15,
    studioWidgetTitleFontWeight: 600,
    studioWidgetTitleTextColor: t.ink,
    studioWidgetSubtitleFontFamily: t.fontSans,
    studioWidgetSubtitleFontSize: 12,
    studioWidgetSubtitleTextColor: t.ink3,
    studioWidgetCaptionFontFamily: t.fontSans,
    studioWidgetCaptionFontSize: 12,
    studioWidgetCaptionTextColor: t.ink3,
    studioWidgetToolbarBackgroundColor: t.popover,
    studioWidgetToolbarBorder: hairline,
    studioWidgetToolbarButtonColor: t.ink2,
    studioWidgetToolbarButtonHoverBackgroundColor: t.surface2,
    studioWidgetResizeBorderColor: t.secondaryInk,
    studioWidgetLoadingOverlayBackgroundColor: t.surface1,
    studioWidgetNoDataOverlayBackgroundColor: t.surface1,
    studioToggleButtonActiveBackgroundColor: t.secondaryInk,
    studioToggleButtonActiveBorderColor: t.secondaryInk,
    studioToggleButtonActiveColor: t.secondaryInk,
    studioValueWidgetFontSize: 28,

    gridFontFamily: t.fontSans,
    gridCellFontFamily: t.fontSans,
    gridCellFontSize: 13,
    gridCellTextColor: t.ink,
    gridHeaderFontFamily: t.fontMono,
    gridHeaderFontSize: 11,
    gridHeaderFontWeight: 500,
    gridHeaderTextColor: t.ink3,
    gridHeaderBackgroundColor: t.surface1,
    gridHeaderRowBorder: { style: 'solid', width: 1, color: t.lineStrong },
    gridDataBackgroundColor: t.surface1,
    gridOddRowBackgroundColor: t.surface1,
    gridRowBorder: hairline,
    gridColumnBorder: false,
    gridRowHoverColor: t.surface2,
    gridWrapperBorder: false,
    gridRowHeight: 40,
    gridIconColor: t.ink3,
    gridAccentColor: t.secondaryInk,

    chartFontFamily: t.fontSans,
    chartFontSize: 12,
    chartTextColor: t.ink2,
    chartSubtleTextColor: t.ink3,
    chartAxisLineColor: t.lineStrong,
    chartGridLineColor: t.line,
    chartBorderColor: t.line,
    chartAccentColor: t.secondaryInk,
    chartTooltipBackgroundColor: t.popover,
    chartTooltipTextColor: t.ink,
    chartTooltipBorder: hairline,
    chartCrosshairLabelBackgroundColor: t.ink,
    chartCrosshairLabelTextColor: t.canvas,
    ...paletteParams,
  } as Partial<AgStudioThemeParams>;
}

/** The Studio theme for a Kaala theme, from the token values in effect now. */
export function kaalaStudioTheme(theme: Theme): AgStudioTheme {
  return studioTheme.withParams(kaalaStudioParams(readKaalaTokens(theme), theme) as AgStudioThemeParams);
}

const currentTheme = (): Theme => (document.documentElement.getAttribute('data-theme') === 'day' ? 'day' : 'night');

/** Follows `data-theme` on <html> (set by ThemeSwitch) and returns the matching Studio theme. */
export function useKaalaStudioTheme(): { theme: Theme; studio: AgStudioTheme } {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setTheme(currentTheme());
    return () => obs.disconnect();
  }, []);
  const studio = useMemo(() => kaalaStudioTheme(theme), [theme]);
  return { theme, studio };
}
