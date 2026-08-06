import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface HeapProps {
  entries: Record<string, string>;
}

export function Heap({ entries }: HeapProps) {
  const names = Object.keys(entries);

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto">
      {names.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs italic text-slate-400">no heap allocations yet</span>
        </div>
      )}
      {/* AnimatePresence stays mounted permanently — see CallStack.tsx for why. */}
      <AnimatePresence initial={false}>
        {names.map((name) => (
          <motion.div
            key={name}
            layout
            initial={{ opacity: 0, x: -12, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-xs"
          >
            <span className="font-semibold text-emerald-700">{name}</span>
            <span className="truncate text-emerald-800/70">{entries[name]}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
