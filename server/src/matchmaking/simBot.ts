import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import type { QueuedPlayer } from './types';
import { act, getRoom, getRoomLegalMoves, type ActionPayload } from '../rooms';

const DEV_MODE_FLAG = process.env.MATCHMAKING_DEV_MODE;
const DEV_MODE_DEFAULT = process.env.NODE_ENV !== 'production';
const SIM_JOIN_DELAY_MS = 5000;
const SIM_MOVE_MIN_MS = 700;
const SIM_MOVE_MAX_MS = 1500;
const SIM_MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes hard ceiling per match

export function devModeEnabled(): boolean {
  if (DEV_MODE_FLAG === '1') return true;
  if (DEV_MODE_FLAG === '0') return false;
  return DEV_MODE_DEFAULT;
}

export const SIM_TIMING = { SIM_JOIN_DELAY_MS, SIM_MOVE_MIN_MS, SIM_MOVE_MAX_MS };

/**
 * Build a synthetic queue entry that mirrors a real player's rating so the
 * pairing window always allows the match. The fake socketId is never
 * dispatched to real sockets; it exists purely to drive the room turn-state.
 */
export function makeSimPlayer(opponent: QueuedPlayer): QueuedPlayer {
  return {
    socketId: `sim:${randomUUID().slice(0, 8)}`,
    userId: `sim:${randomUUID()}`,
    username: 'Bot (sim)',
    rating: opponent.rating,
    joinedAtMs: Date.now(),
    isSim: true,
  };
}

/**
 * Schedule the sim opponent's first move and recurse on each turn.
 *
 * The sim plays a random legal move. If no plays are available, it draws
 * (which the engine treats as forced pass when the boneyard is locked).
 * Calls `onAfterAct(roomCode)` after each successful action so the caller
 * can broadcast state to real clients.
 */
export function startSimOpponentLoop(
  io: Server,
  roomCode: string,
  simSocketId: string,
  onAfterAct: (roomCode: string) => void,
): void {
  const startedAtMs = Date.now();

  const tick = async () => {
    if (Date.now() - startedAtMs > SIM_MAX_LIFETIME_MS) return;
    const room = getRoom(roomCode);
    if (!room || !room.state || room.state.gameOver) return;

    const currentPlayerId = room.state.playerIds[room.state.currentPlayerIndex];
    if (currentPlayerId !== simSocketId) {
      // Not the sim's turn — peek again shortly.
      setTimeout(() => { void tick(); }, 250);
      return;
    }

    try {
      const moves = getRoomLegalMoves(roomCode, simSocketId);
      let action: ActionPayload;
      if (!moves || moves.length === 0) {
        action = { type: 'DRAW' };
      } else {
        const plays = moves.filter((m) => m.type === 'play');
        if (plays.length === 0) {
          action = { type: 'PASS' };
        } else {
          const pick = plays[Math.floor(Math.random() * plays.length)];
          action = {
            type: 'MOVE',
            move: {
              tile: { high: pick.tile.high, low: pick.tile.low },
              position: pick.position,
            },
          };
        }
      }
      await act(roomCode, simSocketId, action, io, onAfterAct);
      onAfterAct(roomCode);
    } catch (err) {
      console.warn('[sim] action failed', err instanceof Error ? err.message : err);
    }

    const delay = SIM_MOVE_MIN_MS + Math.random() * (SIM_MOVE_MAX_MS - SIM_MOVE_MIN_MS);
    setTimeout(() => { void tick(); }, delay);
  };

  setTimeout(() => { void tick(); }, SIM_JOIN_DELAY_MS);
}
