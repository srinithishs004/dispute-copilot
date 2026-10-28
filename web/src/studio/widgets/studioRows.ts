import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AgWidgetField, AgWidgetParams } from 'ag-studio';

/**
 * Custom widgets read their rows through Studio (`widgetApi.getData`), not from the raw feed, so
 * page filters and cross filters apply to them like to the built-in charts. Every requested field
 * is unaggregated, so Studio groups by all of them; `disputeId` is unique, so that is one row per
 * dispute.
 */

export type PlainRow = Record<string, unknown>;

// Bumped by the dashboard after each refresh so custom widgets query again.
let version = 0;
const listeners = new Set<() => void>();
export function bumpFeedVersion(): void {
  version += 1;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const useFeedVersion = () => useSyncExternalStore(subscribe, () => version);

/** Finds `<tableId>.<id>` for each id in the report schema. */
export function pickFields(params: AgWidgetParams, tableId: string, ids: readonly string[]): AgWidgetField[] | null {
  const table = params.widgetApi.getSchema().find((t) => t.id === tableId);
  if (!table) return null;
  const out: AgWidgetField[] = [];
  for (const id of ids) {
    const f = table.fields.find((x) => x.fieldId === `${tableId}.${id}` || x.fieldId === id);
    if (!f) return null;
    out.push(f);
  }
  return out;
}

/** Rows keyed by plain field id ("disputeId"), or null while loading. */
export function useStudioRows(params: AgWidgetParams, tableId: string, ids: readonly string[]): { rows: PlainRow[] | null; failed: boolean } {
  const [state, setState] = useState<{ rows: PlainRow[] | null; failed: boolean }>({ rows: null, failed: false });
  const feedVersion = useFeedVersion();
  const { widgetApi } = params;
  const key = ids.join(',');

  useEffect(() => {
    let live = true;
    const fields = pickFields(params, tableId, ids);
    if (!fields) {
      setState({ rows: [], failed: true });
      widgetApi.setDisplayState('displayed');
      return;
    }
    widgetApi
      .getData({ fields })
      .then((r) => {
        if (!live) return;
        const rows = r.results.rows.map((row) => {
          const plain: PlainRow = {};
          fields.forEach((f, i) => {
            plain[ids[i]!] = row[f.key];
          });
          return plain;
        });
        setState({ rows, failed: false });
        widgetApi.setDisplayState('displayed');
      })
      .catch((err: unknown) => {
        if (!live || (err instanceof DOMException && err.name === 'AbortError')) return;
        setState({ rows: [], failed: true });
        widgetApi.setDisplayState('displayed');
      });
    return () => {
      live = false;
    };
    // `params` changes identity on every Studio render; the query depends only on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetApi, tableId, key, feedVersion]);

  return state;
}

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
