import React from 'react';
import { motion } from 'framer-motion';
import type { NodePhase } from '../../../src/shared/types';
import type { PendingItem } from '../App';
import { InfoDot } from './InfoDot';

export interface NodeEventLoopRingProps {
  currentPhase: NodePhase | null;
  timers: PendingItem[];
  pendingCallbacks: PendingItem[];
  poll: PendingItem[];
  check: PendingItem[];
  closeCallbacks: PendingItem[];
}

interface PhaseDef {
  phase: NodePhase;
  label: string;
  description: string;
}

/** Real libuv order, fixed, every iteration — this is the whole point of the ring. */
const PHASES: PhaseDef[] = [
  { phase: 'timers', label: 'Timers', description: 'Runs expired setTimeout/setInterval callbacks.' },
  {
    phase: 'pending-callbacks',
    label: 'Pending Callbacks',
    description: 'Deferred system-level callbacks, e.g. a TCP connection error.',
  },
  {
    phase: 'idle-prepare',
    label: 'Idle, Prepare',
    description: "Internal to libuv. Real Node gives userland code no hook into this phase either, it's not a gap in this simulator.",
  },
  {
    phase: 'poll',
    label: 'Poll',
    description: 'Where real fs/network I/O callbacks fire. This is what setImmediate races against, not setTimeout.',
  },
  {
    phase: 'check',
    label: 'Check',
    description: 'Runs setImmediate callbacks, guaranteed to fire right after Poll, in the same loop iteration.',
  },
  {
    phase: 'close-callbacks',
    label: 'Close Callbacks',
    description: "Runs a handle's close callback, e.g. socket.on('close', ...).",
  },
];

const ACTIVE_CLASS = 'border-indigo-300 bg-indigo-50 text-indigo-700';
const IDLE_PREPARE_CLASS = 'border-slate-100 bg-slate-50 text-slate-300';
const INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-500';

/**
 * All six real phases, always, in the real fixed order, every time — even the three that a
 * typical script never touches. Only showing the phases a given trace happens to exercise
 * would teach an incomplete architecture; Idle/Prepare specifically stays permanently dim,
 * because that's true in real Node too, not a limitation of this simulator.
 */
export function NodeEventLoopRing({ currentPhase, timers, pendingCallbacks, poll, check, closeCallbacks }: NodeEventLoopRingProps) {
  const itemsFor: Record<NodePhase, PendingItem[]> = {
    timers,
    'pending-callbacks': pendingCallbacks,
    'idle-prepare': [],
    poll,
    check,
    'close-callbacks': closeCallbacks,
  };

  return (
    <div className="flex h-full flex-col gap-1">
      {PHASES.map((def, i) => {
        const isIdlePrepare = def.phase === 'idle-prepare';
        const isActive = !isIdlePrepare && currentPhase === def.phase;
        const items = itemsFor[def.phase];

        return (
          <motion.div
            key={def.phase}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] font-medium ${
              isIdlePrepare ? IDLE_PREPARE_CLASS : isActive ? ACTIVE_CLASS : INACTIVE_CLASS
            }`}
            animate={isActive ? { scale: [1, 1.03, 1] } : { scale: 1 }}
            transition={isActive ? { duration: 0.45, ease: 'easeOut' } : { duration: 0.15 }}
          >
            <span
              className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px] font-bold ${
                isActive ? 'bg-white/60' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i + 1}
            </span>
            <span className="truncate">{def.label}</span>
            <InfoDot label={`About ${def.label}`} text={def.description} />
            {!isIdlePrepare && items.length > 0 && (
              <span className="flex-none rounded-full bg-white/70 px-1.5 py-px text-[9px] font-bold">{items.length}</span>
            )}
            {isIdlePrepare ? (
              <span className="ml-auto flex-none text-[9px] italic">never observable</span>
            ) : (
              isActive && <span className="ml-auto flex-none text-[9px] font-semibold uppercase tracking-wide">active</span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
