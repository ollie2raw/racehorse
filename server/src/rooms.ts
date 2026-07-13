import { GameState, Config, PlacementPosition, Move, Tile, BoardState } from './game/types';
import { assertTileCountInvariant, assertValidGameState } from './game/invariants';
import { withRoomGameplayLock } from './multiplayer/roomGameplayLock';
import type { Server } from 'socket.io';
import {
  createInitialState,
  startNewHand,
  drawOne,
  applyMove,
  finalizeMandatoryAutoPasses,
  getLegalMoves,
  getOpenEnds,
  canDraw,
} from './game/engine';
import { drawAudit } from './multiplayer/drawAudit';
import { ServerPregameDrawState, initMultiplayerPregameDraw } from './multiplayer/preGameDraw';
import { computePlayScore, simulatePlacement } from './game/scoring';
import type { GhostMoveLogEntry } from './ghost/service';
import {
  appendRoomEvent,
  createRoomEventState,
  getRoomEventMeta,
  getRoomEventSnapshot,
  resetRoomEventLog,
  type RoomMatchEvent,
} from './roomEvents';
import {
  createInitialRoomDurabilityState,
  type RoomDurabilityState,
} from './multiplayer/roomDurability';
import { flushScheduledLiveRoomPersistence, isLiveRoomDurablyRecoverable } from './multiplayer/roomLivePersistence';
import { assertRoomDurabilityOperationAllowed } from './multiplayer/roomDurabilityPolicy';

export type RoomCode = string;

export type LeadTracker = {
  aId: string;
  bId: string;
  maxLeadA: number;
  maxLeadB: number;
};

export type Room = {
  code: RoomCode;
  /** Stable `playerSeatId` values in engine seat order (never socket ids). */
  players: string[];
  state: GameState | null; // null until game started
  config: Partial<Config>;
  asyncStateVersion: number;
  /** `playerSeatId` values ready for the next hand. */
  nextHandReady: Set<string>;
  /** `playerSeatId` values ready for rematch. */
  rematchReady: Set<string>;
  /** `playerSeatId` values that have acked listeners ready before the first deal is broadcast. */
  matchStartReady: Set<string>;
  lastHandEndedNotifiedHand: number | null;
  lastHandEndedAtMs: number | null;
  lastBroadcastScores: Record<string, number>;
  ghostMoveLogs: Record<string, GhostMoveLogEntry[]>;
  ghostTurnIndex: number;
  matchId: string;
  matchLogged: boolean;
  /** In-flight game-over persist for the current match; await before rematch reset. */
  activeGameOverPersist?: Promise<void>;
  leadTracker: LeadTracker | null;
  eventLogVersion: 1;
  eventSequence: number;
  events: RoomMatchEvent[];
  /** Set when room was created via matchmaking queue; used to update matchmaking_matches on game-end. */
  matchmakingMatchId?: string;
  /** Set when the room is a scheduled-tournament match; used to advance the bracket on game-end. */
  scheduledTournamentMatchId?: string;
  /** Parent tournament id (denormalized for cheap lookups during game-over). */
  scheduledTournamentId?: string;
  /** Fritz strength tier for synthetic scheduled-tournament bot seats. */
  scheduledTournamentBotTier?: 'standard' | 'elite' | 'master';
  /** Terminal intentional leave marker; abandoned rooms are not recoverable. */
  abandonedAt?: string;
  abandonedByUserId?: string | null;
  abandonedWinnerUserId?: string | null;
  abandonedReason?: 'forfeit' | 'abandon';
  /** One-shot metadata for the next `state:update` after resolving forced-draw steps (cleared after emit). */
  pendingForcedDrawBroadcast?: { playerId: string; count: number };
  /** One-shot: socket ids that auto-passed this resolution (cleared after `state:update`). */
  pendingAutoPassNotice?: string[];
  preGameDraw?: ServerPregameDrawState | null;
  preGameDrawTimer?: NodeJS.Timeout | null;
  disconnectExpiries?: Record<string, number>;
  /** Active tile pool size when pre-game draw eliminated tiles (default: full double-6 set). */
  activeTileSetSize?: number;
  durability: RoomDurabilityState;
};

export type DrawAnimationStep = {
  tile: Tile;
  boneyardCount: number;
  drawerHandCount: number;
};

type ResolveDrawUntilPlayableResult = {
  state: GameState;
  animationSteps: DrawAnimationStep[];
  stoppedReason: 'playable' | 'locked_pass';
  passed: boolean;
};

