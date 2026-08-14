import React from 'react';
import { Separator } from 'react-resizable-panels';

/**
 * Draggable dividers between panels. The hit area is w-3/h-3 (12px, matching the gap-3 spacing
 * this layout used before panels became resizable) so the visual rhythm stays the same; a thin
 * 1px line centered inside it is the only visible trace, brightening on hover.
 */
export function VSep() {
  return (
    <Separator className="group relative w-3 flex-none cursor-col-resize outline-none">
      <span
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300 transition-colors group-hover:bg-indigo-400"
        aria-hidden="true"
      />
    </Separator>
  );
}

export function HSep() {
  return (
    <Separator className="group relative h-3 flex-none cursor-row-resize outline-none">
      <span
        className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-300 transition-colors group-hover:bg-indigo-400"
        aria-hidden="true"
      />
    </Separator>
  );
}
