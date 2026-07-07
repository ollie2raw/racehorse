import { wrapSocketHandler } from '../multiplayer/socketGuards';
import {
  registerRawSocketEventHandler,
  type RawSocketHandler,
} from '../multiplayer/socketEventBus';
import { MATCHMAKING_SOCKET_EVENTS, SOCKET_EVENTS } from '../multiplayer/socketEventRegistry';
import type { MatchmakingSocketScope } from './matchmakingSocketTypes';
import type { MatchFoundPayload, OnlineCountEvent } from './types';

export type RegisterMatchmakingSocketHandlersOptions = {
  getScope: () => MatchmakingSocketScope;
};

/**
 * Sole matchmaking socket registration point. Dispatches to matchmaking + queue-count delegates only —
 * no business logic in this file.
 */
export function registerMatchmakingSocketHandlers(
  options: RegisterMatchmakingSocketHandlersOptions,
): () => void {
  const { getScope } = options;
  const unregisters: Array<() => void> = [];

  const register = (eventName: string, handler: (...args: never[]) => void) => {
    unregisters.push(registerRawSocketEventHandler(eventName, handler as RawSocketHandler));
  };

  register(
    MATCHMAKING_SOCKET_EVENTS.QUEUE_ONLINE,
    wrapSocketHandler(
      MATCHMAKING_SOCKET_EVENTS.QUEUE_ONLINE,
      (evt: OnlineCountEvent) => {
        const scope = getScope();
        scope.matchmaking?.onQueueOnline(evt);
        scope.queueCounts?.onQueueOnline(evt);
      },
    ),
  );

  register(
    MATCHMAKING_SOCKET_EVENTS.QUEUE_MATCHED,
    wrapSocketHandler(
      MATCHMAKING_SOCKET_EVENTS.QUEUE_MATCHED,
      (payload: MatchFoundPayload) => {
        getScope().matchmaking?.onQueueMatched(payload);
      },
    ),
  );

  register(
    MATCHMAKING_SOCKET_EVENTS.QUEUE_TIMEOUT,
    wrapSocketHandler(MATCHMAKING_SOCKET_EVENTS.QUEUE_TIMEOUT, () => {
      getScope().matchmaking?.onQueueTimeout();
    }),
  );

  register(
    SOCKET_EVENTS.CONNECT,
    wrapSocketHandler(SOCKET_EVENTS.CONNECT, () => {
      const scope = getScope();
      scope.matchmaking?.onConnect();
      scope.queueCounts?.onConnect();
    }),
  );

  register(
    SOCKET_EVENTS.DISCONNECT,
    wrapSocketHandler(SOCKET_EVENTS.DISCONNECT, () => {
      getScope().matchmaking?.onDisconnect();
    }),
  );

  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}