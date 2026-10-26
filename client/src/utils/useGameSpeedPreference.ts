import { useCallback, useSyncExternalStore } from 'react';
import { gameSpeedPreference, type GameSpeed } from './gameSpeedPreference';

/** The game-speed preference as React state, shared by every reader (see useMutePreference). */
export function useGameSpeedPreference(): [GameSpeed, (next: GameSpeed) => void] {
  const speed = useSyncExternalStore(
    gameSpeedPreference.subscribe,
    gameSpeedPreference.get,
    () => 'normal' as const,
  );
  const setSpeed = useCallback((next: GameSpeed) => gameSpeedPreference.set(next), []);
  return [speed, setSpeed];
}
