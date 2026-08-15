/**
 * Shared contract between the extension host (recorder) and the Webview UI.
 * Imported by both sides — kept dependency-free (no vscode, no React) so either
 * bundle can pull it in without pulling in the other's runtime.
 */

export type StepKind =
  | 'push-stack'
  | 'pop-stack'
  | 'console-log'
  | 'schedule-timer'
  | 'timer-ready'
  | 'run-timer'
  | 'schedule-microtask'
  | 'run-microtask'
  | 'heap-set'
  | 'line'
  | 'enter-phase'
  | 'schedule-nexttick'
  | 'run-nexttick'
  | 'schedule-immediate'
  | 'run-immediate'
  | 'schedule-io'
  | 'run-io'
  | 'schedule-syscallback'
  | 'run-syscallback'
  | 'schedule-close'
  | 'run-close';

/**
 * The six real libuv phases, in their fixed cyclical order. Only used when a Trace was
 * recorded in 'node' mode; an 'enter-phase' step's `detail` field holds one of these,
 * emitted every iteration even when that phase has nothing pending, so the UI can show the
 * loop genuinely cycling through all six, not just the ones a given script happens to use.
 * 'idle-prepare' never receives any scheduled work, in this simulator or in real Node,
 * userland code has no hook into it either.
 */
export type NodePhase = 'timers' | 'pending-callbacks' | 'idle-prepare' | 'poll' | 'check' | 'close-callbacks';

export interface ExecutionStep {
  id: number;
  kind: StepKind;
  line?: number;
  label: string;
  detail?: string;
  /**
   * For 'timer-ready'/'run-timer'/'run-microtask' steps: the `id` of the 'schedule-timer'/
   * 'schedule-microtask' step this corresponds to. Two pending timers can share an identical
   * label (e.g. two `setTimeout(fn, 0)` calls), so the UI must pair by this id, not by label text.
   */
  refId?: number;
  /**
   * 'run-timer' only: true when this 0ms timer resolved in the very first Timers phase pass
   * while a setImmediate was also already pending, real Node's one genuinely undocumented race
   * (top-level setTimeout(fn, 0) vs. setImmediate). Lets the UI flag the ambiguity instead of
   * implying this specific ordering is a rule.
   */
  ambiguous?: boolean;
}

export interface Trace {
  fileName: string;
  sourceCode: string;
  steps: ExecutionStep[];
  /** Which event loop model this trace was recorded under; changes which fake globals existed. */
  mode: 'browser' | 'node';
  truncated?: boolean;
  error?: string;
}

export interface AstSummary {
  variables: { name: string; kind: string; line: number }[];
  functions: { name: string; line: number; params: number }[];
  calls: { callee: string; line: number }[];
  consoleLogs: { line: number }[];
  timers: { line: number }[];
  promises: { line: number }[];
}

/** Messages sent from the extension host to the Webview. */
export type HostToWebviewMessage =
  | { type: 'trace'; payload: Trace }
  | { type: 'error'; message: string }
  /**
   * Sent when auto-re-recording after a save fails to parse. Unlike 'trace', the webview must
   * NOT replace its current trace with this: recordTrace returns an empty, error-only Trace on a
   * parse failure, and swapping that in would blank the whole visualization over an incidental
   * syntax error mid-edit. The webview keeps showing whatever it already has and just surfaces
   * this as a small warning instead.
   */
  | { type: 'staleSource'; message: string };

/** Messages sent from the Webview back to the extension host. */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'requestTrace'; mode: 'browser' | 'node' };

export const COMMANDS = {
  visualize: 'eventloop-studio.visualize',
  showAst: 'eventloop-studio.showAstSummary',
} as const;
