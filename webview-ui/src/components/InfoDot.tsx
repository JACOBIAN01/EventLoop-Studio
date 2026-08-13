import React from 'react';

export interface InfoDotProps {
  /** aria-label for the icon, e.g. "About the Call Stack". */
  label: string;
  /** Tooltip body text, shown on hover/focus. Free to wrap onto multiple lines. */
  text: string;
}

/** Small "i" icon that reveals a short explanation on hover or keyboard focus. */
export function InfoDot({ label, text }: InfoDotProps) {
  return (
    <div className="group relative inline-flex flex-none">
      <span
        tabIndex={0}
        className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-300 text-[8px] font-bold text-slate-400 hover:border-indigo-400 hover:text-indigo-500"
        aria-label={label}
      >
        i
      </span>
      <div className="invisible absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-md border border-slate-200 bg-surface p-2.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-slate-600 opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {text}
      </div>
    </div>
  );
}
