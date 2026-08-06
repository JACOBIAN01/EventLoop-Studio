import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

export interface ConsolePanelProps {
  lines: string[];
}

export function ConsolePanel({ lines }: ConsolePanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lines.length]);

  return (
    <div className="h-full overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-400 shadow-inner">
      {lines.length === 0 ? (
        <div className="italic text-slate-500">// console output will appear here</div>
      ) : (
        lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="wrap-break-word py-0.5"
          >
            <span className="mr-1.5 text-slate-500">&gt;</span>
            {line}
          </motion.div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
