import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

export interface SourceCodeProps {
  sourceCode: string;
  currentLine: number | null;
}

/** Row height in px, kept in sync with the `h-5.5`/`leading-5.5` classes below so the
 *  animated highlight bar's computed `y` offset lines up pixel-for-pixel with each row. */
const LINE_HEIGHT = 22;

export function SourceCode({ sourceCode, currentLine }: SourceCodeProps) {
  const lines = sourceCode.replace(/\n$/, '').split('\n');
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentLine]);

  return (
    <div className="h-full overflow-x-auto overflow-y-auto rounded-lg bg-surface">
      {/* w-max + min-w-full: without an explicit width, <pre> stays pinned to the visible
          viewport width even when a line is long enough to need horizontal scroll, so the
          active-line highlight bar below (sized via inset-x-0, relative to this element) would
          stop partway across a scrolled long line instead of covering its full width. Growing
          <pre> to match its widest line (while never shrinking below the full container width)
          keeps the highlight's background correct at any scroll position. */}
      <pre className="relative m-0 w-max min-w-full font-mono text-[12.5px]">
        <code className="relative block">
          {currentLine !== null && (
            <motion.div
              className="absolute inset-x-0 h-5.5 rounded-r-md border-l-2 border-indigo-500 bg-linear-to-r from-indigo-50 via-indigo-50/40 to-transparent"
              initial={false}
              animate={{ y: (currentLine - 1) * LINE_HEIGHT }}
              transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.7 }}
            />
          )}
          {lines.map((text, i) => {
            const lineNumber = i + 1;
            const isActive = currentLine === lineNumber;
            return (
              <div
                key={lineNumber}
                ref={isActive ? activeLineRef : undefined}
                className="relative flex h-5.5 items-center whitespace-pre px-2 leading-5.5"
              >
                <span className="mr-3.5 w-8 flex-none select-none text-right text-slate-400">{lineNumber}</span>
                <span className={isActive ? 'font-medium text-heading' : 'text-slate-500'}>{text.length > 0 ? text : ' '}</span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
