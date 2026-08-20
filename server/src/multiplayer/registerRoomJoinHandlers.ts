import { childLogger } from '../logger';
import type { Server, Socket } from 'socket.io';
import { getRoomMatchEventMeta } from '../rooms';
import {
  type AckFn,
  type RoomJoinConfig,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { AttachSocketToTrackedRoomFn } from './roomSocketAttach';
import { MatchTerminalJoinError } from './matchTerminalJoin';
import { failedRoomLookupLimiter, socketRateLimitKey } from '../rateLimit';

const log = childLogger('multiplayer:join');

export type RegisterRoomJoinHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn;
};

export function registerRoomJoinHandlers(
  _io: Server,
  socket: Socket,
  params: RegisterRoomJoinHandlersParams,
): void {
  const { handlerDeps, attachSocketToTrackedRoom } = params;

  socket.on('room:join', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const explicitConfig =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : null;
    const codeFromObject =
      argCode && typeof argCode === 'object' && !Array.isArray(argCode)
        ? (argCode as { roomCode?: unknown; username?: unknown; userId?: unknown; authToken?: unknown })
        : null;
    const configFromCodeObject: RoomJoinConfig | null = codeFromObject
      ? {
          username:
            typeof codeFromObject.username === 'string' ? codeFromObject.username : undefined,
          userId: typeof codeFromObject.userId === 'string' ? codeFromObject.userId : null,
          authToken: typeof codeFromObject.authToken === 'string' ? codeFromObject.authToken : null,
        }
      : null;
    const config = explicitConfig ?? configFromCodeObject ?? {};
    const rawCode = codeFromObject?.roomCode ?? argCode;
    const roomCode = String(rawCode ?? '')
      .trim()
      .toUpperCase();
    log.info(`[room:join] socket=${socket.id}, code=${roomCode}`);
    try {
      const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
      log.info(`[room:join] identity user=${username} (${userId})`);
      const attached = await attachSocketToTrackedRoom({
        roomCode,
        username,
        userId,
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      });
      cb?.({
        ok: true,
        roomCode: attached.room.code,
        you: attached.joinedPlayerSeatId,
        players: attached.roster,
        state: attached.stateWithCounts,
        legalMoves: attached.rejoinLegalMoves,
        canDraw: attached.rejoinCanDraw,
        hydrationOutcome: attached.hydrationOutcome,
        eventMeta: getRoomMatchEventMeta(attached.room.code),
        tournamentMatch: attached.tournamentMatchMeta,
        matchStarted: Boolean(attached.room.state),
        matchmakingMatchId: attached.room.matchmakingMatchId ?? null,
        scheduledTournamentMatchId: attached.room.scheduledTournamentMatchId ?? null,
      });
    } catch (err: unknown) {
      if (err instanceof MatchTerminalJoinError) {
        log.info(
          `[room:join] TERMINAL: code=${roomCode} matchId=${err.terminal.matchId} status=${err.terminal.status}`,
        );
        cb?.({ ok: false, error: err.code, terminal: err.terminal });
        return;
      }
      const message = err instanceof Error ? err.message : 'unknown error';
      log.info(`[room:join] ERROR: ${message}`);
      if (message === 'Room not found.') {
        const rateLimitKey = socketRateLimitKey(socket);
        const failedLookupsKey = `failed_lookups:${rateLimitKey}`;
        failedRoomLookupLimiter.increment(failedLookupsKey);
      }
      cb?.({ ok: false, error: message });
    }
  });
}
