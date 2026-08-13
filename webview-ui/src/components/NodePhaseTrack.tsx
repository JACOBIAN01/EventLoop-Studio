import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NodePhase } from '../../../src/shared/types';
import type { PendingItem } from '../App';
import { QueueList } from './QueueList';
import { InfoDot } from './InfoDot';

export interface NodePhaseTrackProps {
  currentPhase: NodePhase | null;
  timers: PendingItem[];
  pendingCallbacks: PendingItem[];
  poll: PendingItem[];
  check: PendingItem[];
  closeCallbacks: PendingItem[];
  /** Cross-cutting, not phases — rendered inside the Microtask Hub, not as their own chips. */
  pendingNextTicks: PendingItem[];
  pendingMicrotasks: PendingItem[];
  /** Changes on every real 'run-nexttick'/'run-microtask' step — drives the hub's per-callback flash. */
  lastDrainStepId: number | null;
}

interface PhaseDef {
  phase: NodePhase;
  shortLabel: string;
  label: string;
  description: string;
  /** Only Poll: everything else here is an honest in-memory simulation, this one genuinely isn't. */
  real?: boolean;
}

/** Real libuv order, fixed, every iteration — this is the whole point of the track. */
const PHASES: PhaseDef[] = [
  { phase: 'timers', shortLabel: 'Timers', label: 'Timers', description: 'Runs expired setTimeout/setInterval callbacks.' },
  {
    phase: 'pending-callbacks',
    shortLabel: 'Pending CB',
    label: 'Pending Callbacks',
    description: 'Models the category of deferred system-level callback (e.g. a TCP connection error) this phase exists for.',
  },
  {
    phase: 'idle-prepare',
    shortLabel: 'Idle/Prep',
    label: 'Idle, Prepare',
    description: "Internal to libuv. Real Node gives userland code no hook into this phase either, it's not a gap in this simulator.",
  },
  {
    phase: 'poll',
    shortLabel: 'Poll',
    label: 'Poll',
    description: "Genuinely real: dispatches an actual fs.readFile to Node's real libuv thread pool. This is what setImmediate races against, not setTimeout.",
    real: true,
  },
  {
    phase: 'check',
    shortLabel: 'Check',
    label: 'Check',
    description: 'Runs setImmediate callbacks. A nested setImmediate scheduled from inside another one drains in this same pass, not the next loop iteration.',
  },
  {
    phase: 'close-callbacks',
    shortLabel: 'Close CB',
    label: 'Close Callbacks',
    description: "Runs a handle's close callback, e.g. socket.on('close', ...).",
  },
];

/** Short label per phase, reused by other Node-mode UI outside this track. */
export const PHASE_LABEL: Record<NodePhase, string> = Object.fromEntries(
  PHASES.map((def) => [def.phase, def.label]),
) as Record<NodePhase, string>;

/** Explicit grid position for each phase chip in the 9-column ring, validated over many mockup rounds. */
const GRID_POS: Record<NodePhase, { col: number; row: number }> = {
  timers: { col: 2, row: 1 },
  'pending-callbacks': { col: 4, row: 1 },
  'idle-prepare': { col: 6, row: 1 },
  poll: { col: 9, row: 1 },
  check: { col: 9, row: 5 },
  'close-callbacks': { col: 6, row: 5 },
};

/**
 * Just the arrowhead — no tail line — rotated per direction. A real SVG triangle instead of a
 * unicode glyph so the diagonal spokes still point exactly along their true angle.
 */
function ArrowIcon({ rotation, className = '' }: { rotation: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      style={{ transform: `rotate(${rotation}deg)` }}
      className={`h-2 w-2 flex-none ${className}`}
      aria-hidden="true"
    >
      <path d="M1 1 L9 5 L1 9 Z" fill="currentColor" />
    </svg>
  );
}

function Arrow({ rotation, col, row }: { rotation: number; col: number; row: number }) {
  return (
    <div className="flex items-center justify-center text-slate-300" style={{ gridColumn: col, gridRow: row }} aria-hidden="true">
      <ArrowIcon rotation={rotation} />
    </div>
  );
}

function Spoke({ rotation, col, row }: { rotation: number; col: number; row: number }) {
  return (
    <div
      className="flex items-center justify-center text-sky-600 opacity-50"
      style={{ gridColumn: col, gridRow: row }}
      aria-hidden="true"
    >
      <ArrowIcon rotation={rotation} />
    </div>
  );
}

