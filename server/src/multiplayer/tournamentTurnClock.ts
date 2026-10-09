import type { Socket } from 'socket.io';
import { childLogger } from '../logger';
import {
  getRoomCanDraw,
  getRoomLegalMoves,
  peekRoom,
  readyForNextHand,
  type ActionPayload,
  type ActStateAfter,
  type Room,
} from '../rooms';
import { roomKind } from './roomKind';
import { withRoomGameplayLock } from './roomGameplayLock';
import { tournamentMaxMissedTurns, tournamentTurnTimeoutMs } from '../scheduledTournament/tournamentTimeouts';
import { alertTournamentAnomaly } from '../scheduledTournament/tournamentAlerts';
import { withServerNow } from '../scheduledTournament/serverNow';

const log = childLogger('tournament:turn-clock');

/**
 * Server-authoritative clock for scheduled-tournament rooms only. It times the
 * one human decision a room is waiting on:
 *
 *  - `turn`: a game in progress (not pre-game draw, hand over, game over or
 *    abandoned) whose current seat is human. On timeout the turn is played
 *    through the path a Fritz turn uses (`performAutomaticSeatAction` → `act()`
 *    → broadcast): draw if the rules require it, else the first legal play,
 *    else pass, continuing only while the same turn continues (after a draw,
 *    or after a play that earns an extra turn). That is one missed turn; the
 *    TOURNAMENT_MAX_MISSED_TURNS-th consecutive one forfeits the match through
 *    `applyActiveMatchForfeit` (reason `missed_turns`) instead. A logical turn
 *    counts at most once: if the server cannot complete it (every action
 *    rejected, no progress, action bound), it alerts and retries on a fresh
 *    timer without counting again.
 *  - `next_hand`: a hand is over and a human has not readied for the next. On
 *    timeout the missing humans are readied through `readyForNextHand`, as
 *    Fritz is. Not a missed turn.
 *
 * Each arm gets a token and a decision key (match, hand, state sequence, seat
 * or `next_hand`). Every destructive step re-checks, inside the room's gameplay
 * lock and immediately before acting, that the same room object still waits
 * on the same decision (and, for the first step, that the timer is still the
 * room's current one). A player action, a new hand, a turn change, a restore,
 * match end, forfeit or room replacement in between makes the timeout a
 * no-op. Re-arming for the same key is a no-op, so broadcasts, restore and
 * recovery can converge without duplicate timers.
 */

type DecisionKind = 'turn' | 'next_hand';

type Decision = { kind: DecisionKind; seatId: string; turnKey: string };

type ClockEntry = Decision & {
  token: number;
  timer: ReturnType<typeof setTimeout>;
  /** When this timer fires (server clock, ms): what clients count down to. */
  deadlineAtMs: number;
  /** The timeout acted on this decision (so its end is not a player action). */
  fired: boolean;
};

const entriesByRoom = new Map<string, ClockEntry>();
const missedTurnsByRoom = new Map<string, Map<string, number>>();
/**
 * The logical turn that last added a missed turn, per room. A logical turn is
 * one seat's uninterrupted run of decisions in a hand (its sequence changes as
 * the clock draws or takes an extra turn). It counts once, however many times
 * the server has to retry it.
 */
const countedTurnByRoom = new Map<string, { seatId: string; handNumber: number; sequence: number }>();
/** Rooms whose clock is currently playing a timed-out turn. */
const autoActingRooms = new Set<string>();
/** Timeout handlers still running (test seam: settleTournamentTurnClockForTests). */
const inFlightTimeouts = new Set<Promise<void>>();
let nextToken = 1;
type AutomaticSeatAction = typeof import('./roomSession').performAutomaticSeatAction;
/** Test seam: replaces the automatic action (bound and progress tests). */
let automaticSeatActionOverride: AutomaticSeatAction | null = null;

function isBotSeat(seatId: string | null | undefined): boolean {
  return typeof seatId === 'string' && seatId.startsWith('bot:fritz:');
}

function turnKeyOf(matchId: string, handNumber: number, sequence: number, seatId: string): string {
  return `${matchId}|${handNumber}|${sequence}|${seatId}`;
}

