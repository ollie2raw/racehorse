import type { Socket } from 'socket.io';
import { childLogger } from '../logger';
import { getRoomCanDraw, getRoomLegalMoves, peekRoom, type ActionPayload, type Room } from '../rooms';
import { roomKind } from './roomKind';
import { tournamentMaxMissedTurns, tournamentTurnTimeoutMs } from '../scheduledTournament/tournamentTimeouts';

const log = childLogger('tournament:turn-clock');

/**
 * Server-authoritative turn clock for scheduled-tournament rooms only.
 *
 * Armed when the game is waiting on a human's decision: a tournament room, a
 * game in progress (not pre-game draw, hand over, game over or abandoned), and
 * the current seat is not Fritz. One entry per room; its `turnKey`
 * (match, hand, state sequence, seat) names the exact decision it is timing.
 *
 * On timeout the turn is played through the same path a Fritz turn uses
 * (`performAutomaticSeatAction` → `act()` → `broadcastStateUpdate`): draw if
 * the rules require a draw, otherwise the first legal play, otherwise pass,
 * repeated until the turn has moved on. That counts as one missed turn. The
 * TOURNAMENT_MAX_MISSED_TURNS-th consecutive missed turn forfeits the match
 * through `applyActiveMatchForfeit` (reason `missed_turns`) instead.
 *
 * Stale callbacks: each arm gets a fresh token. A callback only acts if the
 * room's current entry still has its token AND the room's current turnKey is
 * the one it was armed for; anything else (a legal action, a new hand, a turn
 * change, a restore, match end, forfeit, room deletion) makes it a no-op.
 * Arming for the same turnKey again is a no-op, so the many callers
 * (broadcasts, restore, recovery) can converge without duplicate timers.
 */

type ClockEntry = {
  token: number;
  turnKey: string;
  seatId: string;
  timer: ReturnType<typeof setTimeout>;
  /** The timeout acted on this turn (so its end is not a human action). */
  fired: boolean;
};

const entriesByRoom = new Map<string, ClockEntry>();
const missedTurnsByRoom = new Map<string, Map<string, number>>();
/** Rooms whose clock is currently playing a timed-out turn. */
const autoActingRooms = new Set<string>();
let nextToken = 1;

/** Upper bound on automatic actions for one timed-out turn (draws can repeat). */
const MAX_AUTO_ACTIONS_PER_TURN = 8;

function isBotSeat(seatId: string | null | undefined): boolean {
  return typeof seatId === 'string' && seatId.startsWith('bot:fritz:');
}

/** The human decision this room is waiting on, or null. */
function awaitedHumanTurn(room: Room | undefined): { seatId: string; turnKey: string } | null {
  if (!room || roomKind(room) !== 'scheduled_tournament') return null;
  const state = room.state;
  if (!state || state.gameOver || state.handOver) return null;
  if (room.preGameDraw || room.abandonedAt) return null;
  const seatId = state.playerIds[state.currentPlayerIndex];
  if (!seatId || isBotSeat(seatId)) return null;
  return { seatId, turnKey: `${room.matchId}|${state.handNumber}|${state.sequence}|${seatId}` };
}

function clearEntry(roomCode: string, entry: ClockEntry): void {
  clearTimeout(entry.timer);
  if (entriesByRoom.get(roomCode) === entry) entriesByRoom.delete(roomCode);
}

function resetMissedTurns(roomCode: string, seatId: string): void {
  missedTurnsByRoom.get(roomCode)?.delete(seatId);
}

/** The turn this room's clock is currently timing, if any (tests, diagnostics). */
export function getArmedTournamentTurn(roomCode: string): { seatId: string; turnKey: string } | null {
  const entry = entriesByRoom.get(roomCode.trim().toUpperCase());
  return entry ? { seatId: entry.seatId, turnKey: entry.turnKey } : null;
}

/** Consecutive missed turns for this seat (tests, diagnostics). */
export function getTournamentMissedTurns(roomCode: string, seatId: string): number {
  return missedTurnsByRoom.get(roomCode.trim().toUpperCase())?.get(seatId) ?? 0;
}

/**
 * Bring the room's clock in line with its current state: arm, re-arm, or
 * clear. Called after every state broadcast and after a room is restored.
 * Idempotent per turn.
 */
