import * as vm from 'vm';
import * as fs from 'fs';
import { ExecutionStep, StepKind, Trace } from '../shared/types';
import { instrument } from './instrument';

const MAX_STEPS = 4000;
const MAX_MACROTASK_ITERATIONS = 2000;
const MICROTASK_FLUSH_ATTEMPTS = 20;

interface PendingCallback {
  id: number;
  seq: number;
  delay: number;
  label: string;
  scheduleStepId: number;
  callback: () => void;
  /**
   * Node mode's Poll phase only: resolves when a genuinely real op (currently `readFileReal`,
   * a real `fs.readFile` dispatched to the real libuv thread pool) actually completes. Absent
   * on every other queue, those stay honest, in-memory simulations with no real-world timing.
   */
  waitFor?: Promise<void>;
}

/**
 * Runs `sourceCode` in an isolated vm context and records every call-stack push/pop,
 * console output, and micro/macrotask scheduling event as an ordered ExecutionStep[].
 *
 * Design note: we let the vm context's OWN native Promise implementation do the real work —
 * it shares the process's real microtask queue, so ordering between chained/nested promises
 * is spec-correct "for free". We fake `setTimeout`/`process.nextTick`/`setImmediate`/
 * `simulateSystemCallback`/`createHandle` as in-memory queues this recorder fully controls,
 * since real timers/system callbacks would force us to actually wait out real delays (or fake
 * system errors) to record a trace. `readFileReal` is the one deliberate exception: it's a
 * genuinely real `fs.readFile`, dispatched to Node's real libuv thread pool, see the Poll phase
 * loop below.
 *
 * 'browser' mode is untouched from its original behavior. 'node' mode additionally exposes
 * `process.nextTick`, `setImmediate`, `readFileReal`, `simulateSystemCallback`, and
 * `createHandle`, and drives the recording through the real six libuv phases (timers, pending
 * callbacks, idle/prepare, poll, check, close callbacks) instead of a single macrotask queue.
 */
