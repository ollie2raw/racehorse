import { GameState, Config, PlacementPosition, Move, Tile, BoardState } from './game/types';
import { assertValidGameState } from './game/invariants';
import type { Server } from 'socket.io';
import {
  createInitialState,
  startNewHand,
  drawOne,
  applyMove,
  getLegalMoves,
  getOpenEnds,
  canDraw,
} from './game/engine';
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

export type RoomCode = string;

export type LeadTracker = {
  aId: string;
  bId: string;
  maxLeadA: number;
  maxLeadB: number;
};

export type Room = {
  code: RoomCode;
  players: string[]; // socket ids in seat order
  state: GameState | null; // null until game started
  config: Partial<Config>;
  asyncStateVersion: number;
  nextHandReady: Set<string>;
  rematchReady: Set<string>;
  lastHandEndedNotifiedHand: number | null;
  lastHandEndedAtMs: number | null;
  lastBroadcastScores: Record<string, number>;
  ghostMoveLogs: Record<string, GhostMoveLogEntry[]>;
  ghostTurnIndex: number;
  matchId: string;
  matchLogged: boolean;
  leadTracker: LeadTracker | null;
  eventLogVersion: 1;
  eventSequence: number;
  events: RoomMatchEvent[];
  /** Set when room was created via matchmaking queue; used to update matchmaking_matches on game-end. */
  matchmakingMatchId?: string;
  /** True when at least one paired player was a sim opponent. */
  matchmakingIsSim?: boolean;
  /** Socket id of the sim opponent, when matchmakingIsSim is true. */
  matchmakingSimSocketId?: string;
};

export type ManualDrawAnimationStep = {
  tile: Tile;
  boneyardCount: number;
  drawerHandCount: number;
};

type ResolveManualDrawResult = {
  state: GameState;
  animationSteps: ManualDrawAnimationStep[];
  stoppedReason: 'playable' | 'locked_pass';
  passed: boolean;
};

export type ActResult = {
  room: Room;
  manualDrawAnimation?: {
    playerId: string;
    sequence: number;
    steps: ManualDrawAnimationStep[];
    stoppedReason: 'playable' | 'locked_pass';
    finalState: GameState;
  };
  forcedDrawAnimation?: {
    playerId: string;
    sequence: number;
    steps: ManualDrawAnimationStep[];
    stoppedReason: 'playable' | 'locked_pass' | 'locked_no_pass';
    finalState: GameState;
  };
};

const rooms = new Map<RoomCode, Room>();
const nextHandStartsByRoom = new Map<RoomCode, Promise<Room>>();
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

