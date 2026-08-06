import * as vm from 'vm';
import { ExecutionStep, StepKind, Trace } from '../shared/types';
import { instrument } from './instrument';

const MAX_STEPS = 4000;
const MAX_MACROTASK_ITERATIONS = 2000;
const MICROTASK_FLUSH_ATTEMPTS = 20;

interface PendingTimer {
  id: number;
  seq: number;
  delay: number;
  label: string;
  scheduleStepId: number;
  callback: () => void;
}

/**
 * Runs `sourceCode` in an isolated vm context and records every call-stack push/pop,
 * console output, and micro/macrotask scheduling event as an ordered ExecutionStep[].
 *
 * Design note: we let the vm context's OWN native Promise implementation do the real work —
 * it shares the process's real microtask queue, so ordering between chained/nested promises
 * is spec-correct "for free". We only fake `setTimeout`, since real timers would force us to
 * actually wait out real delays to record a trace.
 */
export async function recordTrace(sourceCode: string, fileName: string): Promise<Trace> {
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
      error: `Could not parse this file as JavaScript: ${err.message}`,
    };
  }

  const pendingTimers: PendingTimer[] = [];
  let timerSeq = 0;
  let timerIdCounter = 1;

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
    const scheduleStepId = push('schedule-timer', { label, detail: `${delay}ms` });
    pendingTimers.push({
      id,
      seq,
      delay,
      label,
      scheduleStepId,
      callback: () => callback(...extraArgs),
    });
    return id;
  }

  function fakeClearTimeout(id: unknown) {
    const idx = pendingTimers.findIndex((t) => t.id === id);
    if (idx >= 0) {
      pendingTimers.splice(idx, 1);
    }
  }

  function wrapMicrotaskCallback(callback: unknown, label: string) {
    if (typeof callback !== 'function') {
      return callback;
    }
    const scheduleStepId = push('schedule-microtask', { label });
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

  const context = vm.createContext(sandbox);

  // Patch this CONTEXT's own Promise.prototype.then (a separate realm's Promise class —
  // this never touches the extension host's real global Promise) and define queueMicrotask
  // in terms of it, so ordering between .then() chains and queueMicrotask stays spec-correct.
  vm.runInContext(
    `(function () {
      var originalThen = Promise.prototype.then;
      Promise.prototype.then = function (onFulfilled, onRejected) {
        return originalThen.call(
          this,
          __wrapMicrotask(onFulfilled, 'Promise.then'),
          __wrapMicrotask(onRejected, 'Promise.catch')
        );
      };
      globalThis.queueMicrotask = function (cb) {
        return originalThen.call(Promise.resolve(), __wrapMicrotask(cb, 'queueMicrotask'));
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
    errorMessage = `Runtime error: ${err?.message ?? String(err)}`;
    push('console-log', { label: 'console.error', detail: errorMessage });
  }
  push('pop-stack', { label: 'global()' });

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

  async function flushMicrotasks() {
    for (let i = 0; i < MICROTASK_FLUSH_ATTEMPTS; i++) {
      const before = steps.length;
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (steps.length === before) {
        return;
      }
    }
  }

  return {
    fileName,
    sourceCode,
    steps,
    truncated: truncated || undefined,
    error: errorMessage,
  };
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