export async function recordTrace(
  sourceCode: string,
  fileName: string,
  mode: 'browser' | 'node' = 'browser',
): Promise<Trace> {
  const steps: ExecutionStep[] = [];
  let nextId = 0;
  let truncated = false;
  let errorMessage: string | undefined;

  function push(kind: StepKind, fields: Partial<ExecutionStep> = {}): number {
    if (steps.length >= MAX_STEPS) {
      truncated = true;
      return -1;
    }
    const id = nextId++;
    steps.push({ id, kind, label: '', ...fields });
    return id;
  }

  let instrumented: string;
  try {
    instrumented = instrument(sourceCode);
  } catch (err: any) {
    return {
      fileName,
      sourceCode,
      steps: [],
      mode,
      error: `Could not parse this file as JavaScript: ${err.message}`,
    };
  }

  const pendingTimers: PendingCallback[] = [];
  let timerSeq = 0;
  let timerIdCounter = 1;

  const pendingNextTicks: PendingCallback[] = [];
  const pendingImmediates: PendingCallback[] = [];
  const pendingIO: PendingCallback[] = [];
  const pendingSystemCallbacks: PendingCallback[] = [];
  const pendingCloseCallbacks: PendingCallback[] = [];
  let nodeApiSeq = 0;

  const traceApi = {
    enter(label: string, line: number) {
      push('push-stack', { label, line });
    },
    exit(label: string) {
      push('pop-stack', { label });
    },
    line(n: number) {
      push('line', { line: n, label: `line ${n}` });
    },
    heapSet(name: string, value: unknown) {
      push('heap-set', { label: name, detail: formatValue(value) });
    },
    // Stamps a callback with the ORIGINAL (pre-instrumentation) source text of the function
    // literal `instrument.ts` found it wrapping, since by the time a scheduling function like
    // process.nextTick actually receives this callback, `fn.toString()` would otherwise return
    // the rewritten body full of __trace.enter/try/finally scaffolding — exactly the kind of
    // internal noise this tool shouldn't surface. Only inline function-literal arguments to a
    // known scheduling call get tagged (see instrument.ts); a callback passed by reference falls
    // back to its name in describeCallback below.
    tag(fn: unknown, src: string) {
      if (typeof fn === 'function') {
        (fn as { __srcPreview?: string }).__srcPreview = src;
      }
      return fn;
    },
  };

  function consoleMethod(methodLabel: string) {
    return (...args: unknown[]) => {
      // console.log is a real function call — it belongs on the Call Stack too, even
      // though it's native rather than user-defined code our instrumentation can wrap.
      push('push-stack', { label: methodLabel });
      push('console-log', { label: methodLabel, detail: args.map(formatValue).join(' ') });
      push('pop-stack', { label: methodLabel });
    };
  }

  function fakeSetTimeout(callback: (...a: unknown[]) => void, delay = 0, ...extraArgs: unknown[]) {
    const id = timerIdCounter++;
    const seq = timerSeq++;
    const label = `setTimeout (${delay}ms)`;
    // setTimeout(...) itself is a real, synchronous call — it belongs on the Call Stack too,
    // just like console.log. Only the *callback* it registers goes into the timer queue; it
    // doesn't run until its own turn.
    push('push-stack', { label });
    const scheduleStepId = push('schedule-timer', { label, detail: describeCallback(callback) });
    pendingTimers.push({
      id,
      seq,
      delay,
      label,
      scheduleStepId,
      callback: () => callback(...extraArgs),
    });
    push('pop-stack', { label });
    return id;
  }

  function fakeClearTimeout(id: unknown) {
    const idx = pendingTimers.findIndex((t) => t.id === id);
    if (idx >= 0) {
      pendingTimers.splice(idx, 1);
    }
  }

  function fakeNextTick(callback: (...a: unknown[]) => void, ...extraArgs: unknown[]) {
    const id = nodeApiSeq++;
    const label = 'process.nextTick(...)';
    push('push-stack', { label });
    const scheduleStepId = push('schedule-nexttick', { label, detail: describeCallback(callback) });
    pendingNextTicks.push({ id, seq: id, delay: 0, label, scheduleStepId, callback: () => callback(...extraArgs) });
    push('pop-stack', { label });
  }

  function fakeSetImmediate(callback: (...a: unknown[]) => void, ...extraArgs: unknown[]) {
    const id = nodeApiSeq++;
    const label = 'setImmediate(...)';
    push('push-stack', { label });
    const scheduleStepId = push('schedule-immediate', { label, detail: describeCallback(callback) });
    pendingImmediates.push({ id, seq: id, delay: 0, label, scheduleStepId, callback: () => callback(...extraArgs) });
    push('pop-stack', { label });
    return id;
  }

  // Genuinely real, not simulated: dispatches an actual fs.readFile of the file being
  // visualized to Node's real libuv thread pool. Its callback fires in the Poll phase only once
  // the real op actually completes — see the Promise.race in the Poll phase loop below, which
  // is what lets multiple real ops complete in whatever order they genuinely finish in, rather
  // than an order this recorder imposes.
  function fakeReadFileReal(label: string, callback?: (...a: unknown[]) => void) {
    const id = nodeApiSeq++;
    const stepLabel = `readFileReal(${JSON.stringify(label)})`;
    push('push-stack', { label: stepLabel });
    const scheduleStepId = push('schedule-io', {
      label: stepLabel,
      detail: describeCallback(callback) ?? 'real libuv thread pool',
    });
    const waitFor = new Promise<void>((resolve) => {
      fs.readFile(fileName || __filename, () => resolve());
    });
    pendingIO.push({ id, seq: id, delay: 0, label: stepLabel, scheduleStepId, callback: () => callback?.(), waitFor });
    push('pop-stack', { label: stepLabel });
  }

  // Models the category of deferred system-level callbacks (e.g. a TCP ECONNREFUSED) that the
  // real Pending Callbacks phase exists for.
  function fakeSimulateSystemCallback(label: string, delay = 0, callback?: (...a: unknown[]) => void) {
    const id = nodeApiSeq++;
    const stepLabel = `simulateSystemCallback(${JSON.stringify(label)})`;
    push('push-stack', { label: stepLabel });
    const scheduleStepId = push('schedule-syscallback', { label: stepLabel, detail: describeCallback(callback) });
    pendingSystemCallbacks.push({ id, seq: id, delay, label: stepLabel, scheduleStepId, callback: () => callback?.() });
    push('pop-stack', { label: stepLabel });
  }

  function fakeCreateHandle(label: string) {
    const handleLabel = `handle(${JSON.stringify(label)})`;
    return {
      close(callback?: (...a: unknown[]) => void) {
        const id = nodeApiSeq++;
        const stepLabel = `${handleLabel}.close()`;
        push('push-stack', { label: stepLabel });
        const scheduleStepId = push('schedule-close', { label: stepLabel, detail: describeCallback(callback) });
        pendingCloseCallbacks.push({ id, seq: id, delay: 0, label: stepLabel, scheduleStepId, callback: () => callback?.() });
        push('pop-stack', { label: stepLabel });
      },
    };
  }

  function wrapMicrotaskCallback(callback: unknown, label: string) {
    if (typeof callback !== 'function') {
      return callback;
    }
    const scheduleStepId = push('schedule-microtask', { label, detail: describeCallback(callback) });
    return (...args: unknown[]) => {
      push('run-microtask', { label, refId: scheduleStepId });
      // Synthetic wrapper frame, mirroring the timer driver below: explicitly carries
      // refId so the UI can animate "this queued token became this call-stack frame"
      // without having to infer the link from step adjacency.
      const handlerLabel = `${label} handler`;
      push('push-stack', { label: handlerLabel, refId: scheduleStepId });
      try {
        return callback(...args);
      } finally {
        push('pop-stack', { label: handlerLabel });
      }
    };
  }

  const sandbox: Record<string, unknown> = {
    __trace: traceApi,
    __wrapMicrotask: wrapMicrotaskCallback,
    console: {
      log: consoleMethod('console.log'),
      error: consoleMethod('console.error'),
      warn: consoleMethod('console.warn'),
      info: consoleMethod('console.log'),
    },
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  };

  if (mode === 'node') {
    sandbox.process = { nextTick: fakeNextTick };
    sandbox.setImmediate = fakeSetImmediate;
    sandbox.readFileReal = fakeReadFileReal;
    sandbox.simulateSystemCallback = fakeSimulateSystemCallback;
    sandbox.createHandle = fakeCreateHandle;
  }

  const context = vm.createContext(sandbox);

  // Patch this CONTEXT's own Promise.prototype.then (a separate realm's Promise class —
  // this never touches the extension host's real global Promise) and define queueMicrotask
  // in terms of it, so ordering between .then() chains and queueMicrotask stays spec-correct.
  vm.runInContext(
    `(function () {
      var originalThen = Promise.prototype.then;
      Promise.prototype.then = function (onFulfilled, onRejected) {
        __trace.enter('Promise.then(...)');
        try {
          return originalThen.call(
            this,
            __wrapMicrotask(onFulfilled, 'Promise.then'),
            __wrapMicrotask(onRejected, 'Promise.catch')
          );
        } finally {
          __trace.exit('Promise.then(...)');
        }
      };
      globalThis.queueMicrotask = function (cb) {
        __trace.enter('queueMicrotask(...)');
        try {
          return originalThen.call(Promise.resolve(), __wrapMicrotask(cb, 'queueMicrotask'));
        } finally {
          __trace.exit('queueMicrotask(...)');
        }
      };
    })();`,
    context,
    { filename: 'eventloop-studio://sandbox-setup.js' },
  );

  push('push-stack', { label: 'global()', line: 1 });
  try {
    vm.runInContext(instrumented, context, {
      filename: fileName || 'eventloop-studio://source.js',
    });
  } catch (err: any) {
    errorMessage = explainRuntimeError(err, mode);
    push('console-log', { label: 'console.error', detail: errorMessage });
  }
  push('pop-stack', { label: 'global()' });

  if (mode === 'browser') {
    await flushMicrotasks();

    let macrotaskIterations = 0;
    while (pendingTimers.length > 0 && macrotaskIterations < MAX_MACROTASK_ITERATIONS) {
      macrotaskIterations++;
      if (steps.length >= MAX_STEPS) {
        truncated = true;
        break;
      }

      pendingTimers.sort((a, b) => a.delay - b.delay || a.seq - b.seq);
      const timer = pendingTimers.shift()!;

      // Discrete, one-time transition: Web APIs -> Macrotask Queue. Emitted as its own step
      // (distinct from 'run-timer' below) so the UI can show this timer sitting in the queue,
      // waiting for the call stack to empty, rather than inferring queue membership from
      // whatever else happens to be on the stack at any given instant.
      push('timer-ready', { label: timer.label, refId: timer.scheduleStepId });
      push('run-timer', { label: timer.label, refId: timer.scheduleStepId });
      push('push-stack', { label: `${timer.label} handler`, refId: timer.scheduleStepId });
      try {
        timer.callback();
      } catch (err: any) {
        push('console-log', { label: 'console.error', detail: `Uncaught: ${err?.message ?? String(err)}` });
      }
      push('pop-stack', { label: `${timer.label} handler` });

      await flushMicrotasks();
    }
    if (macrotaskIterations >= MAX_MACROTASK_ITERATIONS) {
      truncated = true;
    }
  } else {
    await drainMicroQueues();

    let phaseIterations = 0;
    while (
      (pendingTimers.length > 0 ||
        pendingSystemCallbacks.length > 0 ||
        pendingIO.length > 0 ||
        pendingImmediates.length > 0 ||
        pendingCloseCallbacks.length > 0) &&
      phaseIterations < MAX_MACROTASK_ITERATIONS
    ) {
      phaseIterations++;
      if (steps.length >= MAX_STEPS) {
        truncated = true;
        break;
      }

      push('enter-phase', { label: 'Timers', detail: 'timers' });
      for (const timer of takeAllSorted(pendingTimers)) {
        await runPhaseCallback(timer, 'timer-ready', 'run-timer');
      }

      push('enter-phase', { label: 'Pending Callbacks', detail: 'pending-callbacks' });
      for (const cb of takeAllSorted(pendingSystemCallbacks)) {
        await runPhaseCallback(cb, null, 'run-syscallback');
      }

      // Idle, Prepare: always empty. No fake API ever feeds this queue, matching real Node,
      // which gives userland code no hook into this phase either.
      push('enter-phase', { label: 'Idle, Prepare', detail: 'idle-prepare' });

      push('enter-phase', { label: 'Poll', detail: 'poll' });
      // Real completions, not simulated: whichever readFileReal call actually finishes first
      // (real libuv thread pool) is recorded first, never an order this recorder decides.
      let ioBatch = pendingIO.splice(0);
      while (ioBatch.length > 0) {
        const winner = await Promise.race(ioBatch.map((io) => (io.waitFor ?? Promise.resolve()).then(() => io)));
        ioBatch = ioBatch.filter((io) => io !== winner);
        await runPhaseCallback(winner, null, 'run-io');
      }

      push('enter-phase', { label: 'Check', detail: 'check' });
      // Unlike every other phase, Check does NOT snapshot-and-defer: a setImmediate scheduled
      // from inside another setImmediate callback runs in this SAME pass, not the next loop
      // iteration. Re-checking the live queue after every callback (instead of iterating a
      // one-time snapshot) is what real Node's own immediate-queue draining actually does.
      while (pendingImmediates.length > 0) {
        const immediate = pendingImmediates.shift()!;
        await runPhaseCallback(immediate, null, 'run-immediate');
      }

      push('enter-phase', { label: 'Close Callbacks', detail: 'close-callbacks' });
      for (const close of pendingCloseCallbacks.splice(0)) {
        await runPhaseCallback(close, null, 'run-close');
      }
    }
    if (phaseIterations >= MAX_MACROTASK_ITERATIONS) {
      truncated = true;
    }
  }

  async function flushMicrotasks() {
    for (let i = 0; i < MICROTASK_FLUSH_ATTEMPTS; i++) {
      const before = steps.length;
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (steps.length === before) {
        return;
      }
    }
  }

  // Node mode only: process.nextTick always drains to exhaustion before microtasks, and is
  // re-checked after every microtask flush, since a microtask can itself schedule a nextTick.
  async function drainMicroQueues() {
    let sawActivity = true;
    while (sawActivity) {
      sawActivity = false;
      while (pendingNextTicks.length > 0) {
        const nextTick = pendingNextTicks.shift()!;
        await runPhaseCallback(nextTick, null, 'run-nexttick', { skipDrain: true });
        sawActivity = true;
      }
      const before = steps.length;
      await flushMicrotasks();
      if (steps.length > before) {
        sawActivity = true;
      }
    }
  }

  // Snapshots a queue (so anything scheduled *during* this phase waits for its next turn,
  // not the current pass) sorted by delay then insertion order.
  function takeAllSorted(queue: PendingCallback[]): PendingCallback[] {
    const batch = queue.splice(0);
    batch.sort((a, b) => a.delay - b.delay || a.seq - b.seq);
    return batch;
  }

  async function runPhaseCallback(
    item: PendingCallback,
    readyKind: StepKind | null,
    runKind: StepKind,
    opts: { skipDrain?: boolean } = {},
  ) {
    if (readyKind) {
      push(readyKind, { label: item.label, refId: item.scheduleStepId });
    }
    push(runKind, { label: item.label, refId: item.scheduleStepId });
    push('push-stack', { label: `${item.label} handler`, refId: item.scheduleStepId });
    try {
      item.callback();
    } catch (err: any) {
      push('console-log', { label: 'console.error', detail: `Uncaught: ${err?.message ?? String(err)}` });
    }
    push('pop-stack', { label: `${item.label} handler` });
    if (!opts.skipDrain) {
      await drainMicroQueues();
    }
  }

  return {
    fileName,
    sourceCode,
    steps,
    mode,
    truncated: truncated || undefined,
    error: errorMessage,
  };
}