export type ActResult = {
  room: Room;
  forcedDrawAnimation?: {
    playerId: string;
    sequence: number;
    steps: DrawAnimationStep[];
    stoppedReason: 'playable' | 'locked_pass' | 'locked_no_pass';
    finalState: GameState;
  };
};

const rooms = new Map<RoomCode, Room>();
const nextHandStartsByRoom = new Map<RoomCode, Promise<Room>>();

let liveRoomPersistHook: ((room: Room) => void) | null = null;

/** Registered from `initRoomSession` to avoid a static import cycle with live persistence. */
export function registerLiveRoomPersistHook(hook: (room: Room) => void): void {
  liveRoomPersistHook = hook;
}

/** Test-only reset. */
export function resetLiveRoomPersistHookForTests(): void {
  liveRoomPersistHook = null;
}

function notifyLiveRoomStateCommitted(room: Room): void {
  liveRoomPersistHook?.(room);
}

async function flushCommittedRoomStateOrThrow(room: Room): Promise<void> {
  const result = await flushScheduledLiveRoomPersistence(room.code);
  if (!isLiveRoomDurablyRecoverable(room)) {
    throw new Error(
      room.durability.status === 'failed' || room.durability.status === 'degraded'
        ? 'room_persistence_failed'
        : 'room_snapshot_uncommitted',
    );
  }
  if (result.flushedRoomCodes.length > 0) {
    return;
  }
}
const MIN_HAND_OVER_MS = 2500;
const MP_DEBUG =
  process.env.NODE_ENV !== 'production' ||
  process.env.MP_DEBUG === '1' ||
  process.env.DEBUG_MP === '1';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function logMpDebug(scope: string, payload: Record<string, unknown>): void {
  if (!MP_DEBUG) return;
  console.log(`[${scope}]`, payload);
}

function normalizeTileKey(tile: Tile): string {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return `${low}|${high}`;
}

function serializeGhostBoardState(board: BoardState | null): string {
  if (!board) return 'board:empty';
  return JSON.stringify({
    mainLine: board.mainLine.map((placed) => ({
      tile: [placed.tile.low, placed.tile.high],
      orientation: placed.orientation,
    })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble,
    rightEndIsDouble: board.rightEndIsDouble,
    hubs: board.hubDoubles.map((hub, hubIndex) => ({
      hubId: hub.hubId ?? hub.tileIndex ?? hubIndex,
      laneType: hub.laneType ?? null,
      laneRef: hub.laneRef ?? null,
      branchDepth: hub.branchDepth ?? null,
      tileIndex: hub.tileIndex,
      mainlineIndex: hub.mainlineIndex ?? null,
      hubValue: hub.hubValue,
      leftSideFilled: Boolean(hub.leftSideFilled),
      rightSideFilled: Boolean(hub.rightSideFilled),
      isCrossed: Boolean(hub.isCrossed),
      branches: hub.branches.map((branch) =>
        branch
          ? {
              openEnd: branch.openEnd,
              openEndIsDouble: branch.openEndIsDouble,
              tiles: branch.tiles.map((placed) => ({
                tile: [placed.tile.low, placed.tile.high],
                orientation: placed.orientation,
              })),
            }
          : null,
      ),
    })),
  });
}

function appendGhostMove(room: Room, playerSeatId: string, entry: GhostMoveLogEntry): void {
  room.ghostMoveLogs[playerSeatId] = [...(room.ghostMoveLogs[playerSeatId] ?? []), entry];
}

function currentGhostTurn(room: Room): number {
  return room.ghostTurnIndex + 1;
}

function makeCode(len = 5): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

export function createRoom(hostPlayerSeatId: string, config: Partial<Config> = {}): Room {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const eventState = createRoomEventState();

  const room: Room = {
    code,
    players: [hostPlayerSeatId],
    state: null,
    config,
    asyncStateVersion: 0,
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    matchStartReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchLogged: false,
    leadTracker: null,
    abandonedAt: undefined,
    abandonedByUserId: null,
    abandonedWinnerUserId: null,
    abandonedReason: undefined,
    disconnectExpiries: {},
    ...eventState,
    durability: createInitialRoomDurabilityState({
      asyncStateVersion: 0,
      state: null,
      eventSequence: eventState.eventSequence,
    }),
  };
  appendRoomEvent(room, {
    type: 'room_created',
    payload: {
      hostPlayerSeatId,
      config,
    },
  });

  rooms.set(code, room);
  notifyLiveRoomStateCommitted(room);
  return room;
}

export function createReservedRoom(code: string, config: Partial<Config> = {}): Room {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('Room code is required.');
  }
  if (rooms.has(normalizedCode)) {
    return rooms.get(normalizedCode)!;
  }
  const eventState = createRoomEventState();

  const room: Room = {
    code: normalizedCode,
    players: [],
    state: null,
    config,
    asyncStateVersion: 0,
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    matchStartReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchLogged: false,
    leadTracker: null,
    disconnectExpiries: {},
    ...eventState,
    durability: createInitialRoomDurabilityState({
      asyncStateVersion: 0,
      state: null,
      eventSequence: eventState.eventSequence,
    }),
  };
  appendRoomEvent(room, {
    type: 'room_created',
    payload: {
      reserved: true,
      config,
    },
  });

  rooms.set(normalizedCode, room);
  notifyLiveRoomStateCommitted(room);
  return room;
}

