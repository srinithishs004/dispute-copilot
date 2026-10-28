import { useEffect, useMemo, useRef, useState } from 'react';
import { AgStudio } from 'ag-studio-react';
import { AgStudioAiModule } from 'ag-studio';
import type { AgAiHarnessSetup, AgPanelConfig, AgStudioApi, AgStudioModule } from 'ag-studio';
import type { DashboardFeed } from '../lib/types';
import { toStudioData } from './dataSources';
import { initialReport, reportHeight, type LayoutVariant } from './layout';
import { applyStudioLicense } from './license';
import { useKaalaStudioTheme } from './studioTheme';
import { studioWidgets } from './widgets';
import { bumpFeedVersion } from './widgets/studioRows';

/**
 * The AG Studio report on /dashboard. Loaded lazily (Studio is about 5.8 MB) by pages/Dashboard.
 *
 * Studio runs in edit mode: its AI Assistant panel only exists in edit mode (Task 1 spike), and the
 * Dispute Analyst (Task 9) lives in that panel. The edit chrome is trimmed to the filters panel
 * (plus `ai` once Task 9 passes a harness); the Compose and Data panels stay hidden. Layout changes
 * are kept for the visit only.
 */

applyStudioLicense();

/** AgStudioAiModule is required for the AI panel (without it the `ai` prop is ignored). */
export const STUDIO_MODULES: AgStudioModule[] = [AgStudioAiModule];

/** Phones get no side panels: a 210px+ panel would cover the one-column canvas. */
export function studioPanels(withAi: boolean, variant: LayoutVariant = 'wide'): AgPanelConfig {
  if (variant === 'narrow') return { edit: {}, view: {} };
  return {
    edit: withAi ? { left: ['ai'], right: ['filters'] } : { right: ['filters'] },
    view: { right: ['filters'] },
  };
}

const NARROW_QUERY = '(max-width: 720px)';

function useLayoutVariant(): LayoutVariant {
  const get = (): LayoutVariant => (window.matchMedia?.(NARROW_QUERY).matches ? 'narrow' : 'wide');
  const [variant, setVariant] = useState<LayoutVariant>(get);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq?.addEventListener) return;
    const onChange = () => setVariant(get());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return variant;
}

export type StudioReportProps = {
  feed: DashboardFeed;
  /** Task 9: the Dispute Analyst harness (`ai` is read once, when Studio is created). */
  ai?: AgAiHarnessSetup;
  /** Called with the Studio API once it is ready (getState, refresh, executeQuery...). */
  onApiReady?: (api: AgStudioApi) => void;
};

export default function StudioReport({ feed, ai, onApiReady }: StudioReportProps) {
  const variant = useLayoutVariant();
  const { studio } = useKaalaStudioTheme();
  const theme = useMemo(
    // Studio's default minimum widths (600 / 720px) would overflow a phone.
    () => (variant === 'narrow' ? studio.withParams({ studioMinWidth: 300, studioCanvasMinWidth: 300 }) : studio),
    [studio, variant],
  );
  const data = useMemo(() => toStudioData(feed), [feed]);
  // Sized to the open disputes when Studio is created; later refreshes keep the layout.
  const openCount = feed.sources.disputes.filter((d) => d.amountKept === null).length;
  const openCountRef = useRef(openCount);
  const initialState = useMemo(() => initialReport(variant, openCountRef.current), [variant]);
  const panels = useMemo(() => studioPanels(Boolean(ai), variant), [ai, variant]);
  const ref = useRef<AgStudio>(null);

  // New rows reach the charts through `data`; custom widgets query again on this signal.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    bumpFeedVersion();
  }, [data]);

  return (
    <div className={`studio-host studio-host--${variant}`} data-testid="studio-host" style={{ height: reportHeight(initialState) }}>
      <AgStudio
        // Remount on a breakpoint change so the preset layout for that width applies.
        key={variant}
        ref={ref}
        style={{ height: '100%' }}
        mode="edit"
        modules={STUDIO_MODULES}
        theme={theme}
        data={data}
        initialState={initialState}
        panels={panels}
        widgets={studioWidgets}
        {...(ai ? { ai } : {})}
        onApiReady={(e) => onApiReady?.(e.api)}
      />
    </div>
  );
}
