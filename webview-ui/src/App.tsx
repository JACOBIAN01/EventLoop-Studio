import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGroup } from 'framer-motion';
import type { ExecutionStep, NodePhase, Trace } from '../../src/shared/types';
import { usePlayback } from './state/usePlayback';
import { explainStep } from './lib/captions';
import { SourceCode } from './components/SourceCode';
import { CallStack } from './components/CallStack';
import { Heap } from './components/Heap';
import { QueueList } from './components/QueueList';
import { EventLoop, LoopStatus, STATUS_COPY, STATUS_COLOR } from './components/EventLoop';
import { NodePhaseTrack } from './components/NodePhaseTrack';
import { ConsolePanel } from './components/ConsolePanel';
import { Controls } from './components/Controls';
import { Panel } from './components/Panel';
import { CaptionBar } from './components/CaptionBar';
import { InfoDot } from './components/InfoDot';
import { VSep, HSep } from './components/Separators';
import { Group, Panel as ResizablePanel } from 'react-resizable-panels';
import { usePanelSizes } from './state/usePanelSizes';

export type EventLoopMode = 'browser' | 'node';
export type Theme = 'light' | 'dark';

/** The subset of the VS Code webview API we need: persisting a preference and messaging the host. */
export interface WebviewStateApi {
  getState: () => any;
  setState: (state: any) => void;
  postMessage?: (message: any) => void;
}

export interface PendingItem {
  id: number;
  label: string;
  detail?: string;
}

export interface StackFrame {
  /** Stable across renders: the id of the 'push-stack' step that created this frame. */
  id: number;
  label: string;
  /**
   * The untruncated version of `label`, when the two differ (an inline callback whose own code
   * got capped for display, see instrument.ts's getFunctionLabel), shown in a hover tooltip so
   * the full code is never actually lost, just visually capped.
   */
  detail?: string;
  /**
   * When this frame is a scheduled callback (a timer/microtask callback the event loop just
   * dispatched), the id of the 'schedule-timer'/'schedule-microtask' step for the queue token it
   * came from. Use this as a shared animation key (e.g. Framer Motion's layoutId) so the queue
   * token visually morphs directly into this frame.
   */
  tokenRefId?: number;
}

export interface DerivedState {
  callStack: StackFrame[];
  heap: Record<string, string>;
  /** Timers scheduled but not yet run, currently considered "still waiting" (Web APIs / Pending Timers view). */
  webApiTimers: PendingItem[];
  /** Same underlying pending timers, once ready: browser mode's Macrotask Queue, node mode's Timers phase. */
  macrotaskQueueTimers: PendingItem[];
  pendingMicrotasks: PendingItem[];
  /** Node mode only: always empty in a browser-mode trace, since nothing can schedule into it. */
  pendingNextTicks: PendingItem[];
  pendingImmediates: PendingItem[];
  pendingIO: PendingItem[];
  pendingSystemCallbacks: PendingItem[];
  pendingCloseCallbacks: PendingItem[];
  consoleOutput: string[];
  currentLine: number | null;
  loopStatus: LoopStatus;
  /** Node mode only: which of the six libuv phases the loop is currently in, driven directly by 'enter-phase' steps. */
  currentPhase: NodePhase | null;
  /**
   * The id of the most recent 'run-nexttick'/'run-microtask' step at or before the current index,
   * or null if neither has run yet. Changes every single drain, not once per phase, used as a
   * re-triggering key so the Microtask Hub can flash once per real callback, matching how often
   * nextTick/microtasks actually drain, not once per phase transition.
   */
  lastDrainStepId: number | null;
}

const EMPTY_STATE: DerivedState = {
  callStack: [],
  heap: {},
  webApiTimers: [],
  macrotaskQueueTimers: [],
  pendingMicrotasks: [],
  pendingNextTicks: [],
  pendingImmediates: [],
  pendingIO: [],
  pendingSystemCallbacks: [],
  pendingCloseCallbacks: [],
  consoleOutput: [],
  currentLine: null,
  loopStatus: 'idle',
  currentPhase: null,
  lastDrainStepId: null,
};

