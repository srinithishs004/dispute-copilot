import { describe, expect, it } from 'vitest';
import type { AgReportState } from 'ag-studio';
import { AI_HOST_VIEWPORT_OFFSET_PX, MIN_AI_HOST_PX, addedWidgetTop, hostHeight, initialReport, reportHeight } from './layout';

type Box = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
const withExtra = (state: AgReportState, boxes: Record<string, Box>): AgReportState => ({
  ...state,
  pages: [{ ...state.pages[0], widgetLayout: { ...state.pages[0].widgetLayout, ...boxes } }],
});
const bottomOf = (state: AgReportState) =>
  Math.max(...Object.values(state.pages[0].widgetLayout ?? {}).map((b) => (b ? b.yTrack + b.ySpan : 0)));

describe('hostHeight', () => {
  it('is the layout height without the Analyst, and grows when a widget is added below', () => {
    const start = initialReport('wide', 4);
    expect(hostHeight(start, false, 'wide')).toBe(reportHeight(start));
    const grown = withExtra(start, { extra: { xTrack: 0, yTrack: bottomOf(start), xSpan: 12, ySpan: 20 } });
    expect(hostHeight(grown, false, 'wide')).toBe(reportHeight(start) + 20 * 16);
  });

  it('with the Analyst on a wide screen, fits the viewport so the chat box is on screen, never under the floor', () => {
    const start = initialReport('wide', 4);
    expect(hostHeight(start, true, 'wide')).toBe(
      `max(${MIN_AI_HOST_PX}px, min(${reportHeight(start)}px, calc(100dvh - ${AI_HOST_VIEWPORT_OFFSET_PX}px)))`,
    );
  });

  it('phones keep the layout height (no side panels there)', () => {
    const start = initialReport('narrow', 4);
    expect(hostHeight(start, true, 'narrow')).toBe(reportHeight(start));
  });
});

describe('addedWidgetTop', () => {
  it('finds the pixel top of a newly added widget, the highest when several', () => {
    const start = initialReport('wide', 4);
    const y = bottomOf(start);
    const next = withExtra(start, {
      a: { xTrack: 0, yTrack: y + 20, xSpan: 12, ySpan: 20 },
      b: { xTrack: 12, yTrack: y, xSpan: 12, ySpan: 20 },
    });
    expect(addedWidgetTop(start, next)).toBe(y * 16);
  });

  it('is null when nothing was added (moves, resizes and removals)', () => {
    const start = initialReport('wide', 4);
    expect(addedWidgetTop(start, start)).toBeNull();
    const moved = withExtra(start, { 'all-disputes': { xTrack: 0, yTrack: 80, xSpan: 24, ySpan: 24 } });
    expect(addedWidgetTop(start, moved)).toBeNull();
  });
});
