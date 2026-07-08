import { wrapSocketHandler } from '../multiplayer/socketGuards';
import {
  registerRawSocketEventHandler,
  type RawSocketHandler,
} from '../multiplayer/socketEventBus';
import { SOCKET_EVENTS } from '../multiplayer/socketEventRegistry';
import type { FriendsSocketScope } from './friendsSocketTypes';

export type RegisterFriendsSocketHandlersOptions = {
  getScope: () => FriendsSocketScope;
};

/**
 * Sole friends socket registration point. Dispatches to presence delegates only —
 * no business logic in this file.
 */
export function registerFriendsSocketHandlers(
  options: RegisterFriendsSocketHandlersOptions,
): () => void {
  const { getScope } = options;
  const unregisters: Array<() => void> = [];

  const register = (eventName: string, handler: (...args: never[]) => void) => {
    unregisters.push(registerRawSocketEventHandler(eventName, handler as RawSocketHandler));
  };

  register(
    SOCKET_EVENTS.CONNECT,
    wrapSocketHandler(SOCKET_EVENTS.CONNECT, () => {
      getScope().presence?.onConnect();
    }),
  );

  register(
    SOCKET_EVENTS.PRESENCE_UPDATE,
    wrapSocketHandler(SOCKET_EVENTS.PRESENCE_UPDATE, (payload: { userId?: string; status?: string } | null | undefined) => {
      if (payload?.userId && payload?.status) {
        getScope().presence?.onPresenceUpdate?.(payload.userId, payload.status);
      }
    }),
  );

  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}