export function joinRoom(code: string, playerSeatId: string): Room {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found.');
  if (room.abandonedAt) throw new Error('match_abandoned');

  if (!room.players.includes(playerSeatId)) {
    if (room.players.length >= 2) {
      throw new Error('Room is full (v1 supports 2 players).');
    }
    room.players.push(playerSeatId);
  }

  return room;
}

export function peekRoom(code: string): Room | undefined {
  const key = String(code ?? '').trim().toUpperCase();
  if (!key) return undefined;
  return rooms.get(key);
}

export function getRoom(code: string): Room {
  const room = peekRoom(code);
  if (!room) throw new Error('Room not found.');
  return room;
}

/** In-process stats for ops/debug endpoints (lost on process restart). */
export function getRoomRuntimeStats(): { roomCount: number; gamesInProgress: number } {
  let gamesInProgress = 0;
  for (const r of rooms.values()) {
    if (r.state && !r.state.gameOver) gamesInProgress += 1;
  }
  return { roomCount: rooms.size, gamesInProgress };
}

export function deleteRoom(code: string): boolean {
  return rooms.delete(code);
}

/** Clears in-memory room state between vitest cases (test environments only). */
export function resetRoomRuntimeForTests(): void {
  rooms.clear();
  nextHandStartsByRoom.clear();
}

function appendResolutionEvents(room: Room, previousState: GameState, actorSocketId: string): void {
  if (!room.state) return;
  if (!previousState.handOver && room.state.handOver) {
    room.lastHandEndedAtMs = Date.now();
    appendRoomEvent(room, {
      type: 'hand_ended',
      actorSocketId,
      payload: {
        handNumber: room.state.handNumber,
        winnerId: room.state.winnerId,
        gameOver: room.state.gameOver,
        scores: Object.fromEntries(
          room.state.playerIds.map((playerId) => [playerId, room.state?.players[playerId]?.score ?? 0]),
        ),
      },
    });
  }
  if (!previousState.gameOver && room.state.gameOver) {
    appendRoomEvent(room, {
      type: 'match_ended',
      actorSocketId,
      payload: {
        winnerId: room.state.winnerId,
        handNumber: room.state.handNumber,
        scores: Object.fromEntries(
          room.state.playerIds.map((playerId) => [playerId, room.state?.players[playerId]?.score ?? 0]),
        ),
      },
    });
  }
}

/** Draw chain entered only when the player cannot play; continues until playable or blocked. */
function resolveDrawUntilPlayableAtomically(
  state: GameState,
  playerId: string,
): ResolveDrawUntilPlayableResult {
  if (getLegalMoves(state, playerId).some((move) => move.type === 'play')) {
    throw new Error('Cannot draw while a legal play is available.');
  }

  let current = state;
  const animationSteps: DrawAnimationStep[] = [];

  while (getLegalMoves(current, playerId).every((move) => move.type !== 'play')) {
    const step = drawOne(current, playerId);
    if (!step.drew) {
      const passed = applyMove(current, playerId, { type: 'pass' }).state;
      return {
        state: passed,
        animationSteps,
        stoppedReason: 'locked_pass',
        passed: true,
      };
    }

    current = step.state;
    animationSteps.push({
      tile: step.drew,
      boneyardCount: current.boneyard.length,
      drawerHandCount: current.players[playerId]?.hand.length ?? 0,
    });

    if (getLegalMoves(current, playerId).some((move) => move.type === 'play')) {
      return {
        state: current,
        animationSteps,
        stoppedReason: 'playable',
        passed: false,
      };
    }
  }

  return {
    state: current,
    animationSteps,
    stoppedReason: 'playable',
    passed: false,
  };
}

