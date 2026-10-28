import type { AgWidgetField, AgWidgetsConfig } from 'ag-studio';
import { ActionNeededWidget } from './ActionNeededWidget';
import { DisputeLinkCell } from './DisputeLinkCell';
import { MoneyProtectedWidget } from './MoneyProtectedWidget';

export const ACTION_NEEDED = 'actionNeeded';
export const MONEY_PROTECTED = 'moneyProtected';

/* eslint-disable @typescript-eslint/no-explicit-any -- custom widget ids are not in Studio's default registry type */
const customDefs = [
  {
    id: ACTION_NEEDED,
    label: 'Action needed',
    comp: ActionNeededWidget,
    form: (p: any) => p.createDefaults({}),
    defaultSize: { width: 560, height: 340 },
    minSize: { width: 280, height: 200 },
    ai: {
      label: 'Action needed',
      description: 'List of open disputes, soonest response deadline first, each with a countdown and an Open review link. Needs no data mapping.',
      usage: 'Use when the seller asks what needs attention or what is due. One per page is enough.',
    },
  },
  {
    id: MONEY_PROTECTED,
    label: 'Money protected',
    comp: MoneyProtectedWidget,
    form: (p: any) => p.createDefaults({}),
    defaultSize: { width: 400, height: 340 },
    minSize: { width: 240, height: 180 },
    ai: {
      label: 'Money protected',
      description: 'Totals over resolved disputes: amount the seller kept and amount refunded to buyers. Needs no data mapping.',
      usage: 'Use when the seller asks how much money was kept or refunded. One per page is enough.',
    },
  },
];

function createCellRenderer(field: AgWidgetField) {
  return field.fieldId === 'disputes.disputeId' ? DisputeLinkCell : undefined;
}

/**
 * For the `widgets` property: Studio's defaults, the grid with a link column, and our two custom
 * widgets in their own menu group (the Compose panel and the page agent both see them).
 */
export function studioWidgets(defaults: AgWidgetsConfig): AgWidgetsConfig {
  const widgets = (defaults.widgets as readonly any[]).map((w) =>
    w.id === 'grid' ? { ...w, options: { ...(w.options ?? {}), createCellRenderer } } : w,
  );
  return {
    ...defaults,
    widgets: [...widgets, ...customDefs] as any,
    menu: [{ label: 'Disputes', widgetIds: [ACTION_NEEDED, MONEY_PROTECTED] as any }, ...defaults.menu],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
