import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { mutePreference } from './mutePreference';

/**
 * The mute preference as React state, shared by every reader.
 *
 * `useState(() => mutePreference.get())` — what the match screens used to do —
 * reads once on mount and never hears about a change made elsewhere. With a
 * toggle on the Settings page there is always an "elsewhere".
 */
export function useMutePreference(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const isMuted = useSyncExternalStore(
    mutePreference.subscribe,
    mutePreference.get,
    () => false,
  );
  // Setter-function form included: the match trays are written
  // `setIsMuted((prev) => !prev)`, and forwarding the function itself would
  // store a truthy value rather than the toggle's result.
  const setMuted = useCallback<Dispatch<SetStateAction<boolean>>>((next) => {
    mutePreference.set(typeof next === 'function' ? next(mutePreference.get()) : next);
  }, []);
  return [isMuted, setMuted];
}