function appendGhostMove(room: Room, socketId: string, entry: GhostMoveLogEntry): void {
  room.ghostMoveLogs[socketId] = [...(room.ghostMoveLogs[socketId] ?? []), entry];
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

export function createRoom(hostSocketId: string, config: Partial<Config> = {}): Room {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();

  const room: Room = {
    code,
    players: [hostSocketId],
    state: null,
    config,
    asyncStateVersion: 0,
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchLogged: false,
    leadTracker: null,
    ...createRoomEventState(),
  };
  appendRoomEvent(room, {
    type: 'room_created',
    actorSocketId: hostSocketId,
    payload: {
      hostSocketId,
      config,
    },
  });

  rooms.set(code, room);
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

  const room: Room = {
    code: normalizedCode,
    players: [],
    state: null,
    config,
    asyncStateVersion: 0,
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchLogged: false,
    leadTracker: null,
    ...createRoomEventState(),
  };
  appendRoomEvent(room, {
    type: 'room_created',
    payload: {
      reserved: true,
      config,
    },
  });

  rooms.set(normalizedCode, room);
  return room;
}

export function joinRoom(code: string, socketId: string): Room {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found.');

  if (!room.players.includes(socketId)) {
    if (room.players.length >= 2) {
      throw new Error('Room is full (v1 supports 2 players).');
    }
    room.players.push(socketId);
  }

  return room;
}

export function getRoom(code: string): Room {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found.');
  return room;
}

export function deleteRoom(code: string): boolean {
  return rooms.delete(code);
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

function resolveManualDrawAtomically(
  state: GameState,
  playerId: string,
): ResolveManualDrawResult {
  let current = state;
  const animationSteps: ManualDrawAnimationStep[] = [];

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
  animationSteps: ManualDrawAnimationStep[];
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
  const animationSteps: ManualDrawAnimationStep[] = [];

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
    const step = drawOne(current, playerId);
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

export async function startGame(
  code: string,
  io: Server,
  options: { allowRestart?: boolean } = {},
): Promise<Room> {
  const room = getRoom(code);

  if (room.players.length !== 2) {
    throw new Error('Need exactly 2 players to start.');
  }

  if (room.state && !options.allowRestart) {
    throw new Error('Game is already in progress.');
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
  const state1 = startNewHand(state0);
  room.state = state1;
  assertValidGameState(room.state, `startGame:${code}`);
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
  room.lastHandEndedNotifiedHand = null;
  room.lastHandEndedAtMs = null;
  room.lastBroadcastScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );
  return room;
}

export async function nextHand(code: string, io: Server): Promise<Room> {
  const room = getRoom(code);
  if (!room.state) throw new Error('Game not started.');

  if (!room.state.handOver) {
    throw new Error('Hand is not over yet.');
  }

  if (room.state.gameOver) {
    throw new Error('Game is over. Cannot start a new hand.');
  }

  // Start new hand
  room.asyncStateVersion += 1;
  const state1 = startNewHand(room.state);
  room.state = state1;
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
  return room;
}

export async function readyForNextHand(
  code: string,
  socketId: string,
  io: Server,
  handNumber?: number,
  onStateReady?: (roomCode: string) => void,
): Promise<{ started: boolean; room: Room; ignored?: boolean; waitMs?: number }> {
  const room = getRoom(code);
  if (!room.state) throw new Error('Game not started.');
  if (room.state.gameOver) return { started: false, room };
  if (!room.players.includes(socketId)) throw new Error('Player not in room.');
  if (typeof handNumber === 'number' && handNumber !== room.state.handNumber) {
    return { started: false, room, ignored: true };
  }
  if (!room.state.handOver) return { started: false, room };
  const readyHandNumber = room.state.handNumber;

  room.nextHandReady.add(socketId);
  appendRoomEvent(room, {
    type: 'hand_ready',
    actorSocketId: socketId,
    payload: {
      readyCount: room.nextHandReady.size,
      requiredCount: room.players.length,
      handNumber: room.state.handNumber,
    },
  });
  if (room.nextHandReady.size >= room.players.length) {
    const existingStart = nextHandStartsByRoom.get(code);
    if (existingStart) {
      const currentRoom = await existingStart;
      const currentState = currentRoom.state;
      return {
        started: Boolean(currentState && currentState.handNumber !== readyHandNumber && !currentState.handOver),
        room: currentRoom,
        ignored: true,
      };
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
    return { started: false, room, waitMs };
  }

  return { started: false, room };
}

export interface ActionPayload {
  type: 'DRAW' | 'MOVE' | 'PASS';
  move?: {
    tile: { high: number; low: number };
    position?: PlacementPosition;
    end?: 'left' | 'right';
  };
}

/**
 * Processes an action for a room.
 * Note: `onStateReady` is passed through to `readyForNextHand` only. `act()` itself does not invoke it.
 */
export async function act(
  code: string,
  socketId: string,
  action: ActionPayload,
  io: Server,
  onStateReady: (roomCode: string) => void,
): Promise<ActResult> {
  const room = getRoom(code);
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
    if (!canDraw(state, socketId)) {
      const currentId = state.playerIds[state.currentPlayerIndex];
      if (currentId !== socketId) {
        throw new Error("It's not your turn.");
      }
      if (state.boneyard.length <= state.config.deadTileCount) {
        throw new Error('Boneyard locked');
      }
      throw new Error('You have a legal play — you may not draw.');
    }

    const previousState = state;
    const result = resolveManualDrawAtomically(state, socketId);
    room.state = result.state;
    assertValidGameState(room.state, `act:DRAW:${code}`);
    appendRoomEvent(room, {
      type: 'draw_requested',
      actorSocketId: socketId,
      payload: {
        handNumber: state.handNumber,
      },
    });
    logMpDebug('mp-action', {
      roomCode: room.code,
      playerId: socketId,
      action: 'DRAW',
      event: 'accepted',
      sequence: room.state.sequence,
      handNumber: room.state.handNumber,
      boneyardCount: room.state.boneyard.length,
    });
    for (const step of result.animationSteps) {
      appendRoomEvent(room, {
        type: 'tile_drawn',
        actorSocketId: socketId,
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
        actorSocketId: socketId,
        payload: {
          handNumber: room.state.handNumber,
        },
      });
    }
    appendResolutionEvents(room, previousState, socketId);
    return {
      room,
      manualDrawAnimation: {
        playerId: socketId,
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
    if (!action.move) throw new Error('Move payload missing.');

    const { tile } = action.move;
    const position: PlacementPosition = action.move.position ?? action.move.end ?? 'left';

    const move: Move = {
      type: 'play',
      tile: { high: tile.high, low: tile.low },
      position,
    };

    const handBefore = state.players[socketId]?.hand ?? [];
    const scoreDelta = computePlayScore(simulatePlacement(state.board, move.tile, position), state.config);
    const previousState = state;
    const { state: stateAfterMove, forcedDraw } = applyMove(state, socketId, move);
    appendGhostMove(room, socketId, {
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
    room.state = stateAfterMove;
    assertValidGameState(room.state, `act:MOVE:${code}`);
    appendRoomEvent(room, {
      type: 'tile_played',
      actorSocketId: socketId,
      payload: {
        tile: normalizeTileKey(move.tile),
        position,
        scoreDelta,
        forcedDraw: Boolean(forcedDraw),
      },
    });
    if (forcedDraw) {
      const resolved = resolveForcedDrawAtomically(stateAfterMove, socketId, forcedDraw);
      room.state = resolved.state;
      assertValidGameState(room.state, `act:MOVE:forcedDraw:${code}`);
      logMpDebug('mp-forced-draw', {
        roomCode: room.code,
        playerId: socketId,
        action: 'MOVE',
        event: 'forced_draw_resolved_sync',
        sequence: room.state.sequence,
        tilesDrawn: resolved.animationSteps.length,
        stoppedReason: resolved.stoppedReason,
        boneyardCount: room.state.boneyard.length,
        handNumber: room.state.handNumber,
      });
      for (const step of resolved.animationSteps) {
        appendRoomEvent(room, {
          type: 'tile_drawn',
          actorSocketId: socketId,
          payload: {
            tile: normalizeTileKey(step.tile),
            boneyardCount: step.boneyardCount,
            drawerHandCount: step.drawerHandCount,
          },
        });
      }
      appendResolutionEvents(room, previousState, socketId);
      return {
        room,
        forcedDrawAnimation: {
          playerId: socketId,
          sequence: room.state.sequence,
          steps: resolved.animationSteps,
          stoppedReason: resolved.stoppedReason,
          finalState: room.state as GameState,
        },
      };
    }
    appendResolutionEvents(room, previousState, socketId);
    return { room };
  }

  // ─────────────────────────────
  // PASS
  // ─────────────────────────────
  if (type === 'PASS') {
    const previousState = state;
    appendGhostMove(room, socketId, {
      turn: currentGhostTurn(room),
      hand_number: state.handNumber,
      actor: 'you',
      board_state: serializeGhostBoardState(state.board),
      tile_played: null,
      branch: 'pass',
      hand_before: (state.players[socketId]?.hand ?? []).map(normalizeTileKey),
      score_delta: 0,
      forced_draw: false,
    });
    room.ghostTurnIndex += 1;
    room.state = applyMove(state, socketId, { type: 'pass' }).state;
    assertValidGameState(room.state, `act:PASS:${code}`);
    appendRoomEvent(room, {
      type: 'turn_passed',
      actorSocketId: socketId,
      payload: {
        handNumber: state.handNumber,
      },
    });
    appendResolutionEvents(room, previousState, socketId);
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