type ResolveForcedDrawResult = {
  state: GameState;
  animationSteps: DrawAnimationStep[];
  stoppedReason: 'playable' | 'locked_pass' | 'locked_no_pass';
};

/**
 * Synchronously resolves a forced draw after MOVE. `stateAfterMove` already
 * contains `forcedTile` in the player's hand (applyMove put it there). This
 * function records the forced tile as the first animation step, then continues
 * drawing until the player has a legal play or the boneyard is exhausted.
 *
 * INVARIANT: all state mutations are complete before the function returns.
 */
function resolveForcedDrawAtomically(
  stateAfterMove: GameState,
  playerId: string,
  forcedTile: Tile,
): ResolveForcedDrawResult {
  let current = stateAfterMove;
  const animationSteps: DrawAnimationStep[] = [];

  // The forced tile is already in the player's hand — record it as step 0.
  animationSteps.push({
    tile: forcedTile,
    boneyardCount: current.boneyard.length,
    drawerHandCount: current.players[playerId]?.hand.length ?? 0,
  });

  // If the forced tile immediately gives a legal play, we're done.
  if (getLegalMoves(current, playerId).some((move) => move.type === 'play')) {
    return { state: current, animationSteps, stoppedReason: 'playable' };
  }

  // Keep drawing. Max iterations = initial boneyard size + 1 (safety ceiling;
  // the loop naturally exits when drawOne returns !drew).
  const maxIterations = stateAfterMove.boneyard.length + 1;
  for (let i = 0; i < maxIterations; i++) {
    // Do not bump sequence per physical draw tile — the aggregated MOVE (+ forced chain)
    // must advance sequence once overall (already bumped by applyMove for this action).
    const step = drawOne(current, playerId, false);
    if (!step.drew) {
      // Boneyard exhausted — forced auto-pass.
      const passed = applyMove(current, playerId, { type: 'pass' }).state;
      return { state: passed, animationSteps, stoppedReason: 'locked_pass' };
    }

    current = step.state;
    animationSteps.push({
      tile: step.drew,
      boneyardCount: current.boneyard.length,
      drawerHandCount: current.players[playerId]?.hand.length ?? 0,
    });

    if (getLegalMoves(current, playerId).some((move) => move.type === 'play')) {
      return { state: current, animationSteps, stoppedReason: 'playable' };
    }
  }

  // Safety fallback — should not be reached with correct boneyard logic.
  return { state: current, animationSteps, stoppedReason: 'locked_no_pass' };
}

export function isPregameDrawEligible(room: Room): boolean {
  if (room.config.skipPregameDraw) return false;
  const tilesPerPlayer = room.config.tilesPerPlayer ?? 7;
  return tilesPerPlayer === 7;
}

export function createPreGameDrawShellMatch(players: string[], config?: Partial<Config>): GameState {
  const state0 = createInitialState(players, config);
  return {
    ...state0,
    handOver: true,
  };
}

export async function initiatePregameDrawOrStart(
  code: string,
  io: Server,
  options: { allowRestart?: boolean } = {},
): Promise<Room> {
  const room = getRoom(code);
  assertRoomDurabilityOperationAllowed(room, 'match_start');
  if (!isPregameDrawEligible(room)) {
    return startGame(code, io, options);
  }

  if (room.preGameDrawTimer) {
    clearTimeout(room.preGameDrawTimer);
    room.preGameDrawTimer = null;
  }

  room.preGameDraw = initMultiplayerPregameDraw(room.players);
  room.state = createPreGameDrawShellMatch(room.players, room.config);
  room.matchStartReady.clear();
  room.rematchReady.clear();
  room.nextHandReady.clear();

  notifyLiveRoomStateCommitted(room);
  await flushCommittedRoomStateOrThrow(room);
  return room;
}

