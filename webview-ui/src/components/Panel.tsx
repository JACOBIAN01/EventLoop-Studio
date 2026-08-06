import React from 'react';
import { InfoDot } from './InfoDot';

/** Shared accent identity for each panel, keeps the palette consistent and centralized. */
export type PanelAccent = 'indigo' | 'emerald' | 'teal' | 'amber' | 'violet' | 'slate';

interface PanelProps {
  title: string;
  accent: PanelAccent;
  children: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Overrides the title's default neutral color, e.g. to reflect a live status. */
  titleClassName?: string;
  /** Short definition shown in a hover tooltip next to the title, e.g. "What is the Call Stack?" */
  description?: string;
}

const ACCENT: Record<PanelAccent, string> = {
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  teal: 'bg-teal-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-300',
};

/**
 * Consistent panel chrome shared by every viz panel. Deliberately restrained: one neutral
 * border/background style everywhere, with a single small color dot carrying each panel's
 * identity — the color budget is spent on the data inside (frames, tokens), not on decorating
 * every container. Uniform chrome + purposeful data color reads as considered, not templated.
 */
export function Panel({
  title,
  accent,
  children,
  badge,
  className,
  bodyClassName,
  titleClassName,
  description,
}: PanelProps) {
  return (
    <div
      data-panel={title}
      className={`flex min-h-0 flex-col rounded-md border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className ?? ''}`}
    >
      <div className="mb-2 flex flex-none items-center gap-1.5">
        <span className={`h-1.5 w-1.5 flex-none rounded-full ${ACCENT[accent]}`} aria-hidden="true" />
        <h2 className={`text-[10.5px] font-semibold uppercase tracking-wide ${titleClassName ?? 'text-slate-500'}`}>
          {title}
        </h2>
        {description && <InfoDot label={`About ${title}`} text={description} />}
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      {/*
        Overflow containment lives on the body, not the outer panel — that keeps content from
        spilling past the rounded border (the original bug) without also clipping the header's
        InfoDot tooltip, which needs to render outside the panel's box. Panels that don't pass
        their own bodyClassName (only Event Loop, currently) get a safe overflow-hidden default;
        others keep whatever they already specify (overflow-y-auto, etc.) unmodified.
      */}
      <div className={`min-h-0 flex-1 ${bodyClassName ?? 'overflow-hidden'}`}>{children}</div>
    </div>
  );
}
