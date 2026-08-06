import React from 'react';
import type { ExecutionStep } from '../../../src/shared/types';
import type { PlaybackState, Speed } from '../state/usePlayback';

export interface ControlsProps {
  playback: PlaybackState;
  stepCount: number;
  steps: ExecutionStep[];
}

const SPEEDS: Speed[] = [0.5, 1, 2, 4];

const iconBtn =
  'flex h-8 w-9 flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-sm text-slate-600 shadow-sm transition-colors hover:enabled:border-indigo-300 hover:enabled:bg-indigo-50 hover:enabled:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40';

export function Controls({ playback, stepCount, steps }: ControlsProps) {
  const { currentStepIndex, isPlaying, speed, play, pause, next, previous, restart, setSpeed, seek } = playback;

  const atStart = currentStepIndex <= -1;
  const atEnd = currentStepIndex >= stepCount - 1;
  const currentStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={iconBtn} onClick={restart} disabled={atStart} title="Restart" aria-label="Restart">
          ⟲
        </button>
        <button
          type="button"
          className={iconBtn}
          onClick={previous}
          disabled={atStart}
          title="Previous step"
          aria-label="Previous step"
        >
          ⏮
        </button>
        <button
          type="button"
          className="flex h-8 min-w-24 flex-none items-center justify-center rounded-md bg-indigo-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:enabled:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={isPlaying ? pause : play}
          disabled={stepCount === 0}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button type="button" className={iconBtn} onClick={next} disabled={atEnd} title="Next step" aria-label="Next step">
          ⏭
        </button>

        <div
          className="ml-2 flex overflow-hidden rounded-md border border-slate-300"
          role="group"
          aria-label="Playback speed"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={
                s === speed
                  ? 'bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white'
                  : 'bg-white px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50'
              }
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="ml-auto font-mono text-xs text-slate-500">
          Step {currentStepIndex + 1} / {stepCount}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
          min={-1}
          max={Math.max(stepCount - 1, -1)}
          value={currentStepIndex}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Timeline scrubber"
        />
        <div
          className="w-2/5 flex-none truncate font-mono text-xs text-slate-500"
          title={currentStep?.detail ?? undefined}
        >
          {currentStep ? currentStep.label : 'not started'}
        </div>
      </div>
    </div>
  );
}
