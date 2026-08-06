import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PendingItem } from '../App';

export interface MicrotaskQueueProps {
  items: PendingItem[];
}

/** FIFO row of pending microtasks — the first item is next to run. Warm amber = high priority. */
export function MicrotaskQueue({ items }: MicrotaskQueueProps) {
  return (
    <div className="flex h-full flex-row flex-wrap content-start gap-2 overflow-y-auto pt-2">
      {items.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs italic text-slate-400">no microtasks queued</span>
        </div>
      )}
      {/* AnimatePresence stays mounted permanently — see CallStack.tsx for why. */}
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item, i) => (
          <motion.div
            key={item.id}
            layout
            layoutId={`token-${item.id}`}
            data-token-id={item.id}
            // Thrown in from directly above — the Call Stack panel sits above this one.
            initial={{ opacity: 0, y: -34, scale: 0.5, rotate: 6 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
            className="relative flex min-w-22.5 flex-col gap-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-xs text-amber-800 shadow-sm"
          >
            {i === 0 && (
              <span className="absolute -top-2 right-1.5 rounded-full bg-amber-500 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">
                next
              </span>
            )}
            <span className="font-semibold">{item.label}</span>
            {item.detail && <span className="text-[11px] text-amber-600">{item.detail}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
