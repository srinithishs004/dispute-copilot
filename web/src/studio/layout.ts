import type { AgReportState } from 'ag-studio';
import { ACTION_NEEDED, MONEY_PROTECTED } from './widgets';

/**
 * The preset report: spec §5 widgets 1 to 5 plus a grid of every dispute. Studio pages are 24
 * columns wide with 16px rows. Wide screens get two columns (Action needed and Money protected
 * first); phones get one column. Layout edits are not saved, so a reload starts from here.
 */

export type LayoutVariant = 'wide' | 'narrow';

export const WIDGET_IDS = {
  actionNeeded: 'action-needed',
  moneyProtected: 'money-protected',
  recommendations: 'recommendations',
  outcomes: 'outcomes-over-time',
  evidenceGaps: 'evidence-gaps',
  allDisputes: 'all-disputes',
} as const;

const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle ? { subtitle: { enabled: true, text: subtitle } } : {}),
});

const noLegend = { theme: { common: { legend: { enabled: false } } } };

type Box = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };

const ROW_PX = 16;
const rows = (px: number) => Math.ceil(px / ROW_PX);

/** Rows that fit the Action needed list: header plus one row per open dispute (up to 6, then it scrolls). */
export function actionNeededRows(openCount: number, variant: LayoutVariant): number {
  if (openCount <= 0) return rows(170);
  const itemPx = variant === 'wide' ? 63 : 94;
  return rows(84 + itemPx * Math.min(openCount, 6));
}

const MONEY_ROWS = rows(250);

function wideLayout(openCount: number): Record<string, Box> {
  const top = Math.max(actionNeededRows(openCount, 'wide'), MONEY_ROWS);
  return {
    [WIDGET_IDS.actionNeeded]: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: top },
    [WIDGET_IDS.moneyProtected]: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: top },
    [WIDGET_IDS.recommendations]: { xTrack: 0, yTrack: top, xSpan: 7, ySpan: 20 },
    [WIDGET_IDS.outcomes]: { xTrack: 7, yTrack: top, xSpan: 8, ySpan: 20 },
    [WIDGET_IDS.evidenceGaps]: { xTrack: 15, yTrack: top, xSpan: 9, ySpan: 20 },
    [WIDGET_IDS.allDisputes]: { xTrack: 0, yTrack: top + 20, xSpan: 24, ySpan: 24 },
  };
}

function narrowLayout(openCount: number): Record<string, Box> {
  const heights: [string, number][] = [
    [WIDGET_IDS.actionNeeded, actionNeededRows(openCount, 'narrow')],
    [WIDGET_IDS.moneyProtected, rows(256)],
    [WIDGET_IDS.recommendations, 18],
    [WIDGET_IDS.outcomes, 18],
    [WIDGET_IDS.evidenceGaps, 18],
    [WIDGET_IDS.allDisputes, 24],
  ];
  let y = 0;
  const out: Record<string, Box> = {};
  for (const [id, h] of heights) {
    out[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan: h };
    y += h;
  }
  return out;
}

/** Height in px the page needs to show every widget without an inner scroll. */
export function reportHeight(state: AgReportState): number {
  const layout = state.pages[0]?.widgetLayout ?? {};
  const bottom = Math.max(0, ...Object.values(layout).map((b) => (b ? b.yTrack + b.ySpan : 0)));
  return bottom * ROW_PX + 48;
}

/** Shortest Studio host with the Analyst chat beside the canvas, so the chat stays usable. */
export const MIN_AI_HOST_PX = 560;
/** Room above the host on a wide screen: top bar plus the dashboard heading. */
export const AI_HOST_VIEWPORT_OFFSET_PX = 200;

/**
 * CSS height of the Studio host.
 *
 * Without the Analyst it is the layout height, so the page scrolls and nothing scrolls inside Studio.
 * With the Analyst on a wide screen it is bound to the viewport (Studio's canvas scrolls inside), so
 * the chat header, prompt starters and message box are all on screen when the page opens; Studio's
 * chat panel is as tall as the host and keeps its message box at the bottom. It still follows the
 * layout, so a short report does not leave empty space.
 */
