import { GameState, Config, PlacementPosition, Move, Tile, BoardState } from './game/types';
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

export type Room = {
  code: RoomCode;
  players: string[]; // socket ids in seat order
  state: GameState | null; // null until game started
  config: Partial<Config>;
  nextHandReady: Set<string>;
  rematchReady: Set<string>;
  lastHandEndedNotifiedHand: number | null;
  lastBroadcastScores: Record<string, number>;
  ghostMoveLogs: Record<string, GhostMoveLogEntry[]>;
  ghostTurnIndex: number;
  matchId: string;
  eventLogVersion: 1;
  eventSequence: number;
  events: RoomMatchEvent[];
};

const rooms = new Map<RoomCode, Room>();
const drawSequencesByRoom = new Map<RoomCode, Promise<void>>();
const DRAW_STEP_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withDrawSequenceFlag(state: GameState, active: boolean): GameState {
  return { ...state, __drawSequenceActive: active };
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
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
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
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
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

export function reconcileDrawSequenceFlag(code: string): boolean {
  const room = rooms.get(code);
  if (!room?.state) return false;
  const hasSequence = drawSequencesByRoom.has(code);
  if (room.state.__drawSequenceActive && !hasSequence) {
    room.state = withDrawSequenceFlag(room.state, false);
    return true;
  }
  return false;
}

export function deleteRoom(code: string): boolean {
  return rooms.delete(code);
}

function appendResolutionEvents(room: Room, previousState: GameState, actorSocketId: string): void {
  if (!room.state) return;
  if (!previousState.handOver && room.state.handOver) {
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

export async function runDrawSequence(
  roomId: string,
  playerId: string,
  io: Server,
  getState: () => GameState,
  setState: (s: GameState) => void,
  preDrawnTiles: Tile[] = [],
): Promise<void> {
  const existing = drawSequencesByRoom.get(roomId);
  if (existing) {
    await existing;
    return;
  }

  const sequence = (async () => {
    let current = getState();
    if (current.__drawSequenceActive) {
      // Stale flag recovery: if no active sequence is registered but state says active,
      // clear the flag so turn-driving logic cannot deadlock.
      setState(withDrawSequenceFlag(current, false));
      current = getState();
    }

    const initialPlayable = getLegalMoves(current, playerId).some((move) => move.type === 'play');
    if (initialPlayable) return;

    setState(withDrawSequenceFlag(current, true));
    current = getState();

    try {
      if (preDrawnTiles.length > 0) {
        for (const tile of preDrawnTiles) {
          io.to(playerId).emit('game:draw_step', {
            playerId,
            tile,
            boneyardCount: current.boneyard.length,
            drawerHandCount: current.players[playerId]?.hand.length ?? 0,
          });
          io.to(roomId).except(playerId).emit('game:draw_step', {
            playerId,
            tile: null,
            boneyardCount: current.boneyard.length,
            drawerHandCount: current.players[playerId]?.hand.length ?? 0,
          });
        }
      }

      while (true) {
        const drawableCount = Math.max(0, current.boneyard.length - current.config.deadTileCount);
        if (drawableCount === 0) break;

        const room = getRoom(roomId);
        const handBefore = current.players[playerId]?.hand ?? [];
        appendGhostMove(room, playerId, {
          turn: currentGhostTurn(room),
          hand_number: current.handNumber,
          actor: 'you',
          board_state: serializeGhostBoardState(current.board),
          tile_played: null,
          branch: 'draw',
          hand_before: handBefore.map(normalizeTileKey),
          score_delta: 0,
          forced_draw: false,
        });

        const { state: next, drew } = drawOne(current, playerId);
        current = next;
        setState(withDrawSequenceFlag(current, true));
        current = getState();
        appendRoomEvent(room, {
          type: 'tile_drawn',
          actorSocketId: playerId,
          payload: {
            tile: drew ? normalizeTileKey(drew) : null,
            boneyardCount: current.boneyard.length,
            drawerHandCount: current.players[playerId]?.hand.length ?? 0,
          },
        });

        io.to(playerId).emit('game:draw_step', {
          playerId,
          tile: drew,
          boneyardCount: current.boneyard.length,
          drawerHandCount: current.players[playerId]?.hand.length ?? 0,
        });
        io.to(roomId).except(playerId).emit('game:draw_step', {
          playerId,
          tile: null,
          boneyardCount: current.boneyard.length,
          drawerHandCount: current.players[playerId]?.hand.length ?? 0,
        });

        const playable = getLegalMoves(current, playerId).filter((move) => move.type === 'play');
        if (playable.length > 0) break;
        await sleep(DRAW_STEP_MS);
      }
    } finally {
      setState(withDrawSequenceFlag(current, false));
    }
  })();

  drawSequencesByRoom.set(roomId, sequence);
  try {
    await sequence;
  } finally {
    drawSequencesByRoom.delete(roomId);
  }
}

export async function startGame(code: string, io: Server): Promise<Room> {
  const room = getRoom(code);

  if (room.players.length !== 2) {
    throw new Error('Need exactly 2 players to start.');
  }

  // Defensive: If game is in a stale state (handOver but not gameOver), allow restart
  // This handles edge cases where the room got stuck
  if (room.state && !room.state.gameOver && !room.state.handOver) {
    // Game is actively in progress - don't allow restart
    throw new Error('Game is already in progress.');
  }

  // Create fresh game state (either first start or restart after stale state)
  const state0 = createInitialState(room.players, room.config);
  const state1 = startNewHand(state0);
  room.state = withDrawSequenceFlag(state1, false);
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
  const currentPlayerId = room.state.playerIds[room.state.currentPlayerIndex];
  await runDrawSequence(
    room.code,
    currentPlayerId,
    io,
    () => room.state as GameState,
    (next) => {
      room.state = next;
    },
  );
  room.nextHandReady.clear();
  room.rematchReady.clear();
  room.lastHandEndedNotifiedHand = null;
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
  const state1 = startNewHand(room.state);
  room.state = withDrawSequenceFlag(state1, false);
  room.ghostTurnIndex = 0;
  appendRoomEvent(room, {
    type: 'hand_started',
    payload: {
      handNumber: room.state.handNumber,
      currentPlayerId: room.state.playerIds[room.state.currentPlayerIndex],
    },
  });
  const currentPlayerId = room.state.playerIds[room.state.currentPlayerIndex];
  await runDrawSequence(
    room.code,
    currentPlayerId,
    io,
    () => room.state as GameState,
    (next) => {
      room.state = next;
    },
  );
  room.nextHandReady.clear();
  room.lastHandEndedNotifiedHand = null;
  room.lastBroadcastScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );
  return room;
}

export async function readyForNextHand(
  code: string,
  socketId: string,
  io: Server,
): Promise<{ started: boolean; room: Room }> {
  const room = getRoom(code);
  if (!room.state) throw new Error('Game not started.');
  if (room.state.gameOver) return { started: false, room };
  if (!room.state.handOver) return { started: false, room };
  if (!room.players.includes(socketId)) throw new Error('Player not in room.');

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
    room.nextHandReady.clear();
    const startedRoom = await nextHand(code, io);
    return { started: true, room: startedRoom };
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

export async function act(
  code: string,
  socketId: string,
  action: ActionPayload,
  io: Server,
  onStateReady: (roomCode: string) => void,
): Promise<Room> {
  const room = getRoom(code);
  if (!room.state) throw new Error('Game not started.');

  let state = room.state;

  const { type } = action;

  // ─────────────────────────────
  // DRAW
  // ─────────────────────────────
  if (type === 'DRAW') {
    if (state.__drawSequenceActive) {
      return room;
    }
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

    room.state = withDrawSequenceFlag(state, false);
    appendRoomEvent(room, {
      type: 'draw_requested',
      actorSocketId: socketId,
      payload: {
        handNumber: state.handNumber,
      },
    });
    onStateReady(room.code);
    await runDrawSequence(
      room.code,
      socketId,
      io,
      () => room.state as GameState,
      (next) => {
        room.state = next;
      },
    );
    return room;
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
      onStateReady(room.code);
      await runDrawSequence(
        room.code,
        socketId,
        io,
        () => room.state as GameState,
        (next) => {
          room.state = next;
        },
        [forcedDraw],
      );
    }
    appendResolutionEvents(room, previousState, socketId);
    return room;
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
    appendRoomEvent(room, {
      type: 'turn_passed',
      actorSocketId: socketId,
      payload: {
        handNumber: state.handNumber,
      },
    });
    appendResolutionEvents(room, previousState, socketId);
    return room;
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
  if (room.state.__drawSequenceActive) return false;
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
