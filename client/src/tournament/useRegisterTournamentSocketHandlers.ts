import { useEffect, useRef } from 'react';
import { registerTournamentSocketHandlers } from './registerTournamentSocketHandlers';
import type { TournamentSocketScope } from './tournamentSocketTypes';

export type UseRegisterTournamentSocketHandlersParams = {
  getScope: () => TournamentSocketScope;
  enabled?: boolean;
};

/** React wiring for the tournament socket registrar — registration only, no business logic. */
export function useRegisterTournamentSocketHandlers({
  getScope,
  enabled = true,
}: UseRegisterTournamentSocketHandlersParams): void {
  const getScopeRef = useRef(getScope);
  getScopeRef.current = getScope;

  useEffect(() => {
    if (!enabled) return;
    return registerTournamentSocketHandlers({
      getScope: () => getScopeRef.current(),
    });
  }, [enabled]);
}