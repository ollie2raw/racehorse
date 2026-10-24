import { useSyncExternalStore } from 'react';

/** Presentation timings only. CSS counterparts live in motion.css. Never gate game actions. */
export const motionDuration = { micro: 120, state: 180, tile: 220, result: 300, reward: 360 } as const;

function motionAllowed() {
  return typeof window !== 'undefined'
    && document.visibilityState !== 'hidden'
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  query?.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    query?.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

/** Live preference/visibility updates also cancel an in-progress JS count. */
export function useMotionAllowed() {
  return useSyncExternalStore(subscribe, motionAllowed, () => false);
}