/** The two long jumps (Poll -> Check, Check -> Close Callbacks): one continuous line + one arrowhead, length itself signals "far apart in the sequence", contrasted with the short spokes. */
function LongConnector({
  orientation,
  col,
  row,
  rotation,
}: {
  orientation: 'vertical' | 'horizontal';
  col: string;
  row: string;
  rotation: number;
}) {
  const isVertical = orientation === 'vertical';
  return (
    <div
      className={`flex items-center text-slate-300 ${isVertical ? 'h-full flex-col' : 'w-full flex-row'}`}
      style={{ gridColumn: col, gridRow: row }}
      aria-hidden="true"
    >
      {rotation === 180 && <ArrowIcon rotation={rotation} />}
      <div className={isVertical ? 'w-px flex-1 bg-slate-300' : 'h-px flex-1 bg-slate-300'} />
      {rotation !== 180 && <ArrowIcon rotation={rotation} />}
    </div>
  );
}

/**
 * The central, cross-cutting hub: nextTick + Promise queues, drawn once, inside the loop the
 * six phases already form, instead of two disconnected panels floating above it. Flashes once
 * per REAL 'run-nexttick'/'run-microtask' step (via `lastDrainStepId` changing), not on a fixed
 * timer, so the frequency a student sees genuinely matches "drains after every callback", the
 * detail most explanations of this get wrong by implying it's once per phase.
 */
