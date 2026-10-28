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

const WIDE: Record<string, Box> = {
  [WIDGET_IDS.actionNeeded]: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 21 },
  [WIDGET_IDS.moneyProtected]: { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 21 },
  [WIDGET_IDS.recommendations]: { xTrack: 0, yTrack: 21, xSpan: 7, ySpan: 20 },
  [WIDGET_IDS.outcomes]: { xTrack: 7, yTrack: 21, xSpan: 8, ySpan: 20 },
  [WIDGET_IDS.evidenceGaps]: { xTrack: 15, yTrack: 21, xSpan: 9, ySpan: 20 },
  [WIDGET_IDS.allDisputes]: { xTrack: 0, yTrack: 41, xSpan: 24, ySpan: 24 },
};

const NARROW_HEIGHTS: [string, number][] = [
  [WIDGET_IDS.actionNeeded, 32],
  [WIDGET_IDS.moneyProtected, 16],
  [WIDGET_IDS.recommendations, 18],
  [WIDGET_IDS.outcomes, 18],
  [WIDGET_IDS.evidenceGaps, 20],
  [WIDGET_IDS.allDisputes, 24],
];

function narrowLayout(): Record<string, Box> {
  let y = 0;
  const out: Record<string, Box> = {};
  for (const [id, h] of NARROW_HEIGHTS) {
    out[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan: h };
    y += h;
  }
  return out;
}

export function initialReport(variant: LayoutVariant = 'wide'): AgReportState {
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
        categoryKey: [{ id: 'evidence_gaps.requirement' }],
        valueKey: [{ id: 'evidence_gaps.disputeId', aggregation: 'count' }],
      },
      sort: [{ field: { id: 'evidence_gaps.disputeId', aggregation: 'count' }, direction: 'desc' }],
      format: { ...title('Evidence gaps', 'Most common missing evidence across disputes'), style: noLegend },
    },
    [WIDGET_IDS.allDisputes]: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'disputes.disputeId' },
          { id: 'disputes.reason' },
          { id: 'disputes.originalAmount' },
          { id: 'disputes.localState' },
          { id: 'disputes.daysLeft' },
          { id: 'disputes.recommendation' },
          { id: 'disputes.confidence' },
          { id: 'disputes.outcome' },
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
        widgetLayout: variant === 'wide' ? WIDE : narrowLayout(),
        layout: { pagePadding: 0 },
        filter,
      },
    ],
    selectedPageId: 'disputes',
    version: '3.0.0',
  } as unknown as AgReportState;
}
