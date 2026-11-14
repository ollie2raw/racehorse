import { useSyncExternalStore, type SetStateAction } from 'react';
import type { AppMode } from '../appRouteTypes';
import { pendingScreenLoad } from '../routes/screenPrefetch';
import { ScreenLoader } from '../ui/ScreenLoader';

// A screen whose chunk is already loaded renders synchronously (see routes/lazyScreen.ts),
// so the change commits at once. One that is not loaded yet is waited for before the mode
// changes, and the loader appears over the screen being left only if that takes this long,
// so a quick load never flashes it.
const SLOW_NAVIGATION_MS = 150;

let latest = 0;
let slow = false;
const listeners = new Set<() => void>();

function setSlow(next: boolean): void {
  if (slow === next) return;
  slow = next;
  listeners.forEach((listener) => listener());
}

/** Changes the app mode once the next screen's code is ready; the newest call wins. */
export function navigateToScreen(
  next: SetStateAction<AppMode>,
  commit: (next: SetStateAction<AppMode>) => void,
): void {
  const mine = ++latest;
  const load = typeof next === 'string' ? pendingScreenLoad(next) : null;
  if (!load) {
    setSlow(false);
    commit(next);
    return;
  }
  const timer = window.setTimeout(() => {
    if (mine === latest) setSlow(true);
  }, SLOW_NAVIGATION_MS);
  const settle = () => {
    window.clearTimeout(timer);
    if (mine !== latest) return;
    setSlow(false);
    // A failed load is committed too: the route's error boundary reports it and retries.
    commit(next);
  };
  load.then(settle, settle);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A leaf, so showing the loader re-renders this component and not the app shell. */
export function SlowNavigationLoader() {
  const showLoader = useSyncExternalStore(subscribe, () => slow, () => false);
  if (!showLoader) return null;
  return (
    <div className="rh-screen-transition-loader">
      <ScreenLoader />
    </div>
  );
}