/** The human decision this room is waiting on, or null. */
function awaitedDecision(room: Room | undefined): Decision | null {
  if (!room || roomKind(room) !== 'scheduled_tournament') return null;
  const state = room.state;
  if (!state || state.gameOver || room.preGameDraw || room.abandonedAt) return null;
  if (state.handOver) {
    const waiting = room.players.some((seatId) => !isBotSeat(seatId) && !room.nextHandReady.has(seatId));
    return waiting ? { kind: 'next_hand', seatId: '', turnKey: `${room.matchId}|${state.handNumber}|next_hand` } : null;
  }
  const seatId = state.playerIds[state.currentPlayerIndex];
  if (!seatId || isBotSeat(seatId)) return null;
  return { kind: 'turn', seatId, turnKey: turnKeyOf(room.matchId, state.handNumber, state.sequence, seatId) };
}

function clearEntry(roomCode: string, entry: ClockEntry): void {
  clearTimeout(entry.timer);
  if (entriesByRoom.get(roomCode) === entry) entriesByRoom.delete(roomCode);
}

function resetMissedTurns(roomCode: string, seatId: string): void {
  missedTurnsByRoom.get(roomCode)?.delete(seatId);
}

function forgetMissedTurns(roomCode: string): void {
  missedTurnsByRoom.delete(roomCode);
  countedTurnByRoom.delete(roomCode);
}

/**
 * Has this seat's current turn already added a missed turn? Yes if it is the
 * same seat and hand and either nothing has happened since (same sequence) or
 * only the seat's own continuation has (no pass since). Any other seat's turn in
 * between clears the record (syncTournamentTurnClock), so a later turn counts.
 */
function isCountedTurn(roomCode: string, room: Room, seatId: string): boolean {
  const counted = countedTurnByRoom.get(roomCode);
  const state = room.state;
  if (!counted || !state || counted.seatId !== seatId || counted.handNumber !== state.handNumber) return false;
  return state.sequence === counted.sequence || state.consecutivePasses === 0;
}

/** The decision this room's clock is currently timing, if any (tests, diagnostics). */
export function getArmedTournamentTurn(roomCode: string): { seatId: string; turnKey: string; kind: DecisionKind } | null {
  const entry = entriesByRoom.get(roomCode.trim().toUpperCase());
  return entry ? { seatId: entry.seatId, turnKey: entry.turnKey, kind: entry.kind } : null;
}

/**
 * The decision a tournament room's clock is timing, for clients (display
 * only — the server timer is authoritative). `deadlineAt` is when the timer
 * fires. A restored room gets a fresh deadline (the remaining time is not
 * persisted). Null when nothing is being timed (a Fritz turn, the hand or game
 * over, pre-game, an abandoned room, or not a tournament room).
 */
export type TournamentClockState =
  | {
      kind: 'turn';
      /** The human seat whose turn it is. */
      seatId: string;
      deadlineAt: string;
      /** That seat's consecutive missed turns so far. */
      missedTurns: number;
      /** The missed turn that forfeits the match. */
      maxMissedTurns: number;
    }
  | {
      /** Between hands: humans not yet readied are readied at the deadline (not a missed turn). */
      kind: 'next_hand';
      seatId: null;
      waitingSeatIds: string[];
      deadlineAt: string;
    };

export function getTournamentClockState(roomCode: string): TournamentClockState | null {
  const code = roomCode.trim().toUpperCase();
  const entry = entriesByRoom.get(code);
  if (!entry) return null;
  const deadlineAt = new Date(entry.deadlineAtMs).toISOString();
  if (entry.kind === 'turn') {
    return {
      kind: 'turn',
      seatId: entry.seatId,
      deadlineAt,
      missedTurns: getTournamentMissedTurns(code, entry.seatId),
      maxMissedTurns: tournamentMaxMissedTurns(),
    };
  }
  const room = peekRoom(code);
  const waitingSeatIds = room ? room.players.filter((seatId) => !isBotSeat(seatId) && !room.nextHandReady.has(seatId)) : [];
  return { kind: 'next_hand', seatId: null, waitingSeatIds, deadlineAt };
}

/** Consecutive missed turns for this seat (tests, diagnostics). */
export function getTournamentMissedTurns(roomCode: string, seatId: string): number {
  return missedTurnsByRoom.get(roomCode.trim().toUpperCase())?.get(seatId) ?? 0;
}

/**
 * Bring the room's clock in line with its current state: arm, re-arm, or
 * clear. Called after every state broadcast and after a room is restored.
 * Idempotent per decision.
 */
