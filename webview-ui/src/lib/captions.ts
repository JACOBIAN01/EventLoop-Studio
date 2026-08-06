import type { ExecutionStep } from '../../../src/shared/types';

/**
 * Deterministic, hand-written step explanations — not LLM-generated. This is a
 * correctness-sensitive teaching tool: a wrong or slightly-off explanation is worse
 * than none for someone learning the concept for the first time, and with only a
 * handful of step kinds a fixed template set can cover all of them reliably, instantly,
 * and fully offline.
 *
 * Two tiers:
 *  - 'rule'       — explains one of the actual event-loop rules (timer/microtask/macrotask
 *                   transitions). Worth seeing even on the 50th replay of the same code.
 *  - 'mechanical' — narrates an ordinary call/return/print/store. Useful the first time,
 *                   repetitive after that — this is the tier the Captions toggle hides.
 */
export interface Caption {
  text: string;
  tier: 'rule' | 'mechanical';
}

export function explainStep(step: ExecutionStep): Caption | null {
  switch (step.kind) {
    case 'push-stack':
      return { tier: 'mechanical', text: `${step.label} is called and pushed onto the Call Stack.` };

    case 'pop-stack':
      return { tier: 'mechanical', text: `${step.label} returns and is popped off the Call Stack.` };

    case 'console-log':
      return { tier: 'mechanical', text: `Prints "${step.detail ?? ''}" to the console.` };

    case 'heap-set':
      return { tier: 'mechanical', text: `${step.label} is stored in the Heap and keeps its value after this function returns.` };

    case 'schedule-timer':
      return {
        tier: 'rule',
        text: `setTimeout hands the timer to the Web APIs, so the script keeps running without waiting.`,
      };

    case 'timer-ready':
      return {
        tier: 'rule',
        text: `Delay elapsed: the callback moves to the Macrotask Queue, waiting for an empty Call Stack.`,
      };

    case 'run-timer':
      return {
        tier: 'rule',
        text: `Stack and microtasks are empty, so this callback moves onto the Call Stack.`,
      };

    case 'schedule-microtask':
      return {
        tier: 'rule',
        text: `Scheduled on the Microtask Queue, which always runs before the next macrotask.`,
      };

    case 'run-microtask':
      return {
        tier: 'rule',
        text: `Call Stack is empty: the event loop drains all microtasks before any macrotask.`,
      };

    case 'line':
      return null;

    default:
      return null;
  }
}
