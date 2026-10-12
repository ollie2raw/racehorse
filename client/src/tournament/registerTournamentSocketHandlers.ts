import { wrapSocketHandler } from '../multiplayer/socketGuards';
import {
  registerRawSocketEventHandler,
  type RawSocketHandler,
} from '../multiplayer/socketEventBus';
import { SOCKET_EVENTS, TOURNAMENT_SOCKET_EVENTS } from '../multiplayer/socketEventRegistry';
import type { TournamentPushPayload, TournamentSocketScope } from './tournamentSocketTypes';

export type RegisterTournamentSocketHandlersOptions = {
  getScope: () => TournamentSocketScope;
  recoverState?: () => void;
};

/**
 * Sole tournament socket registration point. Dispatches to hub/session delegates only —
 * no business logic in this file.
 */
export function registerTournamentSocketHandlers(
  options: RegisterTournamentSocketHandlersOptions,
): () => void {
  const { getScope, recoverState } = options;
  const unregisters: Array<() => void> = [];

  const register = (eventName: string, handler: (...args: never[]) => void) => {
    unregisters.push(registerRawSocketEventHandler(eventName, handler as RawSocketHandler));
  };

  const recover = recoverState ?? (() => undefined);

  register(
    TOURNAMENT_SOCKET_EVENTS.REGISTRATION_OPEN,
    wrapSocketHandler(TOURNAMENT_SOCKET_EVENTS.REGISTRATION_OPEN, (payload: TournamentPushPayload) => {
      getScope().hub?.onRegistrationOpen(payload);
    }, { recoverOnError: recover }),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.REGISTRATION_UPDATED,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.REGISTRATION_UPDATED,
      (payload: TournamentPushPayload) => {
        getScope().hub?.onRegistrationUpdated(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.BRACKET_GENERATED,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.BRACKET_GENERATED,
      (payload: TournamentPushPayload) => {
        getScope().hub?.onBracketGenerated(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.MATCH_UPDATED,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.MATCH_UPDATED,
      (payload: TournamentPushPayload & { matchId?: string }) => {
        getScope().hub?.onMatchUpdated(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.MATCH_READY,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.MATCH_READY,
      (payload: Parameters<NonNullable<TournamentSocketScope['hub']>['onMatchReady']>[0]) => {
        getScope().hub?.onMatchReady(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.MATCH_COMPLETED,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.MATCH_COMPLETED,
      (payload: {
        tournamentId: string;
        matchId: string;
        roomCode?: string | null;
        round?: number;
        winnerId?: string | null;
        winnerSource?: string | null;
      }) => {
        getScope().hub?.onMatchCompleted(payload);
        getScope().session?.onMatchCompleted(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.COMPLETED,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.COMPLETED,
      (payload: TournamentPushPayload & { winnerId?: string }) => {
        getScope().hub?.onTournamentCompleted(payload);
        getScope().session?.onTournamentCompleted(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.ROUND_COMPLETED,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.ROUND_COMPLETED,
      (payload: TournamentPushPayload & { round?: number }) => {
        getScope().hub?.onRoundCompleted(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    TOURNAMENT_SOCKET_EVENTS.CANCELLED,
    wrapSocketHandler(
      TOURNAMENT_SOCKET_EVENTS.CANCELLED,
      (payload: TournamentPushPayload & { status?: 'cancelled' }) => {
        getScope().hub?.onTournamentCancelled(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    SOCKET_EVENTS.ROOM_MATCH_ABANDONED,
    wrapSocketHandler(
      SOCKET_EVENTS.ROOM_MATCH_ABANDONED,
      (payload: {
        roomCode?: string;
        abandonedUserId?: string | null;
        abandonedUsername?: string | null;
        message?: string;
        tournamentId?: string | null;
        isTournament?: boolean;
      }) => {
        getScope().session?.onMatchAbandoned(payload);
      },
      { recoverOnError: recover },
    ),
  );

  register(
    SOCKET_EVENTS.CONNECT,
    wrapSocketHandler(SOCKET_EVENTS.CONNECT, () => {
      getScope().hub?.onRecover();
    }, { recoverOnError: recover }),
  );

  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}