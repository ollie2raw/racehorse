import { useCallback, useRef, useSyncExternalStore } from 'react';
import { estimatedServerNowMs, subscribeTournamentClock } from './tournamentClock';

/**
 * Estimated server time (epoch ms) that re-renders every `intervalMs` while
 * `enabled`, and whenever the clock gets a better sample. For countdown
 * display only.
 */
export function useTournamentNow(intervalMs: number, enabled: boolean): number {
  const snapshotRef = useRef(estimatedServerNowMs());

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const update = () => {
        const next = estimatedServerNowMs();
        if (next === snapshotRef.current) return;
        snapshotRef.current = next;
        onStoreChange();
      };
      const unsubscribeClock = subscribeTournamentClock(update);
      if (!enabled || typeof window === 'undefined') return unsubscribeClock;
      update();
      const id = window.setInterval(update, Math.max(1, intervalMs));
      return () => {
        window.clearInterval(id);
        unsubscribeClock();
      };
    },
    [enabled, intervalMs],
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
