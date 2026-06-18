import { useSyncExternalStore } from 'react';

/** Wall-clock ms that updates on an interval — avoids setState in effects for live clocks. */
export function useSyncNow(intervalMs: number, enabled: boolean): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!enabled) return () => {};
      const id = window.setInterval(onStoreChange, intervalMs);
      return () => window.clearInterval(id);
    },
    () => Date.now(),
    () => Date.now(),
  );
}
