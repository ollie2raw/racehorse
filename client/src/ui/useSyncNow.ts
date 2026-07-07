import { useCallback, useRef, useSyncExternalStore } from 'react';

/** Wall-clock ms that updates on an interval — avoids setState in effects for live clocks. */
export function useSyncNow(intervalMs: number, enabled: boolean): number {
  const snapshotRef = useRef(Date.now());

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!enabled || typeof window === 'undefined') return () => {};

      const updateSnapshot = () => {
        const next = Date.now();
        if (next === snapshotRef.current) return;
        snapshotRef.current = next;
        onStoreChange();
      };

      updateSnapshot();
      const id = window.setInterval(updateSnapshot, Math.max(1, intervalMs));
      return () => window.clearInterval(id);
    },
    [enabled, intervalMs],
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
