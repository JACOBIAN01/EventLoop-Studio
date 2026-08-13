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

export type EventLoopMode = 'browser' | 'node';
export type Theme = 'light' | 'dark';

/** The subset of the VS Code webview API we need — persisting a preference and messaging the host. */
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
  /** Stable across renders — the id of the 'push-stack' step that created this frame. */
  id: number;
  label: string;
  /**
   * When this frame is a scheduled-callback handler (a timer/microtask "handler" frame),
   * the id of the 'schedule-timer'/'schedule-microtask' step for the token it came from —
   * same value as the PendingItem.id it replaced. Use this as a shared animation key
   * (e.g. Framer Motion's layoutId) so the queue token visually morphs into this frame.
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
  /** Node mode only — always empty in a browser-mode trace, since nothing can schedule into it. */
  pendingNextTicks: PendingItem[];
  pendingImmediates: PendingItem[];
  pendingIO: PendingItem[];
  pendingSystemCallbacks: PendingItem[];
  pendingCloseCallbacks: PendingItem[];
  consoleOutput: string[];
  currentLine: number | null;
  loopStatus: LoopStatus;
  /** Node mode only — which of the six libuv phases the loop is currently in, driven directly by 'enter-phase' steps. */
  currentPhase: NodePhase | null;
  /**
   * The id of the most recent 'run-nexttick'/'run-microtask' step at or before the current index,
   * or null if neither has run yet. Changes every single drain, not once per phase — used as a
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
 * the exact 'schedule-*' step's id — two pending timers/microtasks can share an identical label
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
  // driven only by its own 'schedule-timer'/'timer-ready' steps — never inferred from whatever
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
  // not "ready for the event loop" — so timers stay in Web APIs until then.
  let eventLoopPhase = false;

  for (let i = 0; i <= index; i++) {
    const step = steps[i];
    if (step.line !== undefined) {
      currentLine = step.line;
    }

    switch (step.kind) {
      case 'push-stack':
        callStack.push({ id: step.id, label: step.label, tokenRefId: step.refId });
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
  /** Omitted in contexts with no persistence available (e.g. a bare browser preview). */
  vscodeApi?: WebviewStateApi;
}

export function App({ trace, hostError, vscodeApi }: AppProps) {
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

  // Derived from the trace itself, not tracked separately — the currently-displayed mode is
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

          <div className="flex flex-none items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setThemeAndPersist('light')}
              aria-pressed={theme === 'light'}
              title="Light theme"
              className={`rounded-[5px] px-2 py-1 transition-colors ${
                theme === 'light' ? 'bg-surface text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => setThemeAndPersist('dark')}
              aria-pressed={theme === 'dark'}
              title="Dark theme"
              className={`rounded-[5px] px-2 py-1 transition-colors ${
                theme === 'dark' ? 'bg-surface text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Dark
            </button>
          </div>

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

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-[1.2fr_1fr] lg:overflow-hidden">
          <section className="grid min-h-0 grid-rows-[1.4fr_1fr] gap-3">
            <Panel title="Source" accent="slate" bodyClassName="overflow-hidden">
              <SourceCode sourceCode={trace.sourceCode} currentLine={derived.currentLine} />
            </Panel>
            <Panel title="Console" accent="slate" bodyClassName="overflow-hidden">
              <ConsolePanel lines={derived.consoleOutput} />
            </Panel>
          </section>

          {activeMode === 'browser' ? (
            <section className="grid h-full min-h-0 grid-cols-2 grid-rows-[1.3fr_1.1fr_1.1fr] gap-3">
              <Panel
                title="Call Stack"
                accent="indigo"
                bodyClassName="overflow-y-auto"
                description="Tracks the function that's currently running. JS runs one thing at a time, so calls stack on top of each other and pop off in reverse order."
              >
                <CallStack frames={derived.callStack} />
              </Panel>
              <Panel
                title="Heap"
                accent="emerald"
                bodyClassName="overflow-y-auto"
                description="Where objects, arrays, and functions actually live in memory. Variables just point to a value stored here, which can outlive the function that created it."
              >
                <Heap entries={derived.heap} />
              </Panel>
              <Panel
                title="Event Loop"
                accent="slate"
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
              <Panel
                title="Web APIs"
                accent="teal"
                bodyClassName="overflow-y-auto"
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
              <Panel
                title="Microtask Queue"
                accent="amber"
                bodyClassName="overflow-y-auto"
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
              <Panel
                title="Macrotask Queue"
                accent="violet"
                bodyClassName="overflow-y-auto"
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
            </section>
          ) : (
            <section className="flex h-full min-h-0 flex-col gap-3">
              <div className="grid h-32 flex-none grid-cols-2 gap-3">
                <Panel
                  title="Call Stack"
                  accent="indigo"
                  bodyClassName="overflow-y-auto"
                  description="Tracks the function that's currently running. JS runs one thing at a time, so calls stack on top of each other and pop off in reverse order."
                >
                  <CallStack frames={derived.callStack} />
                </Panel>
                <Panel
                  title="Heap"
                  accent="emerald"
                  bodyClassName="overflow-y-auto"
                  description="Where objects, arrays, and functions actually live in memory. Variables just point to a value stored here, which can outlive the function that created it."
                >
                  <Heap entries={derived.heap} />
                </Panel>
              </div>
              <div className="h-24 flex-none">
                <Panel
                  title="Pending Timers"
                  accent="teal"
                  bodyClassName="overflow-y-auto"
                  description="setTimeout/setInterval callbacks whose delay hasn't elapsed yet, waiting for the Timers phase below. nextTick and Microtask Queue moved into the Microtask Hub below, they're cross-cutting, not phases, so they sit inside the loop they drain between, not off to the side."
                >
                  <QueueList
                    items={derived.webApiTimers}
                    emptyText="no pending timers"
                    color="teal"
                    direction="col"
                    initialOffset={{ y: -24 }}
                  />
                </Panel>
              </div>
              <NodePhaseTrack
                currentPhase={derived.currentPhase}
                timers={derived.macrotaskQueueTimers}
                pendingCallbacks={derived.pendingSystemCallbacks}
                poll={derived.pendingIO}
                check={derived.pendingImmediates}
                closeCallbacks={derived.pendingCloseCallbacks}
                pendingNextTicks={derived.pendingNextTicks}
                pendingMicrotasks={derived.pendingMicrotasks}
                lastDrainStepId={derived.lastDrainStepId}
              />
            </section>
          )}
        </div>

        <footer className="flex-none border-t border-slate-200 bg-surface px-4 py-2.5 shadow-[0_-1px_2px_rgba(0,0,0,0.03)]">
          <Controls playback={playback} stepCount={steps.length} steps={steps} />
        </footer>
      </div>
    </LayoutGroup>
  );
}
