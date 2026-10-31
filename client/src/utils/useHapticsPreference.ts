import { useCallback, useSyncExternalStore } from 'react';
import { hapticsPreference } from './hapticsPreference';

/** The haptics preference as React state, shared by every reader (see useMutePreference). */
export function useHapticsPreference(): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(hapticsPreference.subscribe, hapticsPreference.get, () => true);
  const setEnabled = useCallback((next: boolean) => hapticsPreference.set(next), []);
  return [enabled, setEnabled];
}
