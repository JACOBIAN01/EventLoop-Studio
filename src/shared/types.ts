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
  | 'line';

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
}

export interface Trace {
  fileName: string;
  sourceCode: string;
  steps: ExecutionStep[];
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
  | { type: 'error'; message: string };

/** Messages sent from the Webview back to the extension host. */
export type WebviewToHostMessage = { type: 'ready' } | { type: 'requestTrace' };

export const COMMANDS = {
  visualize: 'eventloop-studio.visualize',
  showAst: 'eventloop-studio.showAstSummary',
  helloDeveloper: 'eventloop-studio.helloDeveloper',
} as const;
