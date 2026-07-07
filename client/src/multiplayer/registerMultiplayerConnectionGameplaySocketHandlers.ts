import { wrapSocketHandler } from './socketGuards';
import {
  registerRawSocketEventHandler,
  type RawSocketHandler,
} from './socketEventBus';
import { SOCKET_EVENTS } from './socketEventRegistry';
import type { ConnectionHandEndedPayload, GameplaySocketScope } from './gameplaySocketTypes';
import type { GameRematchStatusPayload } from './legacyTournamentTypes';

export type { ConnectionHandEndedPayload } from './gameplaySocketTypes';

/**
 * Live-match gameplay socket handlers (hand reveal, rematch, opponent drag).
 * Registrar dispatches to gameplay delegates only — business logic lives in connectionGameplaySocketHandlers.
 */
export function registerMultiplayerConnectionGameplaySocketHandlers(options: {
  getScope: () => GameplaySocketScope;
  recoverState: () => void;
}): () => void {
  const { getScope, recoverState } = options;
  const unregisters: Array<() => void> = [];

  const register = (eventName: string, handler: (...args: never[]) => void) => {
    unregisters.push(registerRawSocketEventHandler(eventName, handler as RawSocketHandler));
  };

  register(
    SOCKET_EVENTS.HAND_ENDED,
    wrapSocketHandler(SOCKET_EVENTS.HAND_ENDED, (payload: ConnectionHandEndedPayload) => {
      getScope().gameplay?.onHandEnded(payload);
    }),
  );

  register(
    SOCKET_EVENTS.GAME_REMATCH_STATUS,
    wrapSocketHandler(SOCKET_EVENTS.GAME_REMATCH_STATUS, (payload: GameRematchStatusPayload) => {
      getScope().gameplay?.onGameRematchStatus(payload);
    }),
  );

  register(
    SOCKET_EVENTS.GAME_REMATCH_STARTED,
    wrapSocketHandler(SOCKET_EVENTS.GAME_REMATCH_STARTED, () => {
      getScope().gameplay?.onGameRematchStarted();
    }, { recoverOnError: recoverState }),
  );

  register(
    SOCKET_EVENTS.PLAYER_DRAGGING,
    wrapSocketHandler(SOCKET_EVENTS.PLAYER_DRAGGING, (payload: { playerId?: string; dragging?: boolean }) => {
      getScope().gameplay?.onPlayerDragging(payload);
    }),
  );

  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}