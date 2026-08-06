import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PendingItem } from '../App';

export interface WebApisProps {
  timers: PendingItem[];
}

export function WebApis({ timers }: WebApisProps) {
  return (
    <div className="flex h-full flex-col flex-wrap content-start gap-2 overflow-y-auto">
      {timers.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs italic text-slate-400">no pending timers</span>
        </div>
      )}
      {/* AnimatePresence stays mounted permanently — see CallStack.tsx for why. */}
      <AnimatePresence initial={false} mode="popLayout">
        {timers.map((timer) => (
          <motion.div
            key={timer.id}
            layout
            layoutId={`token-${timer.id}`}
            data-token-id={timer.id}
            // Thrown in from the direction of the Call Stack panel (up + left of this one).
            initial={{ opacity: 0, x: -36, y: -22, scale: 0.5, rotate: -8 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
            className="flex min-w-22.5 flex-col gap-0.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 font-mono text-xs text-teal-800 shadow-sm"
          >
            <span className="font-semibold">{timer.label}</span>
            {timer.detail && <span className="text-[11px] text-teal-600">{timer.detail}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