export function syncTournamentTurnClock(roomCode: string): void {
  const code = roomCode.trim().toUpperCase();
  const room = peekRoom(code);
  const awaited = awaitedHumanTurn(room);
  const existing = entriesByRoom.get(code);
  if (existing && awaited && existing.turnKey === awaited.turnKey) return;
  if (existing) {
    clearEntry(code, existing);
    // That turn ended without the clock acting: the player acted themselves.
    if (!existing.fired && !autoActingRooms.has(code)) resetMissedTurns(code, existing.seatId);
  }
  if (!awaited) {
    if (!room || room.state?.gameOver || room.abandonedAt) missedTurnsByRoom.delete(code);
    return;
  }
  const token = nextToken++;
  const entry: ClockEntry = {
    token,
    turnKey: awaited.turnKey,
    seatId: awaited.seatId,
    fired: false,
    timer: setTimeout(() => {
      void onTurnTimeout(code, token).catch((err) => {
        log.error({ err, roomCode: code }, 'turn timeout handling failed');
      });
    }, tournamentTurnTimeoutMs()),
  };
  entriesByRoom.set(code, entry);
}

/** Stop timing this room (match finished, room latched or removed). */
export function disarmTournamentTurnClock(roomCode: string): void {
  const code = roomCode.trim().toUpperCase();
  const existing = entriesByRoom.get(code);
  if (existing) clearEntry(code, existing);
  missedTurnsByRoom.delete(code);
}

function automaticAction(roomCode: string, seatId: string): ActionPayload {
  if (getRoomCanDraw(roomCode, seatId)) return { type: 'DRAW' };
  const play = getRoomLegalMoves(roomCode, seatId).find((move) => move.type === 'play');
  if (play && play.type === 'play') {
    return { type: 'MOVE', move: { tile: play.tile, position: play.position } };
  }
  return { type: 'PASS' };
}

async function onTurnTimeout(roomCode: string, token: number): Promise<void> {
  const entry = entriesByRoom.get(roomCode);
  if (!entry || entry.token !== token) return;
  const awaited = awaitedHumanTurn(peekRoom(roomCode));
  if (!awaited || awaited.turnKey !== entry.turnKey) {
    clearEntry(roomCode, entry);
    return;
  }
  entry.fired = true;
  const seatId = entry.seatId;
  const seatCounts = missedTurnsByRoom.get(roomCode) ?? new Map<string, number>();
  missedTurnsByRoom.set(roomCode, seatCounts);
  const missed = (seatCounts.get(seatId) ?? 0) + 1;
  seatCounts.set(seatId, missed);
  const { performAutomaticSeatAction } = await import('./roomSession');

  if (missed >= tournamentMaxMissedTurns()) {
    clearEntry(roomCode, entry);
    log.info({ roomCode, seatId, missed }, 'tournament turn timeouts reached the limit; forfeiting');
    await forfeitForMissedTurns(roomCode, seatId);
    return;
  }

  log.info({ roomCode, seatId, missed }, 'tournament turn timed out; playing it automatically');
  const handNumber = peekRoom(roomCode)?.state?.handNumber;
  autoActingRooms.add(roomCode);
  try {
    for (let i = 0; i < MAX_AUTO_ACTIONS_PER_TURN; i += 1) {
      const room = peekRoom(roomCode);
      const current = awaitedHumanTurn(room);
      if (!current || current.seatId !== seatId || room?.state?.handNumber !== handNumber) break;
      await performAutomaticSeatAction(roomCode, seatId, automaticAction(roomCode, seatId));
    }
  } finally {
    autoActingRooms.delete(roomCode);
  }
  syncTournamentTurnClock(roomCode);
}

async function forfeitForMissedTurns(roomCode: string, seatId: string): Promise<void> {
  const { getRoomRoster, getRoomPlayersWithFallback, broadcastStateUpdate } = await import('./roomSession');
  const { applyActiveMatchForfeit } = await import('./roomForfeit');
  const room = peekRoom(roomCode);
  if (!room) return;
  const rosterCached = getRoomRoster(roomCode);
  const roster = rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(roomCode, room.players);
  const player = roster.find((p) => p.id === seatId) ?? { id: seatId, socketId: '', username: 'Player', userId: null };
  // Same shape the disconnect-timeout forfeit uses (disconnectGrace.ts).
  const actingSocket = {
    id: player.socketId || '',
    data: { userId: player.userId, username: player.username },
  } as unknown as Socket;
  const { requireIo } = await import('./roomSession');
  await applyActiveMatchForfeit(requireIo(), actingSocket, roomCode, player, 'missed_turns');
  missedTurnsByRoom.delete(roomCode);
  if (peekRoom(roomCode)?.state) broadcastStateUpdate(roomCode);
}

/** Test-only. */
export function resetTournamentTurnClockForTests(): void {
  for (const entry of entriesByRoom.values()) clearTimeout(entry.timer);
  entriesByRoom.clear();
  missedTurnsByRoom.clear();
  autoActingRooms.clear();
}
