import { useRef, useState } from 'react';
import type { Layout, GroupImperativeHandle } from 'react-resizable-panels';
import type { WebviewStateApi } from '../App';

export type LayoutMap = Record<string, Layout>;

/**
 * Default proportions for every resizable group in App.tsx, keyed by group id, each a map of
 * that group's panel ids to percentages. This is the single source of truth both for a
 * panel's initial size (before the user has ever touched a handle) and for what "Reset
 * Layout" restores everything back to.
 *
 * Node mode's `nodeRight` percentages approximate today's fixed pixel heights (h-32/h-24/
 * remainder) as proportions of a typical panel height — inherently approximate, since converting
 * a fixed-px layout to percentage-of-container has no single "correct" answer.
 */
export const DEFAULT_LAYOUTS: LayoutMap = {
  main: { left: 54.5, right: 45.5 },
  leftColumn: { source: 58.3, console: 41.7 },
  browserRight: { browserRow1: 37.1, browserRow2: 31.4, browserRow3: 31.4 },
  browserRow1: { callStack: 50, heap: 50 },
  browserRow2: { eventLoop: 50, webApis: 50 },
  browserRow3: { microtaskQueue: 50, macrotaskQueue: 50 },
  nodeRight: { nodeTopRow: 20, pendingTimers: 15, phaseTrack: 65 },
  nodeTopRow: { nodeCallStack: 50, nodeHeap: 50 },
  microtaskHub: { nextTick: 50, promise: 50 },
};

/**
 * Persists every resizable Group's layout via the same vscodeApi.getState()/setState() pattern
 * already used for captionsEnabled and theme, rather than the library's own useDefaultLayout +
 * localStorage mechanism — keeps this app's state in one place, the extension's own webview
 * state, which is the more reliable persistence layer here than webview localStorage.
 */
export function usePanelSizes(vscodeApi: WebviewStateApi | undefined) {
  const [sizes, setSizes] = useState<LayoutMap>(() => ({
    ...DEFAULT_LAYOUTS,
    ...(vscodeApi?.getState()?.panelSizes ?? {}),
  }));
  const groupRefs = useRef<Record<string, GroupImperativeHandle | null>>({});

  const registerGroupRef = (groupId: string) => (handle: GroupImperativeHandle | null) => {
    groupRefs.current[groupId] = handle;
  };

  const onLayoutChanged = (groupId: string) => (layout: Layout) => {
    setSizes((prev) => {
      const next = { ...prev, [groupId]: layout };
      vscodeApi?.setState({ ...(vscodeApi.getState() ?? {}), panelSizes: next });
      return next;
    });
  };

  const getLayout = (groupId: string): Layout => sizes[groupId] ?? DEFAULT_LAYOUTS[groupId];

  const reset = () => {
    Object.entries(DEFAULT_LAYOUTS).forEach(([groupId, layout]) => {
      groupRefs.current[groupId]?.setLayout(layout);
    });
    setSizes(DEFAULT_LAYOUTS);
    vscodeApi?.setState({ ...(vscodeApi.getState() ?? {}), panelSizes: DEFAULT_LAYOUTS });
  };

  return { getLayout, registerGroupRef, onLayoutChanged, reset };
}
