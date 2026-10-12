import { childLogger } from '../logger';
import type { Server, Socket } from 'socket.io';
import { getRoom, getRoomMatchEventMeta } from '../rooms';
import { isBlockedPairOrFalse } from '../moderation/blockStore';
import { roomKind } from './roomKind';
import {
  type AckFn,
  type RoomJoinConfig,
  type RoomSessionHandlerDeps,
  getRoomRoster,
} from './roomSession';
import type { AttachSocketToTrackedRoomFn } from './roomSocketAttach';
import { MatchTerminalJoinError } from './matchTerminalJoin';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';
import { failedRoomLookupLimiter, socketRateLimitKey } from '../rateLimit';

const log = childLogger('multiplayer:join');

export type RegisterRoomJoinHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Blocks apply to private rooms: someone who knows a room code can't take the
 * empty seat opposite a player who blocked them (or whom they blocked).
 *
 * Scoped narrowly so room flows stay as they are:
 *  - private rooms only (Quick Match pairs never cross a block; tournament
 *    seats are assigned by the bracket and aren't refused here);
 *  - only a new joiner. A player who already holds a seat (reconnect, resync)
 *    is never refused, even if a block was made mid-match;
 *  - signed-in joiners only (guests have no account to block);
 *  - in-memory rooms only. A room not loaded in this process (e.g. just after a
 *    restart, before rehydration) is not checked;
 *  - fail-open: a failed block lookup lets the join through.
 */
async function isJoinBlockedByRoomMember(roomCode: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId || !UUID_RE.test(userId)) return false;
  let room: ReturnType<typeof getRoom>;
  try {
    room = getRoom(roomCode);
  } catch {
    return false;
  }
  if (roomKind(room) !== 'private') return false;
  const roster = getRoomRoster(roomCode);
  if (roster.some((player) => player.userId === userId)) return false;
  for (const player of roster) {
    if (!player.userId || player.userId === userId || !UUID_RE.test(player.userId)) continue;
    if (await isBlockedPairOrFalse(userId, player.userId, 'room:join')) return true;
  }
  return false;
}

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
      if (await isJoinBlockedByRoomMember(roomCode, userId)) {
        log.info({ roomCode }, '[room:join] refused: block between joiner and a seated player');
        // Same answer as a wrong code, so the joiner can't tell they were blocked.
        cb?.({ ok: false, error: 'Room not found.' });
        return;
      }
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
        emitMpAuthorityFunnel('private_terminal_recovery', {
          roomCode,
          extra: {
            source: 'join_ack',
            matchId: err.terminal.matchId,
            status: err.terminal.status,
          },
        });
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
