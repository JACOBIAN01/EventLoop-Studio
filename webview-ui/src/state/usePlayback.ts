import { useCallback, useEffect, useRef, useState } from 'react';

export type Speed = 0.5 | 1 | 2 | 4;

export interface PlaybackState {
  currentStepIndex: number;
  isPlaying: boolean;
  speed: Speed;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  restart: () => void;
  setSpeed: (speed: Speed) => void;
  seek: (index: number) => void;
}

/** Base interval (ms) between steps at 1x speed. */
const BASE_INTERVAL_MS = 700;

/**
 * State machine driving trace playback: current step index, play/pause,
 * and speed. Kept separate from rendering/derivation so App.tsx only has to
 * pass `currentStepIndex` to `computeStateAtStep`.
 */
export function usePlayback(stepCount: number): PlaybackState {
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<Speed>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const lastIndex = stepCount - 1;

  // A brand-new trace (often shorter) can arrive while scrubbed deep into a previous one, e.g.
  // switching Browser/Node.js modes, or just re-running Visualize after editing the file down
  // to fewer steps. Clamp at read-time so a stale index from before this trace loaded can never
  // reach computeStateAtStep out of bounds, that was crashing the whole render tree (blank
  // webview) instead of just clipping the scrubber visually.
  const safeIndex = Math.min(currentStepIndex, lastIndex);

  // Also correct the underlying stored value, not just this derived read, so relative moves
  // like previous() step from a valid baseline instead of the stale raw number.
  useEffect(() => {
    setCurrentStepIndex((idx) => Math.min(idx, lastIndex));
  }, [lastIndex]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (stepCount <= 0) return;
    // If already at the end, restart from the beginning so Play is intuitive.
    setCurrentStepIndex((idx) => (idx >= lastIndex ? -1 : idx));
    setIsPlaying(true);
  }, [stepCount, lastIndex]);

  const next = useCallback(() => {
    setCurrentStepIndex((idx) => Math.min(idx + 1, lastIndex));
  }, [lastIndex]);

  const previous = useCallback(() => {
    setCurrentStepIndex((idx) => Math.max(idx - 1, -1));
  }, []);

  const restart = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex(-1);
  }, []);

  const setSpeed = useCallback((s: Speed) => {
    setSpeedState(s);
  }, []);

  const seek = useCallback(
    (index: number) => {
      const clamped = Math.max(-1, Math.min(index, lastIndex));
      setCurrentStepIndex(clamped);
    },
    [lastIndex]
  );

  // Drive auto-advance while playing. Recreated whenever speed changes so the
  // interval duration stays current; always cleared on unmount/dep change.
  useEffect(() => {
    if (!isPlaying) {
      clearTimer();
      return;
    }

    const intervalMs = BASE_INTERVAL_MS / speed;
    intervalRef.current = setInterval(() => {
      setCurrentStepIndex((idx) => {
        if (idx >= lastIndex) {
          setIsPlaying(false);
          return idx;
        }
        return idx + 1;
      });
    }, intervalMs);

    return clearTimer;
  }, [isPlaying, speed, lastIndex, clearTimer]);

  // Safety net: clear any interval on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  return {
    currentStepIndex: safeIndex,
    isPlaying,
    speed,
    play,
    pause,
    next,
    previous,
    restart,
    setSpeed,
    seek,
  };
}
