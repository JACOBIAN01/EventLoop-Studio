import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PendingItem } from '../App';
import { InfoDot } from './InfoDot';

export type QueueColor = 'teal' | 'amber' | 'violet' | 'sky';

/**
 * Full literal class strings per color, looked up by key rather than built with template
 * interpolation — Tailwind's build-time scanner only picks up class names that appear as
 * complete, unbroken strings somewhere in the source, so `border-${color}-200` would silently
 * produce no CSS at all.
 */
const COLOR_CLASSES: Record<
  QueueColor,
  { border: string; bg: string; text: string; textMuted: string; badgeBg: string }
> = {
  teal: { border: 'border-teal-200', bg: 'bg-teal-50', text: 'text-teal-800', textMuted: 'text-teal-600', badgeBg: 'bg-teal-500' },
  amber: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', textMuted: 'text-amber-600', badgeBg: 'bg-amber-500' },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-800', textMuted: 'text-violet-600', badgeBg: 'bg-violet-500' },
  sky: { border: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-800', textMuted: 'text-sky-600', badgeBg: 'bg-sky-500' },
};

export interface QueueListProps {
  items: PendingItem[];
  emptyText: string;
  color: QueueColor;
  /** A holding pool (Web APIs / Pending Timers) isn't FIFO-ordered, so it wraps in a column; everything else is a row. */
  direction?: 'row' | 'col';
  /** Tags the first item "next" — meaningful for an actual priority queue, not a holding pool. */
  showNextBadge?: boolean;
  /** Which direction this token is "thrown in" from, based on this panel's position relative to the Call Stack. */
  initialOffset: { x?: number; y?: number; rotate?: number };
}

/** Shared list renderer for every panel that's just "pending items, animated in and out". */
export function QueueList({ items, emptyText, color, direction = 'row', showNextBadge = false, initialOffset }: QueueListProps) {
  const c = COLOR_CLASSES[color];
  return (
    <div
      // A FIFO queue (direction="row", the default) always lays its items out in one horizontal
      // line, oldest-to-newest left-to-right, scrolling on the x-axis instead of wrapping —
      // wrapping to a second row breaks that left-to-right ordering as a visual read of "what
      // comes next". A holding pool (direction="col", Web APIs / Pending Timers) isn't FIFO-
      // ordered, so it keeps wrapping in a column instead.
      className={`flex h-full gap-2 ${
        direction === 'row'
          ? 'flex-row flex-nowrap items-start overflow-x-auto overflow-y-hidden pt-2'
          : 'flex-col flex-wrap content-start overflow-y-auto'
      }`}
    >
      {items.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs italic text-slate-400">{emptyText}</span>
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
            initial={{ opacity: 0, x: initialOffset.x ?? 0, y: initialOffset.y ?? 0, scale: 0.5, rotate: initialOffset.rotate ?? 0 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
            className={`relative flex w-28 flex-none flex-col gap-0.5 rounded-lg border ${c.border} ${c.bg} px-3 py-2 font-mono text-xs ${c.text} shadow-sm`}
          >
            {showNextBadge && i === 0 && (
              <span
                className={`absolute -top-2 right-1.5 rounded-full ${c.badgeBg} px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white`}
              >
                next
              </span>
            )}
            <div className="flex min-w-0 items-center gap-1">
              {item.detail && (
                // Inline, leading the code it belongs to — not a badge straddling the border;
                // this is an explicit, discoverable affordance in place of an invisible
                // whole-box hover. The tooltip pairs the API name back with its callback, so a
                // student who only sees the callback on the box can still see what scheduled it.
                <InfoDot label="Show full callback code" text={`${item.label}\n${item.detail}`} />
              )}
              <span className="truncate font-semibold">{item.detail ?? item.label}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
