import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface InfoDotProps {
  /** aria-label for the icon, e.g. "About the Call Stack". */
  label: string;
  /** Tooltip body text, shown on hover/focus. Free to wrap onto multiple lines. */
  text: string;
}

const TOOLTIP_WIDTH = 224; // px, matches the old w-56
const VIEWPORT_MARGIN = 8;

/**
 * Small "i" icon that reveals a short explanation on hover or keyboard focus.
 *
 * The tooltip renders through a portal into `document.body`, positioned via a measured
 * `getBoundingClientRect()` rather than CSS `absolute`+`group-hover` — every panel this sits in
 * is wrapped by react-resizable-panels' `Panel`, which hard-codes `overflow: hidden` on itself
 * (not overridable, see its own type docs) and clips anything absolutely positioned that spills
 * past its box, which is exactly what happened once panels got narrow enough to resize. A
 * `position: fixed` element rendered outside that tree entirely isn't subject to it.
 */
export function InfoDot({ label, text }: InfoDotProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const idealLeft = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
    const left = Math.min(Math.max(idealLeft, VIEWPORT_MARGIN), window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN);
    setCoords({ top: rect.bottom + 8, left });
  };
  const hide = () => setCoords(null);

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="inline-flex h-3.5 w-3.5 flex-none cursor-help items-center justify-center rounded-full border border-slate-300 text-[8px] font-bold text-slate-400 hover:border-indigo-400 hover:text-indigo-500"
      aria-label={label}
    >
      i
      {coords &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: TOOLTIP_WIDTH }}
            // whitespace-pre-line: most callers pass a single plain sentence (no-op here), but a
            // caller can embed literal "\n"s (e.g. QueueList, pairing an API name with its
            // callback) and have them render as real line breaks instead of collapsing away.
            className="z-50 whitespace-pre-line rounded-md border border-slate-200 bg-surface p-2.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-slate-600 shadow-lg"
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
