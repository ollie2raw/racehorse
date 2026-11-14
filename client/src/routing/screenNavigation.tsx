import { useEffect, useSyncExternalStore, type SetStateAction } from 'react';
import type { AppMode } from '../appRouteTypes';
import { pendingScreenLoad } from '../routes/screenPrefetch';
import { ScreenLoader } from '../ui/ScreenLoader';

// A screen whose chunk is already loaded renders synchronously (see routes/lazyScreen.ts),
// so the change commits at once. One that is not loaded yet is waited for before the mode
// changes, and the loader appears over the screen being left only if that takes this long,
// so a quick load never flashes it.
const SLOW_NAVIGATION_MS = 150;

const PRESSABLE = 'button, a, [role="button"], [tabindex]';
// A pointer-driven tap is gone from :active as soon as the finger lifts, which can be well
// before the screen changes, so the tapped control keeps a pressed look until it does.
const POINTER_TAP_WINDOW_MS = 1000;

let latest = 0;
let slow = false;
let lastPressed: { el: Element; at: number } | null = null;
let pendingEl: Element | null = null;
const listeners = new Set<() => void>();

function setSlow(next: boolean): void {
  if (slow === next) return;
  slow = next;
  listeners.forEach((listener) => listener());
}

/** The control under a tap: a real button or link, else the nearest ancestor styled as clickable. */
function pressableFrom(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  const control = node.closest(PRESSABLE);
  if (control) return control;
  let found: Element | null = null;
  for (let el: Element | null = node, depth = 0; el && depth < 8; el = el.parentElement, depth += 1) {
    if (getComputedStyle(el).cursor === 'pointer') found = el;
    else if (found) break;
  }
  return found;
}

function clearPendingPress(): void {
  pendingEl?.removeAttribute('data-nav-pending');
  pendingEl = null;
}

function tappedControl(): Element | null {
  if (lastPressed && Date.now() - lastPressed.at < POINTER_TAP_WINDOW_MS) return lastPressed.el;
  return pressableFrom(document.activeElement);
}

/** Changes the app mode once the next screen's code is ready; the newest call wins. */
export function navigateToScreen(
  next: SetStateAction<AppMode>,
  commit: (next: SetStateAction<AppMode>) => void,
): void {
  const mine = ++latest;
  clearPendingPress();
  const load = typeof next === 'string' ? pendingScreenLoad(next) : null;
  if (!load) {
    setSlow(false);
    commit(next);
    return;
  }
  pendingEl = tappedControl();
  pendingEl?.setAttribute('data-nav-pending', 'true');
  const timer = window.setTimeout(() => {
    if (mine === latest) setSlow(true);
  }, SLOW_NAVIGATION_MS);
  const settle = () => {
    window.clearTimeout(timer);
    if (mine !== latest) return;
    clearPendingPress();
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
  useEffect(() => {
    const remember = (event: PointerEvent) => {
      const control = pressableFrom(event.target);
      lastPressed = control ? { el: control, at: Date.now() } : null;
    };
    window.addEventListener('pointerdown', remember, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', remember, { capture: true });
  }, []);
  const showLoader = useSyncExternalStore(subscribe, () => slow, () => false);
  if (!showLoader) return null;
  return (
    <div className="rh-screen-transition-loader">
      <ScreenLoader />
    </div>
  );
}
