import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Caption } from '../lib/captions';
import { InfoDot } from './InfoDot';

export interface CaptionBarProps {
  caption: Caption | null;
  captionsEnabled: boolean;
  onToggle: () => void;
}

/**
 * Rule-tier captions always show, even with the guide reduced: hiding the ones that
 * explain *why* something happened would compromise the tool's actual teaching job.
 * Only the routine "this function was called" narration gets hidden on repeat plays.
 */
export function CaptionBar({ caption, captionsEnabled, onToggle }: CaptionBarProps) {
  const visible = caption !== null && (captionsEnabled || caption.tier === 'rule');

  return (
    <div className="flex flex-none items-center gap-2 border-b border-slate-200 bg-surface px-4 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={captionsEnabled}
        title="Toggle EventLoop Guide"
        className="flex flex-none items-center gap-1.5 rounded-md border border-slate-200 bg-surface px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
      >
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${captionsEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
          aria-hidden="true"
        />
        EventLoop Guide
      </button>

      <InfoDot
        label="About the EventLoop Guide"
        text={'Click "EventLoop Guide" to toggle step explanations on and off. The core event loop rules stay visible either way, so you won\'t lose the important parts.'}
      />

      <div className="min-h-5 min-w-0 flex-1">
        <AnimatePresence mode="wait">
          {visible && (
            <motion.p
              key={caption!.text}
              title={caption!.text}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={
                caption!.tier === 'rule'
                  ? 'truncate text-[13px] font-medium text-indigo-700'
                  : 'truncate text-[13px] text-slate-500'
              }
            >
              {caption!.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