export function syncTournamentTurnClock(roomCode: string): void {
  const code = roomCode.trim().toUpperCase();
  const room = peekRoom(code);
  const awaited = awaitedDecision(room);
  const counted = countedTurnByRoom.get(code);
  if (counted && (awaited?.kind !== 'turn' || awaited.seatId !== counted.seatId || !isCountedTurn(code, room!, counted.seatId))) {
    // Someone else's turn (or a hand break) came in between: that turn is over.
    countedTurnByRoom.delete(code);
  }
  const existing = entriesByRoom.get(code);
  if (existing && awaited && existing.turnKey === awaited.turnKey) return;
  if (existing) {
    clearEntry(code, existing);
    // A turn that ended without the clock acting: the player acted themselves.
    if (existing.kind === 'turn' && !existing.fired && !autoActingRooms.has(code)) {
      resetMissedTurns(code, existing.seatId);
    }
  }
  if (!awaited) {
    if (!room || room.state?.gameOver || room.abandonedAt) forgetMissedTurns(code);
    return;
  }
  const token = nextToken++;
  const timeoutMs = tournamentTurnTimeoutMs();
  const entry: ClockEntry = {
    ...awaited,
    token,
    fired: false,
    deadlineAtMs: Date.now() + timeoutMs,
    timer: setTimeout(() => {
      const run = onTimeout(code, token)
        .catch((err) => {
          log.error({ err, roomCode: code }, 'tournament clock timeout handling failed');
        })
        .finally(() => inFlightTimeouts.delete(run));
      inFlightTimeouts.add(run);
    }, timeoutMs),
  };
  entriesByRoom.set(code, entry);
}

/** Stop timing this room (match finished, room latched or removed). */
export function disarmTournamentTurnClock(roomCode: string): void {
  const code = roomCode.trim().toUpperCase();
  const existing = entriesByRoom.get(code);
  if (existing) clearEntry(code, existing);
  forgetMissedTurns(code);
}

/**
 * The automatic action, in order of preference: draw if the rules require it,
 * else each legal play in turn, else pass. Later candidates are only tried if
 * the room rejects an earlier one.
 */
function automaticActionCandidates(roomCode: string, seatId: string): ActionPayload[] {
  if (getRoomCanDraw(roomCode, seatId)) return [{ type: 'DRAW' }];
  const plays: ActionPayload[] = [];
  for (const move of getRoomLegalMoves(roomCode, seatId)) {
    if (move.type === 'play') plays.push({ type: 'MOVE', move: { tile: move.tile, position: move.position } });
  }
  return plays.length > 0 ? plays : [{ type: 'PASS' }];
}

/**
 * Does the same turn continue after this automatic action? After a DRAW (which
 * draws until a play exists, or passes if the boneyard is locked) the same
 * decision is still open; after a play it continues only on an extra turn (a
 * scoring play or a double), which leaves the seat to move with no pass since.
 * A pass, a turn change, a hand end or game end closes it.
 */
function turnContinues(action: ActionPayload, after: ActStateAfter, seatId: string, handNumber: number): boolean {
  if (after.gameOver || after.handOver) return false;
  if (after.currentSeatId !== seatId || after.handNumber !== handNumber) return false;
  if (action.type === 'DRAW') return true;
  return action.type === 'MOVE' && after.consecutivePasses === 0;
}

async function onTimeout(roomCode: string, token: number): Promise<void> {
  const entry = entriesByRoom.get(roomCode);
  if (!entry || entry.token !== token) return;
  const room = peekRoom(roomCode);
  const awaited = awaitedDecision(room);
  if (!room || !awaited || awaited.turnKey !== entry.turnKey) {
    clearEntry(roomCode, entry);
    return;
  }
  if (entry.kind === 'next_hand') {
    await readyMissingHumans(roomCode, room, entry);
    return;
  }
  await playTimedOutTurn(roomCode, room, entry);
}

/**
 * Still the same decision the timer was armed for? `room` must be the very
 * object the timer saw (a removed and re-created room is a different one).
 */
function stillAwaiting(roomCode: string, room: Room, turnKey: string, token: number | null): boolean {
  if (peekRoom(roomCode) !== room) return false;
  if (token !== null && entriesByRoom.get(roomCode)?.token !== token) return false;
  return awaitedDecision(room)?.turnKey === turnKey;
}

