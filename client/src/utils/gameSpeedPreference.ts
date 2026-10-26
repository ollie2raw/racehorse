const KEY = 'racehorse_game_speed';

/** How long Fritz pauses before moving in Play vs Fritz. `normal` is the game's original cadence. */
export type GameSpeed = 'normal' | 'fast';

/**
 * The game-speed preference, and a subscription to it. Same shape and reasoning as `mutePreference`:
 * the Settings switch and the match screen are not mounted together, so a live reader has to hear
 * about a change, and `get` reads storage every time rather than caching (a module-level cache would
 * outlive the storage it mirrors, which is wrong in tests and after a sign-out clears site data).
 */
const listeners = new Set<() => void>();

export const gameSpeedPreference = {
  get(): GameSpeed {
    if (typeof window === 'undefined') return 'normal';
    try {
      return window.localStorage.getItem(KEY) === 'fast' ? 'fast' : 'normal';
    } catch {
      // Private mode / storage disabled: the original cadence is the safe default.
      return 'normal';
    }
  },

  set(speed: GameSpeed): void {
    if (gameSpeedPreference.get() === speed) return;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(KEY, speed);
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
