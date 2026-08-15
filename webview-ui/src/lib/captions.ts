import type { ExecutionStep } from '../../../src/shared/types';

/**
 * Deterministic, hand-written step explanations, not LLM-generated. This is a
 * correctness-sensitive teaching tool: a wrong or slightly-off explanation is worse
 * than none for someone learning the concept for the first time, and with only a
 * handful of step kinds a fixed template set can cover all of them reliably, instantly,
 * and fully offline.
 *
 * Two tiers:
 *  - 'rule':       explains one of the actual event-loop rules (timer/microtask/macrotask
 *                   transitions). Worth seeing even on the 50th replay of the same code.
 *  - 'mechanical': narrates an ordinary call/return/print/store. Useful the first time,
 *                   repetitive after that; this is the tier the Captions toggle hides.
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
      return step.ambiguous
        ? {
            tier: 'rule',
            text: `This 0ms timer's delay is up, but racing setImmediate here is genuinely non-deterministic in real Node, so don't treat this order as a rule.`,
          }
        : {
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

    case 'enter-phase':
      return { tier: 'rule', text: `The loop enters the ${step.label} phase, one of Node's six, always in this order.` };

    case 'schedule-nexttick':
      return {
        tier: 'rule',
        text: `process.nextTick queues this ahead of everything else, it always drains before the Microtask Queue gets a turn.`,
      };

    case 'run-nexttick':
      return { tier: 'rule', text: `nextTick queue drains before microtasks, every single time both are pending.` };

    case 'schedule-immediate':
      return {
        tier: 'rule',
        text: `setImmediate queues this for the Check phase. Racing setTimeout(fn, 0) at the top level is genuinely undocumented in real Node; inside an I/O callback, setImmediate always wins.`,
      };

    case 'run-immediate':
      return { tier: 'rule', text: `Check phase: runs right after Poll, in the same loop iteration it was scheduled in.` };

    case 'schedule-io':
      return {
        tier: 'rule',
        text: `Genuinely real, not simulated: dispatched to Node's actual libuv thread pool right now. Its callback fires in the Poll phase once the real read completes.`,
      };

    case 'run-io':
      return {
        tier: 'rule',
        text: `Poll phase: the real fs.readFile actually finished. This is what setImmediate races against, not setTimeout.`,
      };

    case 'schedule-syscallback':
      return {
        tier: 'rule',
        text: `Models the category of deferred system-level callback (e.g. a TCP error) the Pending Callbacks phase exists for.`,
      };

    case 'run-syscallback':
      return { tier: 'rule', text: `Pending Callbacks phase: runs right after Timers, before Poll.` };

    case 'schedule-close':
      return { tier: 'rule', text: `A handle was closed; its callback is queued for the Close Callbacks phase.` };

    case 'run-close':
      return { tier: 'rule', text: `Close Callbacks: the last phase in the cycle, e.g. socket.on('close', ...).` };

    default:
      return null;
  }
}
