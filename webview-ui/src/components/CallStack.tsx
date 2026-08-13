import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { StackFrame } from '../App';

export interface CallStackProps {
  frames: StackFrame[];
}

/** Renders frames bottom-to-top like a real call stack, newest frame visually on top. */
export function CallStack({ frames }: CallStackProps) {
  const topToBottom = [...frames].reverse();

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto">
      {frames.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs italic text-slate-400">Call stack is empty</span>
        </div>
      )}
      {/*
        AnimatePresence must stay mounted permanently (never conditionally unmounted based on
        list emptiness) — otherwise remounting it later is treated as its own "first render",
        which suppresses entrance/shared-layout transitions for whatever appears right after an
        empty stack (a very common case here, since the stack drains to empty constantly).
      */}
      <AnimatePresence initial={false} mode="popLayout">
        {topToBottom.map((frame, i) => {
          const isTop = i === 0;
          // Handler frames (tokenRefId set) share a layoutId with the queue token that
          // spawned them — Framer Motion morphs the token across panels into this frame.
          const layoutId = frame.tokenRefId !== undefined ? `token-${frame.tokenRefId}` : undefined;
          return (
            <motion.div
              key={frame.id}
              layout
              layoutId={layoutId}
              data-frame-id={frame.id}
              data-token-ref={frame.tokenRefId}
              initial={{ opacity: 0, y: 22, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.7 }}
              className={
                isTop
                  // to-[...] uses violet-600's literal value, not the class: that variable is
                  // inverted for dark mode elsewhere (status labels, chip text), but this
                  // gradient must stay fixed vivid indigo->violet in both themes.
                  ? 'rounded-lg border border-indigo-600 bg-linear-to-r from-indigo-600 to-[oklch(54.1%_.281_293.009)] px-3 py-2 font-mono text-xs font-semibold text-white shadow-md shadow-indigo-500/20'
                  : 'rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 font-mono text-xs text-indigo-700'
              }
            >
              {frame.label}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
