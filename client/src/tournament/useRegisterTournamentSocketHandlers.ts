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
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
  getScopeRef.current = getScope;

  useEffect(() => {
    if (!enabled) return;
    return registerTournamentSocketHandlers({
      getScope: () => getScopeRef.current(),
    });
  }, [enabled]);
}