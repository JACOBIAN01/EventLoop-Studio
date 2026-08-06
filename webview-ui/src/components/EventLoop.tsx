import React from 'react';
import { motion } from 'framer-motion';

export type LoopStatus = 'idle' | 'script' | 'microtasks' | 'macrotask';

export interface EventLoopProps {
  status: LoopStatus;
  /** Whether the Call Stack is currently empty, the actual condition the event loop checks. */
  stackEmpty: boolean;
}

export const STATUS_COPY: Record<LoopStatus, string> = {
  idle: 'Idle',
  script: 'Running script',
  microtasks: 'Draining microtasks',
  macrotask: 'Running a macrotask',
};

/** Same color used for the panel title and the status badge beside it, so they read as one signal. */
export const STATUS_COLOR: Record<LoopStatus, string> = {
  idle: 'text-slate-500',
  script: 'text-indigo-600',
  microtasks: 'text-amber-600',
  macrotask: 'text-violet-600',
};

interface PriorityRowProps {
  index: number;
  label: string;
  active: boolean;
  activeClass: string;
}

/**
 * Shows the real decision the event loop makes, not a generic "it's busy" spinner:
 * is the stack empty, and if so, which queue wins (microtasks always checked first).
 * The only motion is a brief pulse on whichever row is actually active right now —
 * meaningful motion tied to a real state transition, not perpetual animation.
 */
function PriorityRow({ index, label, active, activeClass }: PriorityRowProps) {
  return (
    <motion.div
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${
        active ? activeClass : 'border-slate-200 bg-white text-slate-400'
      }`}
      animate={active ? { scale: [1, 1.03, 1] } : { scale: 1 }}
      transition={active ? { duration: 0.45, ease: 'easeOut' } : { duration: 0.15 }}
    >
      <span
        className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px] font-bold ${
          active ? 'bg-white/60' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {index}
      </span>
      <span className="truncate">{label}</span>
      {active && <span className="ml-auto flex-none text-[9px] font-semibold uppercase tracking-wide">active</span>}
    </motion.div>
  );
}

export function EventLoop({ status, stackEmpty }: EventLoopProps) {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="flex flex-none items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-slate-500">Call Stack</span>
        <span className={`text-[11px] font-semibold ${stackEmpty ? 'text-emerald-600' : 'text-slate-700'}`}>
          {stackEmpty ? 'Empty' : 'Not empty'}
        </span>
      </div>

      <p className="flex-none text-[10px] leading-tight text-slate-400">Checked in this order:</p>

      <PriorityRow
        index={1}
        label="Microtask Queue"
        active={status === 'microtasks'}
        activeClass="border-amber-300 bg-amber-50 text-amber-700"
      />
      <PriorityRow
        index={2}
        label="Macrotask Queue"
        active={status === 'macrotask'}
        activeClass="border-violet-300 bg-violet-50 text-violet-700"
      />
    </div>
  );
}
