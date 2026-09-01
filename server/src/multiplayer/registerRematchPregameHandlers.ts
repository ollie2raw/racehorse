import type { Server, Socket } from 'socket.io';
import { appendRoomEvent, resetRoomEventLog } from '../roomEvents';
import {
  getRoom,
  initiatePregameDrawOrStartUnlocked,
  startGameUnlocked,
} from '../rooms';
import { assertRoomDurabilityOperationAllowed } from './roomDurabilityPolicy';
import { withRoomGameplayLock } from './roomGameplayLock';
import {
  broadcastStateUpdate,
  emitRematchStatus,
  resolveActorSeatId,
  waitForActiveGameOverPersist,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';
import { comparePregameDrawTiles } from './preGameDraw';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';
import { isAnyTournamentRoom } from './roomKind';
import { clearGameActionIdempotencyForRoom } from './gameActionIdempotency';
import { MATCH_RESULT_STILL_SAVING_MESSAGE } from './gameOverPersistPolicy';

export type RegisterRematchPregameHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

export function registerRematchPregameHandlers(
  io: Server,
  socket: Socket,
  params: RegisterRematchPregameHandlersParams,
): void {
  const { handlerDeps } = params;

  socket.on('game:rematch', async (code: unknown, cb?: AckFn) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    try {
      const room = getRoom(roomCode);
      assertRoomDurabilityOperationAllowed(room, 'rematch');

      // Both tournament systems: a rematch would start a fresh game in a room
      // whose bracket/league match is already finished, floating free of it.
      // Previously only the legacy league (`config.tournamentId`) was blocked;
      // scheduled-tournament rooms slipped through. See HARDENING_PLAN.md T-12.
      if (isAnyTournamentRoom(room)) {
        return cb?.({ ok: false, error: 'Rematch is unavailable in tournament rooms.' });
      }
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!room.players.includes(playerSeatId)) {
        return cb?.({ ok: false, error: 'Only room players can request rematch.' });
      }
      if (!room.state) {
        return cb?.({ ok: false, error: 'Game not started.' });
      }
      if (!room.state.gameOver) {
        return cb?.({ ok: false, error: 'Rematch is only available after game over.' });
      }

      room.rematchReady.add(playerSeatId);
      appendRoomEvent(room, {
        type: 'rematch_requested',
        actorSocketId: socket.id,
        actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
        payload: {
          readyCount: room.rematchReady.size,
          requiredCount: room.players.length,
        },
      });
      emitRematchStatus(room.code);

      const bothReady =
        room.players.length === 2 && room.players.every((playerId) => room.rematchReady.has(playerId));
      if (!bothReady) {
        return cb?.({ ok: true, started: false });
      }

      // R1: wait for durable game-over persist before starting a new match.
      // Await before clearing rematchReady so a "still saving" rejection keeps both seats ready.
      const persistOutcome = await waitForActiveGameOverPersist(room.code);
      const liveRoom = getRoom(roomCode);
      if (liveRoom.gameOverPersistStatus === 'pending') {
        return cb?.({
          ok: false,
          error: MATCH_RESULT_STILL_SAVING_MESSAGE,
        });
      }
      if (
        persistOutcome === 'none' &&
        !liveRoom.matchLogged &&
        liveRoom.state?.gameOver &&
        (liveRoom.gameOverPersistStatus ?? 'idle') === 'idle'
      ) {
        return cb?.({
          ok: false,
          error: MATCH_RESULT_STILL_SAVING_MESSAGE,
        });
      }
      // succeeded | failed: rematch allowed (failed = give-up ceiling, not forever-blocked).

      room.rematchReady.clear();

      await withRoomGameplayLock(roomCode, async () => {
        const lockedRoom = getRoom(roomCode);
        lockedRoom.matchLogged = false;
        lockedRoom.gameOverPersistStatus = 'idle';
        lockedRoom.activeGameOverPersist = undefined;
        lockedRoom.leadTracker = {
          aId: lockedRoom.players[0],
          bId: lockedRoom.players[1],
          maxLeadA: 0,
          maxLeadB: 0,
        };
        try {
          await handlerDeps.persistRoomMatchLog(
            lockedRoom,
            lockedRoom.state?.gameOver ? 'completed' : 'abandoned',
          );
        } catch (error) {
          console.error('[room-match-logs] failed to archive room before rematch reset:', error);
        }
        resetRoomEventLog(lockedRoom);
        appendRoomEvent(lockedRoom, {
          type: 'rematch_started',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            players: [...lockedRoom.players],
          },
        });
        // Already holding gameplay lock — unlocked start avoids deadlock (M3).
        await initiatePregameDrawOrStartUnlocked(lockedRoom.code, io, { allowRestart: true });
      });

      const roomAfterRematch = getRoom(roomCode);
      // game:rematch:started MUST be emitted before broadcastStateUpdate so the
      // client resets its sequence watermark before the first state:update of
      // the new game arrives. If the order is reversed, a client whose watermark
      // is still at the old game's final sequence number will silently discard
      // the new game state as stale, leaving the board frozen.
      io.to(roomAfterRematch.code).emit('game:rematch:started', { roomCode: roomAfterRematch.code });
      broadcastStateUpdate(roomAfterRematch.code);
      emitRematchStatus(roomAfterRematch.code);
      clearGameActionIdempotencyForRoom(roomAfterRematch.code);
      emitMpAuthorityFunnel('private_rematch_started', {
        roomCode: roomAfterRematch.code,
        seatId: playerSeatId,
      });
      cb?.({ ok: true, started: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:pregame_draw_pick', (payload?: { slotId?: string }) => {
    const slotId = payload?.slotId;
    const roomCode = socket.data?.roomId;
    if (!slotId) return;
    if (!roomCode) return;

    withRoomGameplayLock(roomCode, async () => {
      const room = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      const preGameDraw = room.preGameDraw;
      if (!preGameDraw) return;
      if (preGameDraw.picks[playerSeatId] !== null) return;

      const slot = preGameDraw.tiles.find((t) => t.id === slotId);
      if (!slot || slot.outOfPlay || slot.revealed) {
        // A stale/duplicate click must not be converted into a different random
        // pick. Leave the draw unchanged so the client can keep the real board
        // state and the player can choose another visible tile.
        return;
      }
      // Record the pick
      slot.revealed = true;
      slot.pickedBy = playerSeatId;
      preGameDraw.picks[playerSeatId] = {
        slotId: slot.id,
        tile: slot.tile,
        pipSum: slot.tile.low + slot.tile.high,
      };

      const players = room.players;
      const opponentSeatId = players.find((id) => id !== playerSeatId) ?? '';
      const ownPick = preGameDraw.picks[playerSeatId];
      const oppPick = preGameDraw.picks[opponentSeatId];

      const bothPicked = ownPick !== null && oppPick !== null;

      if (bothPicked) {
        // Both have picked! Compare total pips, then the higher individual pip.
        const comparison = comparePregameDrawTiles(ownPick.tile, oppPick.tile);
        if (comparison === 0) {
          // It's a tie!
          preGameDraw.phase = 'showing-tie';
          broadcastStateUpdate(roomCode);

          // Schedule tie-hold redraw
          if (room.preGameDrawTimer) clearTimeout(room.preGameDrawTimer);
          room.preGameDrawTimer = setTimeout(() => {
            withRoomGameplayLock(roomCode, async () => {
              const innerRoom = getRoom(roomCode);
              const innerDraw = innerRoom.preGameDraw;
              if (!innerDraw || innerDraw.phase !== 'showing-tie') return;

              // Eliminate the 2 picked tiles
              innerDraw.tiles.forEach((t) => {
                if (t.revealed) {
                  t.outOfPlay = true;
                  t.revealed = false;
                }
              });
              innerDraw.picks = Object.fromEntries(innerRoom.players.map((pid) => [pid, null]));
              innerDraw.phase = 'pick-player';
              broadcastStateUpdate(roomCode);
            });
          }, 800);
        } else {
          // We have a winner!
          const winnerSeatId = comparison > 0 ? playerSeatId : opponentSeatId;
          preGameDraw.winnerId = winnerSeatId;
          preGameDraw.phase = 'showing-reveal';
          broadcastStateUpdate(roomCode);

          // Stagger timeouts to resolved then done/startGame
          if (room.preGameDrawTimer) clearTimeout(room.preGameDrawTimer);
          room.preGameDrawTimer = setTimeout(() => {
            withRoomGameplayLock(roomCode, async () => {
              const innerRoom = getRoom(roomCode);
              const innerDraw = innerRoom.preGameDraw;
              if (!innerDraw || innerDraw.phase !== 'showing-reveal') return;

              innerDraw.phase = 'showing-result';
              broadcastStateUpdate(roomCode);

              if (innerRoom.preGameDrawTimer) clearTimeout(innerRoom.preGameDrawTimer);
              innerRoom.preGameDrawTimer = setTimeout(() => {
                withRoomGameplayLock(roomCode, async () => {
                  const finalRoom = getRoom(roomCode);
                  const finalDraw = finalRoom.preGameDraw;
                  if (!finalDraw || finalDraw.phase !== 'showing-result') return;

                  // All tiles still in play (tie rounds mark eliminated picks as outOfPlay).
                  const fullDeck = finalDraw.tiles
                    .filter((t) => !t.outOfPlay)
                    .map((t) => t.tile);

                  // Clear preGameDraw properties before starting game to avoid loops
                  if (finalRoom.preGameDrawTimer) {
                    clearTimeout(finalRoom.preGameDrawTimer);
                    finalRoom.preGameDrawTimer = null;
                  }
                  finalRoom.preGameDraw = null;

                  // Already holding gameplay lock — unlocked start avoids deadlock (M3).
                  await startGameUnlocked(roomCode, io, {
                    customDeck: fullDeck,
                    startingPlayerId: winnerSeatId,
                    allowRestart: true,
                  });
                  broadcastStateUpdate(roomCode);
                });
              }, 1000);
            });
          }, 2000);
        }
      } else {
        // Only one player picked, wait for opponent
        preGameDraw.phase = 'pick-opponent';
        broadcastStateUpdate(roomCode);
      }
    });
  });
}