export function hostHeight(state: AgReportState, withAi: boolean, variant: LayoutVariant): number | string {
  const px = reportHeight(state);
  if (!withAi || variant !== 'wide') return px;
  return `max(${MIN_AI_HOST_PX}px, min(${px}px, calc(100dvh - ${AI_HOST_VIEWPORT_OFFSET_PX}px)))`;
}

/**
 * Pixel top of a widget that is in `next` but not in `prev` (the highest one when several), or null.
 * Used to bring a widget the Analyst just added into view inside Studio's scrolling canvas.
 */
export function addedWidgetTop(prev: AgReportState, next: AgReportState): number | null {
  const before = prev.pages[0]?.widgetLayout ?? {};
  const after = next.pages[0]?.widgetLayout ?? {};
  let top: number | null = null;
  for (const [id, box] of Object.entries(after)) {
    if (!box || id in before) continue;
    const y = box.yTrack * ROW_PX;
    top = top === null ? y : Math.min(top, y);
  }
  return top;
}

export function initialReport(variant: LayoutVariant = 'wide', openCount = 4): AgReportState {
  const widgets = {
    [WIDGET_IDS.actionNeeded]: {
      type: ACTION_NEEDED,
      dataMapping: {},
      format: title('Action needed', 'Open disputes, soonest deadline first'),
    },
    [WIDGET_IDS.moneyProtected]: {
      type: MONEY_PROTECTED,
      dataMapping: {},
      format: title('Money protected', 'Resolved disputes only'),
    },
    [WIDGET_IDS.recommendations]: {
      type: 'column-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'disputes.recommendation' }],
        valueKey: [{ id: 'disputes.disputeId', aggregation: 'count' }],
        tooltipKey: [{ id: 'disputes.confidence', aggregation: 'avg' }],
      },
      format: { ...title('Recommendations', 'Latest AI pick, hover for confidence'), style: noLegend },
    },
    [WIDGET_IDS.outcomes]: {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'disputes.createdAt::week' }],
        legendKey: [{ id: 'disputes.outcome' }],
        valueKey: [{ id: 'disputes.disputeId', aggregation: 'count' }],
      },
      format: {
        ...title('Outcomes over time', 'Resolved disputes by the week they opened'),
        style: { theme: { common: { legend: { enabled: true, position: 'bottom' } } } },
      },
    },
    [WIDGET_IDS.evidenceGaps]: {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'evidence_gaps.requirementShort' }],
        valueKey: [{ id: 'evidence_gaps.disputeId', aggregation: 'count' }],
        tooltipKey: [{ id: 'evidence_gaps.requirement' }],
      },
      sort: [{ field: { id: 'evidence_gaps.disputeId', aggregation: 'count' }, direction: 'desc' }],
      format: { ...title('Evidence gaps', 'Most common missing evidence across disputes'), style: noLegend },
    },
    [WIDGET_IDS.allDisputes]: {
      type: 'grid',
      dataMapping: {
        cols:
          variant === 'wide'
            ? [
                { id: 'disputes.disputeId' },
                { id: 'disputes.reason' },
                { id: 'disputes.originalAmount' },
                { id: 'disputes.localState' },
                { id: 'disputes.deadline' },
                { id: 'disputes.recommendation' },
                { id: 'disputes.confidence' },
                { id: 'disputes.outcome' },
              ]
            : [
                { id: 'disputes.disputeId' },
                { id: 'disputes.reason' },
                { id: 'disputes.originalAmount' },
                { id: 'disputes.localState' },
                { id: 'disputes.deadline' },
              ],
      },
      format: title('All disputes'),
    },
  };

  const filter = {
    widget: {
      [WIDGET_IDS.recommendations]: [{ field: { id: 'disputes.recommendation' }, model: { operator: 'isNotBlank' } }],
      [WIDGET_IDS.outcomes]: [{ field: { id: 'disputes.resolved' }, model: { operator: 'isTrue' } }],
    },
  };

  return {
    pages: [
      {
        id: 'disputes',
        widgets,
        widgetLayout: variant === 'wide' ? wideLayout(openCount) : narrowLayout(openCount),
        layout: { pagePadding: 0 },
        filter,
      },
    ],
    selectedPageId: 'disputes',
    version: '3.0.0',
  } as unknown as AgReportState;
}