async function playTimedOutTurn(roomCode: string, room: Room, entry: ClockEntry): Promise<void> {
  const performAutomaticSeatAction =
    automaticSeatActionOverride ?? (await import('./roomSession')).performAutomaticSeatAction;
  const seatId = entry.seatId;
  // A retry of a turn that already counted (the server could not complete it
  // last time) adds nothing and cannot forfeit.
  const counts = !isCountedTurn(roomCode, room, seatId);
  const missed = getTournamentMissedTurns(roomCode, seatId) + (counts ? 1 : 0);
  /** Called inside the gameplay lock, immediately before the first automatic action. */
  const commitMiss = () => {
    entry.fired = true;
    if (isCountedTurn(roomCode, room, seatId)) return;
    const seatCounts = missedTurnsByRoom.get(roomCode) ?? new Map<string, number>();
    missedTurnsByRoom.set(roomCode, seatCounts);
    seatCounts.set(seatId, (seatCounts.get(seatId) ?? 0) + 1);
    countedTurnByRoom.set(roomCode, { seatId, handNumber: room.state!.handNumber, sequence: room.state!.sequence });
  };

  if (counts && missed >= tournamentMaxMissedTurns()) {
    await forfeitIfStillAwaiting(roomCode, room, entry, commitMiss);
    return;
  }

  const startState = room.state!;
  const handNumber = startState.handNumber;
  // Every action strictly advances the state and consumes a hand tile (play) or
  // boneyard tiles (draw), so a turn cannot need more than this.
  const maxActions = 2 * ((startState.players[seatId]?.hand.length ?? 0) + startState.boneyard.length) + 2;
  let expectedKey = entry.turnKey;
  let lastSequence = startState.sequence;
  let first = true;
  /** The server could not complete the turn: alerted; the turn gets a fresh timer (a retry, not a new miss). */
  let failed = false;
  autoActingRooms.add(roomCode);
  try {
    for (let i = 0; ; i += 1) {
      if (i >= maxActions) {
        alertTournamentAnomaly('turn_clock_action_bound_exceeded', { tournamentId: room.scheduledTournamentId, matchId: room.scheduledTournamentMatchId, roomCode }, { seatId, maxActions });
        failed = true;
        break;
      }
      const keyForThisStep = expectedKey;
      const checkToken = first ? entry.token : null;
      let action: ActionPayload | null = null;
      let outcome: ActStateAfter | null = null;
      let rejected = 0;
      for (let attempt = 0; ; attempt += 1) {
        action = null;
        try {
          outcome = await performAutomaticSeatAction(roomCode, seatId, (current) => {
            if (current !== room || !stillAwaiting(roomCode, room, keyForThisStep, checkToken)) return null;
            const candidate = automaticActionCandidates(roomCode, seatId)[attempt];
            if (!candidate) return null;
            if (first) commitMiss();
            action = candidate;
            return candidate;
          });
          break;
        } catch (err) {
          // The room refused this action; try the next candidate.
          rejected += 1;
          log.warn({ err, roomCode, seatId, action }, 'automatic action rejected by the room; trying the next one');
        }
      }
      if (!outcome || !action) {
        if (rejected > 0 && stillAwaiting(roomCode, room, keyForThisStep, null)) {
          // Every candidate was refused: say so loudly and retry on a fresh timer
          // rather than strand the turn.
          alertTournamentAnomaly('turn_clock_action_failed', { tournamentId: room.scheduledTournamentId, matchId: room.scheduledTournamentMatchId, roomCode }, { seatId, rejected });
          failed = true;
        } else if (first) {
          log.info({ roomCode, seatId }, 'turn timeout superseded before it acted; no action');
        }
        break;
      }
      const applied: ActionPayload = action;
      first = false;
      if (outcome.sequence <= lastSequence) {
        alertTournamentAnomaly('turn_clock_no_progress', { tournamentId: room.scheduledTournamentId, matchId: room.scheduledTournamentMatchId, roomCode }, { seatId, sequence: outcome.sequence });
        failed = true;
        break;
      }
      lastSequence = outcome.sequence;
      if (!turnContinues(applied, outcome, seatId, handNumber)) break;
      expectedKey = turnKeyOf(room.matchId, outcome.handNumber, outcome.sequence, seatId);
    }
  } finally {
    autoActingRooms.delete(roomCode);
  }
  if (failed) {
    // Still this seat's (already counted) turn: drop the spent timer so the
    // sync below arms a fresh one. The match cap bounds the retries.
    const current = entriesByRoom.get(roomCode);
    if (current && current.kind === 'turn' && current.seatId === seatId) clearEntry(roomCode, current);
  } else if (!first) {
    log.info({ roomCode, seatId, missed: getTournamentMissedTurns(roomCode, seatId) }, 'tournament turn timed out; played it automatically');
  }
  syncTournamentTurnClock(roomCode);
  if (failed) {
    // Re-armed without a state broadcast: tell the room the new deadline.
    const { requireIo } = await import('./roomSession');
    requireIo().to(roomCode).emit('tournament:clock', withServerNow({ roomCode, tournamentClock: getTournamentClockState(roomCode) }));
  }
}