/**
 * Removes the pending item this 'run-*' step corresponds to. `refId` (when present) points at
 * the exact 'schedule-*' step's id: two pending timers/microtasks can share an identical label
 * (e.g. two `setTimeout(fn, 0)` calls), so refId is the only reliable way to pair them; label
 * matching is a fallback only for traces that predate this field.
 */
function removeScheduledItem<T extends PendingItem>(items: T[], step: ExecutionStep): T[] {
  if (step.refId !== undefined) {
    const idx = items.findIndex((item) => item.id === step.refId);
    if (idx !== -1) {
      return [...items.slice(0, idx), ...items.slice(idx + 1)];
    }
  }
  const idx = items.findIndex((item) => item.label === step.label);
  if (idx === -1) {
    return items.slice(1);
  }
  return [...items.slice(0, idx), ...items.slice(idx + 1)];
}

/**
 * Pure fold over `steps[0..index]` that derives every panel's data from scratch.
 * Recomputing from zero each time (rather than incrementally patching state)
 * keeps this trivially correct when scrubbing/seeking around the timeline.
 */
export function computeStateAtStep(steps: ExecutionStep[], index: number): DerivedState {
  // Defensive clamp: a stale index from a previous (often longer) trace should never reach the
  // fold loop below out of bounds, that's what previously crashed the whole render tree when
  // switching to a shorter trace mid-scrub. usePlayback already clamps at the source; this is
  // the second, independent guard at the boundary this function actually depends on.
  const safeIndex = Math.min(index, steps.length - 1);
  if (safeIndex < 0) {
    return EMPTY_STATE;
  }
  index = safeIndex;

  const callStack: StackFrame[] = [];
  const heap: Record<string, string> = {};
  // Each timer's queue membership (Web APIs vs Macrotask Queue) is tracked explicitly per item,
  // driven only by its own 'schedule-timer'/'timer-ready' steps, never inferred from whatever
  // else happens to be on the call stack at a given instant. That's what previously caused a
  // timer to flicker back to Web APIs whenever an unrelated callback was executing: membership
  // was a single global flag recomputed from transient call-stack emptiness, not a per-timer fact.
  let pendingTimers: (PendingItem & { location: 'webapi' | 'macrotask' })[] = [];
  let pendingMicrotasks: PendingItem[] = [];
  let pendingNextTicks: PendingItem[] = [];
  let pendingImmediates: PendingItem[] = [];
  let pendingIO: PendingItem[] = [];
  let pendingSystemCallbacks: PendingItem[] = [];
  let pendingCloseCallbacks: PendingItem[] = [];
  const consoleOutput: string[] = [];
  let currentLine: number | null = null;
  let currentPhase: NodePhase | null = null;
  let lastDrainStepId: number | null = null;

  // Execution-context stack for inferring loop status: the top entry tells us
  // whether we're currently running the main script, a microtask callback, or
  // a timer callback. `enterDepth` is the call-stack depth at which that
  // context was entered, so returning to that depth pops back out of it.
  type ContextKind = 'script' | 'microtask' | 'timer';
  const contextStack: { kind: ContextKind; enterDepth: number }[] = [{ kind: 'script', enterDepth: 0 }];

  // Once the first run-microtask/run-timer fires, the top-level synchronous
  // script is guaranteed (by JS run-to-completion semantics) to have finished.
  // Before that point, an empty call stack just means "between statements",
  // not "ready for the event loop", so timers stay in Web APIs until then.
  let eventLoopPhase = false;

  for (let i = 0; i <= index; i++) {
    const step = steps[i];
    if (step.line !== undefined) {
      currentLine = step.line;
    }

    switch (step.kind) {
      case 'push-stack':
        callStack.push({ id: step.id, label: step.label, detail: step.detail, tokenRefId: step.refId });
        break;

      case 'pop-stack':
        // Not always the top: an async function's frame can still be "open" after
        // whatever called it has already closed (our instrumentation marks function-body
        // boundaries, not real per-`await` suspension points), so pop the most recent
        // frame that actually matches this label rather than blindly popping the top.
        for (let j = callStack.length - 1; j >= 0; j--) {
          if (callStack[j].label === step.label) {
            callStack.splice(j, 1);
            break;
          }
        }
        while (contextStack.length > 1 && callStack.length === contextStack[contextStack.length - 1].enterDepth) {
          contextStack.pop();
        }
        break;

      case 'console-log':
        consoleOutput.push(step.detail ?? step.label);
        break;

      case 'heap-set':
        heap[step.label] = step.detail ?? '';
        break;

      case 'schedule-timer':
        pendingTimers = [...pendingTimers, { id: step.id, label: step.label, detail: step.detail, location: 'webapi' }];
        break;

      case 'timer-ready': {
        const idx = pendingTimers.findIndex((t) => t.id === step.refId);
        if (idx !== -1) {
          pendingTimers = [
            ...pendingTimers.slice(0, idx),
            { ...pendingTimers[idx], location: 'macrotask' },
            ...pendingTimers.slice(idx + 1),
          ];
        }
        break;
      }

      case 'run-timer':
        pendingTimers = removeScheduledItem(pendingTimers, step);
        eventLoopPhase = true;
        contextStack.push({ kind: 'timer', enterDepth: callStack.length });
        break;

      case 'schedule-microtask':
        pendingMicrotasks = [...pendingMicrotasks, { id: step.id, label: step.label, detail: step.detail }];
        break;

      case 'run-microtask':
        pendingMicrotasks = removeScheduledItem(pendingMicrotasks, step);
        eventLoopPhase = true;
        contextStack.push({ kind: 'microtask', enterDepth: callStack.length });
        lastDrainStepId = step.id;
        break;

      case 'line':
        // line tracking already handled above
        break;

      case 'enter-phase':
        currentPhase = (step.detail as NodePhase | undefined) ?? currentPhase;
        break;

      case 'schedule-nexttick':
        pendingNextTicks = [...pendingNextTicks, { id: step.id, label: step.label, detail: step.detail }];
        break;
      case 'run-nexttick':
        pendingNextTicks = removeScheduledItem(pendingNextTicks, step);
        lastDrainStepId = step.id;
        break;

      case 'schedule-immediate':
        pendingImmediates = [...pendingImmediates, { id: step.id, label: step.label, detail: step.detail }];
        break;
      case 'run-immediate':
        pendingImmediates = removeScheduledItem(pendingImmediates, step);
        break;

      case 'schedule-io':
        pendingIO = [...pendingIO, { id: step.id, label: step.label, detail: step.detail }];
        break;
      case 'run-io':
        pendingIO = removeScheduledItem(pendingIO, step);
        break;

      case 'schedule-syscallback':
        pendingSystemCallbacks = [...pendingSystemCallbacks, { id: step.id, label: step.label, detail: step.detail }];
        break;
      case 'run-syscallback':
        pendingSystemCallbacks = removeScheduledItem(pendingSystemCallbacks, step);
        break;

      case 'schedule-close':
        pendingCloseCallbacks = [...pendingCloseCallbacks, { id: step.id, label: step.label, detail: step.detail }];
        break;
      case 'run-close':
        pendingCloseCallbacks = removeScheduledItem(pendingCloseCallbacks, step);
        break;
    }
  }

  const webApiTimers = pendingTimers.filter((t) => t.location === 'webapi');
  const macrotaskQueueTimers = pendingTimers.filter((t) => t.location === 'macrotask');

  const topContext = contextStack[contextStack.length - 1].kind;
  let loopStatus: LoopStatus;
  if (topContext === 'microtask') {
    loopStatus = 'microtasks';
  } else if (topContext === 'timer') {
    loopStatus = 'macrotask';
  } else if (callStack.length === 0) {
    // Back in the "script" context with nothing on the stack: either we're
    // between statements of the still-running top-level script (not yet in
    // the event-loop phase), or the engine is genuinely idle, momentarily
    // waiting to pick up the next queued micro/macrotask.
    loopStatus = eventLoopPhase ? 'idle' : 'script';
  } else {
    loopStatus = 'script';
  }

  return {
    callStack,
    heap,
    webApiTimers,
    macrotaskQueueTimers,
    pendingMicrotasks,
    pendingNextTicks,
    pendingImmediates,
    pendingIO,
    pendingSystemCallbacks,
    pendingCloseCallbacks,
    consoleOutput,
    currentLine,
    loopStatus,
    currentPhase,
    lastDrainStepId,
  };
}

