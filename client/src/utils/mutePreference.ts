const KEY = 'racehorse_muted';

/**
 * The mute preference, and a subscription to it.
 *
 * There are several independent readers — the App-level game preferences, each
 * match screen's UI chrome, the matchmaking screen — and they are not mounted
 * at the same time as the Settings toggle. Reading localStorage on mount was
 * enough while the only control lived inside a match; with a control on the
 * Settings page, a live reader has to hear about the change or it keeps playing
 * sound the user just turned off.
 *
 * `get` reads storage every time rather than caching. The value is a boolean,
 * so useSyncExternalStore's identity comparison is safe on a fresh read, and a
 * module-level cache would outlive the storage it mirrors — which is exactly
 * what makes it wrong in tests and after a sign-out clears site data.
 */

const listeners = new Set<() => void>();

export const mutePreference = {
  get(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(KEY) === '1';
    } catch {
      // Private mode / storage disabled — audio on is the safer default.
      return false;
    }
  },

  set(muted: boolean): void {
    if (mutePreference.get() === muted) return;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(KEY, muted ? '1' : '0');
      } catch {
        // Nothing to persist to; the listeners below still update this session.
      }
    }
    for (const listener of listeners) listener();
  },

  /** Returns the unsubscribe function, in useSyncExternalStore's shape. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
