import { createContext, useContext, useEffect } from 'react';

/** A domain screen signals only whether its existing local phase is active gameplay. */
export const GameplayPresentationContext = createContext<((active: boolean) => void) | null>(null);

export function useGameplayPresentation(active: boolean) {
  const setActive = useContext(GameplayPresentationContext);
  useEffect(() => {
    setActive?.(active);
    return () => setActive?.(false);
  }, [active, setActive]);
}