function MicrotaskHub({
  nextTicks,
  microtasks,
  lastDrainStepId,
}: {
  nextTicks: PendingItem[];
  microtasks: PendingItem[];
  lastDrainStepId: number | null;
}) {
  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border-[1.5px] border-sky-500 bg-sky-50">
      <AnimatePresence>
        {lastDrainStepId !== null && (
          <motion.span
            key={lastDrainStepId}
            className="pointer-events-none absolute inset-0 z-10 bg-sky-400"
            initial={{ opacity: 0.3 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
      <div className="flex flex-none items-center gap-1.5 border-b border-sky-100 px-3 py-2">
        <span className="text-[11.5px] font-bold text-sky-700">Microtask Hub</span>
        <InfoDot
          label="About the Microtask Hub"
          text="Drains after every callback, not once per phase — process.nextTick and the Promise/microtask queue are cross-cutting, not phases of their own, so they sit inside the loop they drain between."
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="flex min-h-0 flex-col border-r border-sky-100 px-2.5 py-2">
          <span className="mb-1 block flex-none text-[9.5px] font-bold text-sky-700">nextTick Queue</span>
          <div className="min-h-0 flex-1">
            <QueueList items={nextTicks} emptyText="no nextTick callbacks queued" color="sky" initialOffset={{ y: -14 }} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col px-2.5 py-2">
          <span className="mb-1 block flex-none text-[9.5px] font-bold text-sky-700">Promise Queue</span>
          <div className="min-h-0 flex-1">
            <QueueList items={microtasks} emptyText="no microtasks queued" color="amber" initialOffset={{ y: -14 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sequence over state: a 9-column ring showing all six real phases, always, in the real fixed
 * order, with a single moving "you are here" pointer, queue-depth badges, and a central
 * Microtask Hub every phase visibly connects to via short spokes. Idle/Prepare never shows the
 * "active" pointer, even when it genuinely is the current phase, since nothing ever happens
 * there, a glowing "active" phase that does nothing would be misleading.
 */
export function NodePhaseTrack({
  currentPhase,
  timers,
  pendingCallbacks,
  poll,
  check,
  closeCallbacks,
  pendingNextTicks,
  pendingMicrotasks,
  lastDrainStepId,
}: NodePhaseTrackProps) {
  const itemsFor: Record<NodePhase, PendingItem[]> = {
    timers,
    'pending-callbacks': pendingCallbacks,
    'idle-prepare': [],
    poll,
    check,
    'close-callbacks': closeCallbacks,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Rows are explicit fr fractions, not "auto"/content-around: every row's height comes
          from dividing up whatever space this panel actually has, so the 5 rows (and the chips/
          hub inside them) always fit exactly inside the available height, never overflow past it
          and get clipped by the page's outer overflow-hidden, no matter how big the chips get. */}
      <div
        className="grid min-h-0 flex-1 items-stretch justify-items-stretch gap-x-3 gap-y-1.5"
        style={{
          gridTemplateColumns: 'repeat(9, auto)',
          // Chip rows (1.3fr each) unchanged from before — the 6 phases keep both their grid
          // position AND their size. The hub's row grew from 1.4fr to 2.6fr entirely by
          // shrinking the two spoke-arrow rows (0.25fr -> 0.15fr, they're just 8px icons).
          gridTemplateRows: 'minmax(0,1.3fr) minmax(0,0.15fr) minmax(0,2.6fr) minmax(0,0.15fr) minmax(0,1.3fr)',
        }}
      >
        {/* Close Callbacks -> Timers: 3 small arrows, not one long line, per the final design */}
        <Arrow rotation={0} col={1} row={1} />
        <Arrow rotation={270} col={1} row={3} />
        <Arrow rotation={180} col={3} row={5} />

        {PHASES.map((def) => {
          const isIdlePrepareChip = def.phase === 'idle-prepare';
          const isActive = currentPhase === def.phase && !isIdlePrepareChip;
          const items = itemsFor[def.phase];
          const preview = items.length === 0 ? null : items.length === 1 ? items[0].label : `${items[0].label} +${items.length - 1} more`;
          const pos = GRID_POS[def.phase];
          const num = PHASES.findIndex((p) => p.phase === def.phase) + 1;

          return (
            <div
              key={def.phase}
              style={{ gridColumn: pos.col, gridRow: pos.row }}
              className={`relative flex h-full min-h-0 min-w-32 flex-col justify-center gap-1 overflow-hidden rounded-lg border px-3 py-2.5 text-[13px] font-semibold ${
                isActive
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : isIdlePrepareChip
                    ? 'border-slate-100 bg-slate-50 text-slate-300'
                    : 'border-slate-200 bg-surface text-slate-500'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="node-phase-pointer"
                  className="absolute -top-2.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-indigo-500"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              {items.length > 0 && (
                // Literal violet-600 value, not the bg-violet-600 class: that variable is
                // inverted for dark mode elsewhere (preview text, status labels), but this
                // badge must stay a fixed vivid violet in both themes.
                <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[oklch(54.1%_.281_293.009)] px-1 text-[8px] font-bold text-white">
                  {items.length}
                </span>
              )}
              <div className="flex items-center gap-1">
                {/* Active state uses a fixed solid indigo + white text (not a translucent
                    surface tint relying on inherited color) so the number stays legible
                    regardless of theme. */}
                <span
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[9px] font-bold ${
                    isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {num}
                </span>
                <span className="whitespace-nowrap">{def.shortLabel}</span>
                {isIdlePrepareChip && (
                  <InfoDot
                    label="Why is this dimmed?"
                    text="This phase never lights up, in this simulator or in real Node: userland code has no hook into Idle/Prepare either, so nothing can ever be scheduled into it. That's a real fact about Node, not a gap here."
                  />
                )}
              </div>
              {preview && (
                <span className="max-w-24 truncate text-[9.5px] font-semibold text-violet-600" title={preview}>
                  {preview}
                </span>
              )}
            </div>
          );
        })}

        {/* row 1 sequence arrows */}
        <Arrow rotation={0} col={3} row={1} />
        <Arrow rotation={0} col={5} row={1} />
        <Arrow rotation={0} col={7} row={1} />

        {/* row 2: spokes down into the hub */}
        <Spoke rotation={90} col={2} row={2} />
        <Spoke rotation={90} col={4} row={2} />
        <Spoke rotation={90} col={6} row={2} />
        <Spoke rotation={135} col={8} row={2} />
        <LongConnector orientation="vertical" col="9" row="2 / 5" rotation={90} />

        {/* row 3: the hub, spans columns 2-7 */}
        <div style={{ gridColumn: '2 / 8', gridRow: 3 }} className="h-full min-h-0 w-full py-1">
          <MicrotaskHub nextTicks={pendingNextTicks} microtasks={pendingMicrotasks} lastDrainStepId={lastDrainStepId} />
        </div>

        {/* row 4: spokes back up out of the hub */}
        <Spoke rotation={270} col={6} row={4} />
        <Spoke rotation={225} col={8} row={4} />

        {/* row 5: the long Check -> Close Callbacks connector */}
        <LongConnector orientation="horizontal" col="7 / 9" row="5" rotation={180} />
      </div>
    </div>
  );
}
