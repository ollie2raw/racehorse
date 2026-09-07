import { useEffect, useRef } from 'react';
import { registerFriendsSocketHandlers } from './registerFriendsSocketHandlers';
import type { FriendsSocketScope } from './friendsSocketTypes';

export type UseRegisterFriendsSocketHandlersParams = {
  getScope: () => FriendsSocketScope;
  enabled?: boolean;
};

/** React wiring for the friends socket registrar — registration only, no business logic. */
export function useRegisterFriendsSocketHandlers({
  getScope,
  enabled = true,
}: UseRegisterFriendsSocketHandlersParams): void {
  const getScopeRef = useRef(getScope);
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
  getScopeRef.current = getScope;

  useEffect(() => {
    if (!enabled) return;
    return registerFriendsSocketHandlers({
      getScope: () => getScopeRef.current(),
    });
  }, [enabled]);
}