/** setImmediate is intentionally 'browser'-mode only elsewhere in this file, listed here too so a script that only uses it (no process.nextTick) still gets the same actionable hint. */
const NODE_ONLY_GLOBALS = ['process', 'setImmediate'];

/**
 * Turns a bare "X is not defined" into something a script author can actually act on, instead
 * of a generic runtime error. Two specific, common cases:
 *  - A Node-only global used while in 'browser' mode: real browsers don't have it either, so
 *    the fix is switching modes, not a bug in the sandbox.
 *  - `require`: never exposed in either mode, on purpose — real module loading would hand a
 *    script full filesystem/network access, well beyond what a visualization tool should grant
 *    by default. Points at the safe, curated equivalents this tool already provides instead.
 */
function explainRuntimeError(err: any, mode: 'browser' | 'node'): string {
  const message = err?.message ?? String(err);
  const match = /^(\w+) is not defined$/.exec(message);
  if (match) {
    const name = match[1];
    if (name === 'require') {
      return (
        `Runtime error: ${message} — this sandbox never exposes require or Node's module system, ` +
        `in either mode, real module loading would give a script full filesystem/network access. ` +
        `Use the built-in readFileReal(), simulateSystemCallback(), or createHandle() instead, ` +
        `they cover the same real phases safely.`
      );
    }
    if (mode === 'browser' && NODE_ONLY_GLOBALS.includes(name)) {
      return `Runtime error: ${message} — this script uses a Node.js-specific API. Switch to Node.js mode (top-right toggle) and try again.`;
    }
  }
  return `Runtime error: ${message}`;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'function') {
    return `[Function: ${(value as Function).name || 'anonymous'}]`;
  }
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Identifies which callback a schedule-* step is queuing, for display in the queue panels —
 * without this, every pending `process.nextTick`/`setTimeout`/etc. entry shows the same generic
 * API name and is indistinguishable from any other pending call to the same API. Whitespace is
 * collapsed so a multi-line callback body still reads as one line; the full (untruncated) string
 * is kept here, visual truncation is a UI concern (see QueueList's `truncate` + `title`).
 */
function describeCallback(fn: unknown): string | undefined {
  if (typeof fn !== 'function') {
    return undefined;
  }
  const tagged = (fn as { __srcPreview?: string }).__srcPreview;
  if (typeof tagged === 'string') {
    return tagged;
  }
  if ((fn as Function).name) {
    return `${(fn as Function).name}()`;
  }
  return (fn as Function).toString().replace(/\s+/g, ' ').trim();
}