export interface AppProps {
  trace: Trace | null;
  hostError?: string | null;
  /** Set when the last auto-save re-record failed to parse; the trace on screen is still the previous working one, not this failed save. */
  staleWarning?: string | null;
  /** Omitted in contexts with no persistence available (e.g. a bare browser preview). */
  vscodeApi?: WebviewStateApi;
}

export function App({ trace, hostError, staleWarning, vscodeApi }: AppProps) {
  const steps = trace?.steps ?? [];
  const playback = usePlayback(steps.length);

  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(() => vscodeApi?.getState()?.captionsEnabled ?? true);

  const toggleCaptions = () => {
    setCaptionsEnabled((prev) => {
      const next = !prev;
      vscodeApi?.setState({ ...(vscodeApi.getState() ?? {}), captionsEnabled: next });
      return next;
    });
  };

  const [theme, setTheme] = useState<Theme>(() => vscodeApi?.getState()?.theme ?? 'light');

  const setThemeAndPersist = (next: Theme) => {
    setTheme(next);
    vscodeApi?.setState({ ...(vscodeApi.getState() ?? {}), theme: next });
  };

  const { getLayout, registerGroupRef, onLayoutChanged, reset: resetLayout } = usePanelSizes(vscodeApi);

  // Derived from the trace itself, not tracked separately: the currently-displayed mode is
  // exactly whatever mode the current trace was actually recorded under, never a locally-guessed
  // value that could drift out of sync while a re-record is in flight.
  const activeMode: EventLoopMode = trace?.mode ?? 'browser';
  const setMode = (next: EventLoopMode) => {
    vscodeApi?.postMessage?.({ type: 'requestTrace', mode: next });
  };

  const derived = useMemo(
    () => computeStateAtStep(steps, playback.currentStepIndex),
    [steps, playback.currentStepIndex]
  );

  const currentCaption = useMemo(() => {
    const step = playback.currentStepIndex >= 0 ? steps[playback.currentStepIndex] : undefined;
    return step ? explainStep(step) : null;
  }, [steps, playback.currentStepIndex]);

  if (!trace) {
    return (
      <div
        data-theme={theme}
        className="relative flex h-screen w-screen flex-col items-center justify-center gap-3 bg-slate-50 text-slate-600"
      >
        {hostError && (
          <div className="absolute inset-x-0 top-0 border-b border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-700">
            {hostError}
          </div>
        )}
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-slate-200 border-t-indigo-500" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-700">Waiting for a trace&hellip;</p>
        <p className="text-xs text-slate-500">Run "Visualize Event Loop" on a JavaScript file to get started.</p>
      </div>
    );
  }

  return (
    <LayoutGroup>
      <div data-theme={theme} className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-700">
        <header className="flex flex-none items-center gap-3 border-b border-slate-200 bg-surface px-4 py-2.5">
          <span className="h-4 w-1 flex-none rounded-full bg-indigo-600" aria-hidden="true" />
          <span className="text-[13px] font-semibold tracking-tight text-heading">EventLoop Studio</span>
          <span className="h-3.5 w-px flex-none bg-slate-200" aria-hidden="true" />
          <span className="truncate font-mono text-xs text-slate-500">{trace.fileName}</span>
          {staleWarning && (
            <InfoDot
              variant="warning"
              label="Showing the last working version"
              text={`The last save didn't parse, so this is still showing the previous working version, not that save.\n\n${staleWarning}`}
            />
          )}

          <div className="ml-auto flex flex-none items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setMode('browser')}
              aria-pressed={activeMode === 'browser'}
              title="Model the browser's event loop: Web APIs, Microtask Queue, Macrotask Queue"
              className={`rounded-[5px] px-2 py-1 transition-colors ${
                activeMode === 'browser' ? 'bg-surface text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Browser
            </button>
            <button
              type="button"
              onClick={() => setMode('node')}
              aria-pressed={activeMode === 'node'}
              title="Model the real Node.js event loop: all six libuv phases, plus process.nextTick"
              className={`rounded-[5px] px-2 py-1 transition-colors ${
                activeMode === 'node' ? 'bg-surface text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Node.js
            </button>
          </div>

          <button
            type="button"
            onClick={() => setThemeAndPersist(theme === 'light' ? 'dark' : 'light')}
            aria-pressed={theme === 'dark'}
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            className="flex flex-none items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] transition-colors hover:bg-surface"
          >
            {theme === 'light' ? '☀' : '☾'}
          </button>

          <button
            type="button"
            onClick={resetLayout}
            title="Restore every panel to its default size"
            className="flex-none rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-surface hover:text-slate-700"
          >
            Reset Layout
          </button>

          {trace.truncated && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              trace truncated
            </span>
          )}
        </header>

        <CaptionBar caption={currentCaption} captionsEnabled={captionsEnabled} onToggle={toggleCaptions} />

        {(hostError || trace.error) && (
          <div className="flex-none border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {hostError ?? trace.error}
          </div>
        )}

        <Group
          orientation="horizontal"
          id="main"
          defaultLayout={getLayout('main')}
          onLayoutChanged={onLayoutChanged('main')}
          groupRef={registerGroupRef('main')}
          className="min-h-0 flex-1 p-3"
        >
          <ResizablePanel id="left" minSize={20}>
            <Group
              orientation="vertical"
              id="leftColumn"
              defaultLayout={getLayout('leftColumn')}
              onLayoutChanged={onLayoutChanged('leftColumn')}
              groupRef={registerGroupRef('leftColumn')}
              className="h-full"
            >
              <ResizablePanel id="source" minSize={15}>
                <Panel
                  title="Source"
                  accent="slate"
                  bodyClassName="overflow-hidden"
                  className="h-full"
                  badge={
                    // Auto-refresh only fires on save (see reRecordOnSave in extension.ts). This
                    // is the on-demand escape hatch for "I haven't saved yet, show me anyway."
                    // Reuses the exact same requestTrace message the mode toggle already sends,
                    // just with the mode unchanged, so it needs no new host-side plumbing.
                    <button
                      type="button"
                      onClick={() => setMode(activeMode)}
                      title="Re-run this file with its current, possibly-unsaved edits"
                      className="rounded-md border border-slate-200 bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Update
                    </button>
                  }
                >
                  <SourceCode sourceCode={trace.sourceCode} currentLine={derived.currentLine} />
                </Panel>
              </ResizablePanel>
              <HSep />
              <ResizablePanel id="console" minSize={15}>
                <Panel title="Console" accent="slate" bodyClassName="overflow-hidden" className="h-full">
                  <ConsolePanel lines={derived.consoleOutput} />
                </Panel>
              </ResizablePanel>
            </Group>
          </ResizablePanel>

          <VSep />

          <ResizablePanel id="right" minSize={20}>
            {activeMode === 'browser' ? (
              <Group
                orientation="vertical"
                id="browserRight"
                defaultLayout={getLayout('browserRight')}
                onLayoutChanged={onLayoutChanged('browserRight')}
                groupRef={registerGroupRef('browserRight')}
                className="h-full"
              >
                <ResizablePanel id="browserRow1" minSize={15}>
                  <Group
                    orientation="horizontal"
                    id="browserRow1"
                    defaultLayout={getLayout('browserRow1')}
                    onLayoutChanged={onLayoutChanged('browserRow1')}
                    groupRef={registerGroupRef('browserRow1')}
                    className="h-full"
                  >
                    <ResizablePanel id="callStack" minSize={15}>
                      <Panel
                        title="Call Stack"
                        accent="indigo"
                        bodyClassName="overflow-y-auto"
                        className="h-full"
                        description="Tracks the function that's currently running. JS runs one thing at a time, so calls stack on top of each other and pop off in reverse order."
                      >
                        <CallStack frames={derived.callStack} />
                      </Panel>
                    </ResizablePanel>
                    <VSep />
                    <ResizablePanel id="heap" minSize={15}>
                      <Panel
                        title="Heap"
                        accent="emerald"
                        bodyClassName="overflow-y-auto"
                        className="h-full"
                        description="Where objects, arrays, and functions actually live in memory. Variables just point to a value stored here, which can outlive the function that created it."
                      >
                        <Heap entries={derived.heap} />
                      </Panel>
                    </ResizablePanel>
                  </Group>
                </ResizablePanel>

                <HSep />

                <ResizablePanel id="browserRow2" minSize={15}>
                  <Group
                    orientation="horizontal"
                    id="browserRow2"
                    defaultLayout={getLayout('browserRow2')}
                    onLayoutChanged={onLayoutChanged('browserRow2')}
                    groupRef={registerGroupRef('browserRow2')}
                    className="h-full"
                  >
                    <ResizablePanel id="eventLoop" minSize={15}>
                      <Panel
                        title="Event Loop"
                        accent="slate"
                        className="h-full"
                        titleClassName={STATUS_COLOR[derived.loopStatus]}
                        description="Constantly checks whether the Call Stack is empty. If it is, all microtasks run first, then one macrotask is pulled in."
                        badge={
                          <span className={`text-[11px] font-semibold ${STATUS_COLOR[derived.loopStatus]}`}>
                            {STATUS_COPY[derived.loopStatus]}
                          </span>
                        }
                      >
                        <EventLoop status={derived.loopStatus} stackEmpty={derived.callStack.length === 0} />
                      </Panel>
                    </ResizablePanel>
                    <VSep />
                    <ResizablePanel id="webApis" minSize={15}>
                      <Panel
                        title="Web APIs"
                        accent="teal"
                        bodyClassName="overflow-y-auto"
                        className="h-full"
                        description="Browser or Node features, like setTimeout, that run outside the JS engine. That's why your code doesn't have to wait for them."
                      >
                        <QueueList
                          items={derived.webApiTimers}
                          emptyText="no pending timers"
                          color="teal"
                          direction="col"
                          initialOffset={{ x: -36, y: -22, rotate: -8 }}
                        />
                      </Panel>
                    </ResizablePanel>
                  </Group>
                </ResizablePanel>

                <HSep />

                <ResizablePanel id="browserRow3" minSize={15}>
                  <Group
                    orientation="horizontal"
                    id="browserRow3"
                    defaultLayout={getLayout('browserRow3')}
                    onLayoutChanged={onLayoutChanged('browserRow3')}
                    groupRef={registerGroupRef('browserRow3')}
                    className="h-full"
                  >
                    <ResizablePanel id="microtaskQueue" minSize={15}>
                      <Panel
                        title="Microtask Queue"
                        accent="amber"
                        bodyClassName="overflow-y-auto"
                        className="h-full"
                        description="Holds Promise and async/await callbacks. Always fully drained before the next macrotask runs, no matter how short that macrotask's delay is."
                      >
                        <QueueList
                          items={derived.pendingMicrotasks}
                          emptyText="no microtasks queued"
                          color="amber"
                          showNextBadge
                          initialOffset={{ y: -34, rotate: 6 }}
                        />
                      </Panel>
                    </ResizablePanel>
                    <VSep />
                    <ResizablePanel id="macrotaskQueue" minSize={15}>
                      <Panel
                        title="Macrotask Queue"
                        accent="violet"
                        bodyClassName="overflow-y-auto"
                        className="h-full"
                        description="Holds callbacks like expired timers. The event loop only pulls one once the Call Stack and Microtask Queue are both completely empty."
                      >
                        <QueueList
                          items={derived.macrotaskQueueTimers}
                          emptyText="no macrotasks ready"
                          color="violet"
                          showNextBadge
                          initialOffset={{ x: -34, y: -34, rotate: -6 }}
                        />
                      </Panel>
                    </ResizablePanel>
                  </Group>
                </ResizablePanel>
              </Group>
            ) : (
              <Group
                orientation="vertical"
                id="nodeRight"
                defaultLayout={getLayout('nodeRight')}
                onLayoutChanged={onLayoutChanged('nodeRight')}
                groupRef={registerGroupRef('nodeRight')}
                className="h-full"
              >
                <ResizablePanel id="nodeTopRow" minSize={10}>
                  <Group
                    orientation="horizontal"
                    id="nodeTopRow"
                    defaultLayout={getLayout('nodeTopRow')}
                    onLayoutChanged={onLayoutChanged('nodeTopRow')}
                    groupRef={registerGroupRef('nodeTopRow')}
                    className="h-full"
                  >
                    <ResizablePanel id="nodeCallStack" minSize={15}>
                      <Panel
                        title="Call Stack"
                        accent="indigo"
                        bodyClassName="overflow-y-auto"
                        className="h-full"
                        description="Tracks the function that's currently running. JS runs one thing at a time, so calls stack on top of each other and pop off in reverse order."
                      >
                        <CallStack frames={derived.callStack} />
                      </Panel>
                    </ResizablePanel>
                    <VSep />
                    <ResizablePanel id="nodeHeap" minSize={15}>
                      <Panel
                        title="Heap"
                        accent="emerald"
                        bodyClassName="overflow-y-auto"
                        className="h-full"
                        description="Where objects, arrays, and functions actually live in memory. Variables just point to a value stored here, which can outlive the function that created it."
                      >
                        <Heap entries={derived.heap} />
                      </Panel>
                    </ResizablePanel>
                  </Group>
                </ResizablePanel>

                <HSep />

                <ResizablePanel id="phaseTrack" minSize={20}>
                  <NodePhaseTrack
                    currentPhase={derived.currentPhase}
                    // Pending Timers isn't a separate panel anymore: it IS the ring's first
                    // phase position. Both "still waiting" and "ready to run" are the same
                    // underlying queue at different moments, so the chip shows the union of both
                    // instead of picking one.
                    timers={[...derived.webApiTimers, ...derived.macrotaskQueueTimers]}
                    pendingCallbacks={derived.pendingSystemCallbacks}
                    poll={derived.pendingIO}
                    check={derived.pendingImmediates}
                    closeCallbacks={derived.pendingCloseCallbacks}
                    pendingNextTicks={derived.pendingNextTicks}
                    pendingMicrotasks={derived.pendingMicrotasks}
                    lastDrainStepId={derived.lastDrainStepId}
                    getLayout={getLayout}
                    registerGroupRef={registerGroupRef}
                    onLayoutChanged={onLayoutChanged}
                  />
                </ResizablePanel>
              </Group>
            )}
          </ResizablePanel>
        </Group>

        <footer className="flex-none border-t border-slate-200 bg-surface px-4 py-2.5 shadow-[0_-1px_2px_rgba(0,0,0,0.03)]">
          <Controls playback={playback} stepCount={steps.length} steps={steps} />
        </footer>
      </div>
    </LayoutGroup>
  );
}
