import { useEffect, useRef } from 'react';
import { registerMatchmakingSocketHandlers } from './registerMatchmakingSocketHandlers';
import type { MatchmakingSocketScope } from './matchmakingSocketTypes';

export type UseRegisterMatchmakingSocketHandlersParams = {
  getScope: () => MatchmakingSocketScope;
  enabled?: boolean;
};

/** React wiring for the matchmaking socket registrar — registration only, no business logic. */
export function useRegisterMatchmakingSocketHandlers({
  getScope,
  enabled = true,
}: UseRegisterMatchmakingSocketHandlersParams): void {
  const getScopeRef = useRef(getScope);
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
  getScopeRef.current = getScope;

  useEffect(() => {
    if (!enabled) return;
    return registerMatchmakingSocketHandlers({
      getScope: () => getScopeRef.current(),
    });
  }, [enabled]);
}