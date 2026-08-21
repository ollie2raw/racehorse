import { useCallback, useEffect, useRef, useState } from 'react';

const TICK_MS = 100;

export type RushClock = {
  /** Seconds left, for display. Never negative. */
  secondsLeft: number;
  expired: boolean;
  running: boolean;
  /** Bank bonus seconds for a solve. Clamped to the configured ceiling. */
  addSeconds: (seconds: number) => void;
  start: () => void;
  stop: () => void;
};

/**
 * The visible run clock.
 *
 * **Presentational only.** Timing enforcement lives in the server's `/complete`
 * replay, which compares wall-clock duration against the base clock plus the
 * bonuses the *replayed* solves actually earned. Nothing here is trusted; a
 * client that froze this clock would simply fail the server's duration check.
 */
export function useRushClock(params: {
  baseSeconds: number;
  maxSeconds: number;
  onExpire?: () => void;
  autoStart?: boolean;
}): RushClock {
  const { baseSeconds, maxSeconds, onExpire, autoStart = false } = params;

  const [secondsLeft, setSecondsLeft] = useState(baseSeconds);
  const [running, setRunning] = useState(autoStart);
  const [expired, setExpired] = useState(false);

  // Deadline-based rather than decrement-based: a backgrounded tab that misses
  // ticks must not gain time, which is exactly what a naive interval would do.
  const deadlineRef = useRef<number>(Date.now() + baseSeconds * 1000);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const start = useCallback(() => {
    deadlineRef.current = Date.now() + baseSeconds * 1000;
    expiredRef.current = false;
    setExpired(false);
    setSecondsLeft(baseSeconds);
    setRunning(true);
  }, [baseSeconds]);

  const stop = useCallback(() => setRunning(false), []);

  const addSeconds = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds === 0) return;
      const now = Date.now();
      const remainingMs = Math.max(0, deadlineRef.current - now);
      const cappedMs = Math.min(maxSeconds * 1000, remainingMs + seconds * 1000);
      deadlineRef.current = now + cappedMs;
      setSecondsLeft(cappedMs / 1000);
    },
    [maxSeconds],
  );

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => {
      const remainingMs = deadlineRef.current - Date.now();
      if (remainingMs <= 0) {
        setSecondsLeft(0);
        if (!expiredRef.current) {
          expiredRef.current = true;
          setExpired(true);
          setRunning(false);
          onExpireRef.current?.();
        }
        return;
      }
      setSecondsLeft(remainingMs / 1000);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  return { secondsLeft, expired, running, addSeconds, start, stop };
}