async function forfeitIfStillAwaiting(
  roomCode: string,
  room: Room,
  entry: ClockEntry,
  commitMiss: () => void,
): Promise<void> {
  const { getRoomRoster, getRoomPlayersWithFallback, broadcastStateUpdate, requireIo } = await import('./roomSession');
  const { applyActiveMatchForfeit } = await import('./roomForfeit');
  const rosterCached = getRoomRoster(roomCode);
  const roster = rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(roomCode, room.players);
  const player = roster.find((p) => p.id === entry.seatId) ?? { id: entry.seatId, socketId: '', username: 'Player', userId: null };
  // Same shape the disconnect-timeout forfeit uses (disconnectGrace.ts).
  const actingSocket = {
    id: player.socketId || '',
    data: { userId: player.userId, username: player.username },
  } as unknown as Socket;

  // Decide and start the forfeit inside the gameplay lock: a player action
  // queued ahead of us wins, and once started the forfeit's synchronous prefix
  // marks the room forfeit-pending, which refuses any later action.
  let forfeit: Promise<unknown> | null = null;
  await withRoomGameplayLock(roomCode, async () => {
    if (!stillAwaiting(roomCode, room, entry.turnKey, entry.token)) return;
    commitMiss();
    clearEntry(roomCode, entry);
    forfeit = applyActiveMatchForfeit(requireIo(), actingSocket, roomCode, player, 'missed_turns');
  });
  if (!forfeit) {
    log.info({ roomCode, seatId: entry.seatId }, 'missed-turn forfeit superseded before it started; no forfeit');
    return;
  }
  log.info({ roomCode, seatId: entry.seatId }, 'tournament turn timeouts reached the limit; forfeited');
  await forfeit;
  forgetMissedTurns(roomCode);
  if (peekRoom(roomCode)?.state) broadcastStateUpdate(roomCode);
}

async function readyMissingHumans(roomCode: string, room: Room, entry: ClockEntry): Promise<void> {
  const { broadcastStateUpdate, requireIo } = await import('./roomSession');
  if (!stillAwaiting(roomCode, room, entry.turnKey, entry.token)) return;
  entry.fired = true;
  const handNumber = room.state!.handNumber;
  const missing = room.players.filter((seatId) => !isBotSeat(seatId) && !room.nextHandReady.has(seatId));
  log.info({ roomCode, seats: missing, handNumber }, 'next-hand readiness timed out; readying automatically');
  for (const seatId of missing) {
    if (peekRoom(roomCode) !== room || room.abandonedAt) return;
    // handNumber pins it to this hand: readyForNextHand ignores a stale hand.
    const result = await readyForNextHand(roomCode, seatId, requireIo(), handNumber, (code) => broadcastStateUpdate(code));
    if (result.started) broadcastStateUpdate(roomCode);
  }
}

/** Test seam: wait for timeout handlers already running to finish. */
export async function settleTournamentTurnClockForTests(): Promise<void> {
  while (inFlightTimeouts.size > 0) {
    await Promise.all([...inFlightTimeouts]);
  }
}

/** Test-only: replace the automatic action (null restores the real one). */
export function setTournamentAutomaticActionForTests(fn: AutomaticSeatAction | null): void {
  automaticSeatActionOverride = fn;
}

/** Test-only. */
export function resetTournamentTurnClockForTests(): void {
  for (const entry of entriesByRoom.values()) clearTimeout(entry.timer);
  entriesByRoom.clear();
  missedTurnsByRoom.clear();
  countedTurnByRoom.clear();
  autoActingRooms.clear();
  inFlightTimeouts.clear();
  automaticSeatActionOverride = null;
}
