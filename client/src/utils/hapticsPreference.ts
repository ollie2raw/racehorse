const KEY = 'racehorse_haptics';

/**
 * The haptics preference, and a subscription to it. Same shape and reasoning as `mutePreference` and
 * `gameSpeedPreference`: the Settings switch and the match are not mounted together, and `get` reads
 * storage every time rather than caching. Haptics are ON unless the player turned them off.
 */
const listeners = new Set<() => void>();

export const hapticsPreference = {
  get(): boolean {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(KEY) !== 'off';
    } catch {
      // Private mode / storage disabled: haptics on is the intended default.
      return true;
    }
  },

  set(enabled: boolean): void {
    if (hapticsPreference.get() === enabled) return;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(KEY, enabled ? 'on' : 'off');
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