export async function startGame(
  code: string,
  io: Server,
  options: { allowRestart?: boolean; customDeck?: Tile[]; startingPlayerId?: string } = {},
): Promise<Room> {
  const room = getRoom(code);
  assertRoomDurabilityOperationAllowed(room, 'match_start');
  if (room.abandonedAt) {
    throw new Error('match_abandoned');
  }

  if (room.players.length !== 2) {
    throw new Error('Need exactly 2 players to start.');
  }

  if (room.state && !options.allowRestart) {
    throw new Error('Game is already in progress.');
  }

  room.preGameDraw = null;
  if (room.preGameDrawTimer) {
    clearTimeout(room.preGameDrawTimer);
    room.preGameDrawTimer = null;
  }

  // Clear any stale async sequences from a previous game so they cannot
  // corrupt the new game's state via dangling Promise closures.
  if (nextHandStartsByRoom.has(code)) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[mp-draw-server] startGame: clearing stale nextHandStart for room ${code}`);
    }
    nextHandStartsByRoom.delete(code);
  }

  // Create fresh game state (either first start or restart after stale state)
  room.asyncStateVersion += 1;
  const state0 = createInitialState(room.players, room.config);
  const state1 = startNewHand(state0, options.customDeck, options.startingPlayerId);
  room.state = state1;
  if (options.customDeck) {
    room.activeTileSetSize = options.customDeck.length;
  }
  const expectedTileCount = room.activeTileSetSize;
  assertTileCountInvariant(room.state, `startGame:${code}`, expectedTileCount);
  assertValidGameState(room.state, `startGame:${code}`, expectedTileCount);
  room.ghostMoveLogs = Object.fromEntries(room.players.map((playerId) => [playerId, []]));
  room.ghostTurnIndex = 0;
  if (room.events.some((event) => event.type === 'match_started')) {
    resetRoomEventLog(room);
  }
  appendRoomEvent(room, {
    type: 'match_started',
    payload: {
      players: [...room.players],
      winningScore: room.state.config.winningScore,
    },
  });
  appendRoomEvent(room, {
    type: 'hand_started',
    payload: {
      handNumber: room.state.handNumber,
      currentPlayerId: room.state.playerIds[room.state.currentPlayerIndex],
    },
  });
  room.nextHandReady.clear();
  room.rematchReady.clear();
  room.matchStartReady.clear();
  room.lastHandEndedNotifiedHand = null;
  room.lastHandEndedAtMs = null;
  room.lastBroadcastScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );
  notifyLiveRoomStateCommitted(room);
  await flushCommittedRoomStateOrThrow(room);
  return room;
}

export async function nextHand(code: string, io: Server): Promise<Room> {
  const room = getRoom(code);
  assertRoomDurabilityOperationAllowed(room, 'new_hand');
  if (room.abandonedAt) {
    throw new Error('match_abandoned');
  }
  if (!room.state) throw new Error('Game not started.');

  if (!room.state.handOver) {
    throw new Error('Hand is not over yet.');
  }

  if (room.state.gameOver) {
    throw new Error('Game is over. Cannot start a new hand.');
  }

  // Start new hand
  room.preGameDraw = null;
  if (room.preGameDrawTimer) {
    clearTimeout(room.preGameDrawTimer);
    room.preGameDrawTimer = null;
  }
  room.asyncStateVersion += 1;
  const state1 = startNewHand(room.state);
  room.state = state1;
  assertTileCountInvariant(room.state, `nextHand:${code}`);
  assertValidGameState(room.state, `nextHand:${code}`);
  room.ghostTurnIndex = 0;
  appendRoomEvent(room, {
    type: 'hand_started',
    payload: {
      handNumber: room.state.handNumber,
      currentPlayerId: room.state.playerIds[room.state.currentPlayerIndex],
    },
  });
  room.nextHandReady.clear();
  room.lastHandEndedNotifiedHand = null;
  room.lastHandEndedAtMs = null;
  room.lastBroadcastScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );
  notifyLiveRoomStateCommitted(room);
  await flushCommittedRoomStateOrThrow(room);
  return room;
}

export async function readyForNextHand(
  code: string,
  playerSeatId: string,
  io: Server,
  handNumber?: number,
  onStateReady?: (roomCode: string) => void,
): Promise<{ started: boolean; room: Room; ignored?: boolean; waitMs?: number }> {
  type MarkPhaseResult =
    | { kind: 'return'; value: { started: boolean; room: Room; ignored?: boolean; waitMs?: number } }
    | { kind: 'coalesce'; room: Room; existingStart: Promise<Room>; readyHandNumber: number }
    | { kind: 'scheduled'; room: Room; waitMs: number };

  const markPhase = await withRoomGameplayLock(code, async (): Promise<MarkPhaseResult> => {
    const room = getRoom(code);
    if (room.preGameDraw) {
      return { kind: 'return', value: { started: false, room, ignored: true } };
    }
    if (!room.state) throw new Error('Game not started.');
    if (room.state.gameOver) {
      return { kind: 'return', value: { started: false, room } };
    }
    if (!room.players.includes(playerSeatId)) throw new Error('Player not in room.');
    if (typeof handNumber === 'number' && handNumber !== room.state.handNumber) {
      return { kind: 'return', value: { started: false, room, ignored: true } };
    }
    if (!room.state.handOver) {
      return { kind: 'return', value: { started: false, room } };
    }
    assertRoomDurabilityOperationAllowed(room, 'new_hand');

    const readyHandNumber = room.state.handNumber;
    const existingStart = nextHandStartsByRoom.get(code);
    if (existingStart) {
      return { kind: 'coalesce', room, existingStart, readyHandNumber };
    }

    if (room.nextHandReady.has(playerSeatId)) {
      return { kind: 'return', value: { started: false, room, ignored: true } };
    }

    room.nextHandReady.add(playerSeatId);
    appendRoomEvent(room, {
      type: 'hand_ready',
      payload: {
        playerSeatId,
        readyCount: room.nextHandReady.size,
        requiredCount: room.players.length,
        handNumber: room.state.handNumber,
      },
    });

    if (room.nextHandReady.size < room.players.length) {
      return { kind: 'return', value: { started: false, room } };
    }

    const waitMs = Math.max(
      0,
      MIN_HAND_OVER_MS - (Date.now() - (room.lastHandEndedAtMs ?? Date.now())),
    );

    const advance = (async () => {
      const latest = getRoom(code);
      const endedAt = latest.lastHandEndedAtMs ?? Date.now();
      const delayMs = Math.max(0, MIN_HAND_OVER_MS - (Date.now() - endedAt));
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      return withRoomGameplayLock(code, async () => {
        const fresh = getRoom(code);
        if (
          !fresh.state ||
          fresh.state.gameOver ||
          !fresh.state.handOver ||
          fresh.nextHandReady.size < fresh.players.length
        ) {
          return fresh;
        }

        fresh.nextHandReady.clear();
        const startedRoom = await nextHand(code, io);
        onStateReady?.(startedRoom.code);
        return startedRoom;
      });
    })();

    nextHandStartsByRoom.set(code, advance);
    void advance
      .catch((err: unknown) => {
        console.error('[hand:ready] scheduled next hand failed', err);
      })
      .finally(() => {
        if (nextHandStartsByRoom.get(code) === advance) {
          nextHandStartsByRoom.delete(code);
        }
      });

    return { kind: 'scheduled', room, waitMs };
  });

  if (markPhase.kind === 'return') {
    return markPhase.value;
  }

  if (markPhase.kind === 'coalesce') {
    const currentRoom = await markPhase.existingStart;
    const currentState = currentRoom.state;
    return {
      started: Boolean(
        currentState &&
          currentState.handNumber !== markPhase.readyHandNumber &&
          !currentState.handOver,
      ),
      room: currentRoom,
      ignored: true,
    };
  }

  return { started: false, room: markPhase.room, waitMs: markPhase.waitMs };
}

export interface ActionPayload {
  type: 'DRAW' | 'MOVE' | 'PASS';
  requestId?: string;
  move?: {
    tile: { high: number; low: number };
    position?: PlacementPosition;
    end?: 'left' | 'right';
  };
}

function commitResolvedGameState(room: Room, assertLabel: string, nextState: GameState, autoPassExtras?: string[]) {
  const finalized = finalizeMandatoryAutoPasses(nextState);
  room.state = finalized.state;
  const expectedTileCount = room.activeTileSetSize;
  assertTileCountInvariant(room.state, assertLabel, expectedTileCount);
  assertValidGameState(room.state, assertLabel, expectedTileCount);
  const extras = autoPassExtras?.filter(Boolean) ?? [];
  const merged = [...extras, ...finalized.autoPassedPlayerIds];
  room.pendingAutoPassNotice = merged.length > 0 ? merged : undefined;
  notifyLiveRoomStateCommitted(room);
}

/**
 * Processes an action for a room.
 * Note: `onStateReady` is passed through to `readyForNextHand` only. `act()` itself does not invoke it.
 */
export async function act(
  code: string,
  playerSeatId: string,
  action: ActionPayload,
  io: Server,
  onStateReady: (roomCode: string) => void,
): Promise<ActResult> {
  return withRoomGameplayLock(code, () =>
    actUnlocked(code, playerSeatId, action, io, onStateReady),
  );
}

async function actUnlocked(
  code: string,
  playerSeatId: string,
  action: ActionPayload,
  io: Server,
  onStateReady: (roomCode: string) => void,
): Promise<ActResult> {
  const room = getRoom(code);
  assertRoomDurabilityOperationAllowed(room, 'gameplay_action');
  if (room.abandonedAt) {
    throw new Error('match_abandoned');
  }
  if (!room.state) throw new Error('Game not started.');

  let state = room.state;

  if (state.handOver && !state.gameOver && action.type !== 'DRAW' && action.type !== 'PASS') {
    throw new Error('Hand is over. Waiting for next hand to start.');
  }
  if (state.gameOver) {
    throw new Error('Game is over. Only rematch or leave is accepted.');
  }

  const { type } = action;

  // ─────────────────────────────
  // DRAW
  // ─────────────────────────────
  if (type === 'DRAW') {
    drawAudit('action-received', {
      roomCode: code,
      userId: playerSeatId,
      actionType: 'DRAW',
      requestId: (action as { requestId?: string }).requestId,
    });
    if (!canDraw(state, playerSeatId)) {
      const currentId = state.playerIds[state.currentPlayerIndex];
      if (currentId !== playerSeatId) {
        throw new Error("It's not your turn.");
      }
      if (state.boneyard.length <= state.config.deadTileCount) {
        throw new Error('Boneyard locked');
      }
      throw new Error('You have a legal play — you may not draw.');
    }

    const previousState = state;
    const result = resolveDrawUntilPlayableAtomically(state, playerSeatId);
    const drawAutoPassExtras = result.passed ? [playerSeatId] : [];
    commitResolvedGameState(room, `act:DRAW:${code}`, result.state, drawAutoPassExtras);
    appendRoomEvent(room, {
      type: 'draw_requested',
      payload: {
        playerSeatId,
        handNumber: state.handNumber,
      },
    });
    logMpDebug('mp-action', {
      roomCode: room.code,
      playerId: playerSeatId,
      action: 'DRAW',
      event: 'accepted',
      sequence: room.state.sequence,
      handNumber: room.state.handNumber,
      boneyardCount: room.state.boneyard.length,
    });
    for (const step of result.animationSteps) {
      appendRoomEvent(room, {
        type: 'tile_drawn',
        actorSocketId: playerSeatId,
        payload: {
          tile: normalizeTileKey(step.tile),
          boneyardCount: step.boneyardCount,
          drawerHandCount: step.drawerHandCount,
        },
      });
    }
    if (result.passed) {
      appendRoomEvent(room, {
        type: 'turn_passed',
        actorSocketId: playerSeatId,
        payload: {
          handNumber: room.state.handNumber,
        },
      });
    }
    appendResolutionEvents(room, previousState, playerSeatId);
    drawAudit('forced-draw-resolved', {
      roomCode: code,
      playerId: playerSeatId,
      drawnCount: result.animationSteps.length,
      stoppedBecause: result.stoppedReason,
      handCount: room.state.players[playerSeatId]?.hand.length ?? 0,
      boneyardCount: room.state.boneyard.length,
    });
    return {
      room,
      forcedDrawAnimation: {
        playerId: playerSeatId,
        sequence: room.state.sequence,
        steps: result.animationSteps,
        stoppedReason: result.stoppedReason,
        finalState: room.state,
      },
    };
  }

  // ─────────────────────────────
  // MOVE
  // ─────────────────────────────
  if (type === 'MOVE') {
    drawAudit('action-received', {
      roomCode: code,
      userId: playerSeatId,
      actionType: 'MOVE',
      requestId: (action as { requestId?: string }).requestId,
    });
    if (!action.move) throw new Error('Move payload missing.');

    const { tile } = action.move;
    const position: PlacementPosition = action.move.position ?? action.move.end ?? 'left';

    const move: Move = {
      type: 'play',
      tile: { high: tile.high, low: tile.low },
      position,
    };

    const handBefore = state.players[playerSeatId]?.hand ?? [];
    const scoreDelta = computePlayScore(simulatePlacement(state.board, move.tile, position), state.config);
    const previousState = state;
    const { state: stateAfterMove, forcedDraw } = applyMove(state, playerSeatId, move);
    appendGhostMove(room, playerSeatId, {
      turn: currentGhostTurn(room),
      hand_number: state.handNumber,
      actor: 'you',
      board_state: serializeGhostBoardState(state.board),
      tile_played: normalizeTileKey(move.tile),
      branch: position,
      hand_before: handBefore.map(normalizeTileKey),
      score_delta: scoreDelta,
      forced_draw: Boolean(forcedDraw),
    });
    room.ghostTurnIndex += 1;
    appendRoomEvent(room, {
      type: 'tile_played',
      actorSocketId: playerSeatId,
      payload: {
        tile: normalizeTileKey(move.tile),
        position,
        scoreDelta,
        forcedDraw: Boolean(forcedDraw),
      },
    });

    let authoritativeState = stateAfterMove;
    let resolvedForced: ResolveForcedDrawResult | null = null;
    if (forcedDraw) {
      resolvedForced = resolveForcedDrawAtomically(stateAfterMove, playerSeatId, forcedDraw);
      authoritativeState = resolvedForced.state;
    }

    commitResolvedGameState(
      room,
      forcedDraw ? `act:MOVE:forcedDraw:${code}` : `act:MOVE:${code}`,
      authoritativeState,
    );

    if (forcedDraw && resolvedForced) {
      drawAudit('forced-draw-resolved', {
        roomCode: code,
        playerId: playerSeatId,
        drawnCount: resolvedForced.animationSteps.length,
        stoppedBecause: resolvedForced.stoppedReason,
        handCount: room.state.players[playerSeatId]?.hand.length ?? 0,
        boneyardCount: room.state.boneyard.length,
      });
      logMpDebug('mp-forced-draw', {
        roomCode: room.code,
        playerId: playerSeatId,
        action: 'MOVE',
        event: 'forced_draw_resolved_sync',
        sequence: room.state.sequence,
        tilesDrawn: resolvedForced.animationSteps.length,
        stoppedReason: resolvedForced.stoppedReason,
        boneyardCount: room.state.boneyard.length,
        handNumber: room.state.handNumber,
      });
      for (const step of resolvedForced.animationSteps) {
        appendRoomEvent(room, {
          type: 'tile_drawn',
          actorSocketId: playerSeatId,
          payload: {
            tile: normalizeTileKey(step.tile),
            boneyardCount: step.boneyardCount,
            drawerHandCount: step.drawerHandCount,
          },
        });
      }
      appendResolutionEvents(room, previousState, playerSeatId);
      return {
        room,
        forcedDrawAnimation: {
          playerId: playerSeatId,
          sequence: room.state.sequence,
          steps: resolvedForced.animationSteps,
          stoppedReason: resolvedForced.stoppedReason,
          finalState: room.state as GameState,
        },
      };
    }

    appendResolutionEvents(room, previousState, playerSeatId);
    return { room };
  }

  // ─────────────────────────────
  // PASS
  // ─────────────────────────────
  if (type === 'PASS') {
    drawAudit('action-received', {
      roomCode: code,
      userId: playerSeatId,
      actionType: 'PASS',
      requestId: (action as { requestId?: string }).requestId,
    });
    drawAudit('pass-applied', {
      roomCode: code,
      playerId: playerSeatId,
      reason: 'client_pass',
    });
    const previousState = state;
    appendGhostMove(room, playerSeatId, {
      turn: currentGhostTurn(room),
      hand_number: state.handNumber,
      actor: 'you',
      board_state: serializeGhostBoardState(state.board),
      tile_played: null,
      branch: 'pass',
      hand_before: (state.players[playerSeatId]?.hand ?? []).map(normalizeTileKey),
      score_delta: 0,
      forced_draw: false,
    });
    room.ghostTurnIndex += 1;
    const afterPass = applyMove(state, playerSeatId, { type: 'pass' }).state;
    commitResolvedGameState(room, `act:PASS:${code}`, afterPass);
    appendRoomEvent(room, {
      type: 'turn_passed',
      actorSocketId: playerSeatId,
      payload: {
        handNumber: state.handNumber,
      },
    });
    appendResolutionEvents(room, previousState, playerSeatId);
    return { room };
  }

  throw new Error('Unknown action type.');
}

// Get legal moves for a player
export function getRoomLegalMoves(code: string, playerId: string) {
  const room = getRoom(code);
  if (!room.state) return [];

  const currentId = room.state.playerIds[room.state.currentPlayerIndex];
  if (currentId !== playerId) return [];

  return getLegalMoves(room.state, playerId);
}

// Check if player can draw
export function getRoomCanDraw(code: string, playerId: string): boolean {
  const room = getRoom(code);
  if (!room.state) return false;
  return canDraw(room.state, playerId);
}

// Expose getOpenEnds for client to know valid placements
export function getRoomOpenEnds(code: string) {
  const room = getRoom(code);
  if (!room.state) return [];
  return getOpenEnds(room.state.board);
}

export function getRoomMatchEventMeta(code: string) {
  return getRoomEventMeta(getRoom(code));
}

export function getRoomMatchEventSnapshot(code: string) {
  return getRoomEventSnapshot(getRoom(code));
}
