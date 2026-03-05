import { GameState, Config, PlacementPosition, Move, Tile } from './game/types';
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
};

const rooms = new Map<RoomCode, Room>();
const drawSequencesByRoom = new Map<RoomCode, Promise<void>>();
const DRAW_STEP_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withDrawSequenceFlag(state: GameState, active: boolean): GameState {
  return { ...state, __drawSequenceActive: active };
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
  };

  rooms.set(code, room);
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

        const { state: next, drew } = drawOne(current, playerId);
        current = next;
        setState(withDrawSequenceFlag(current, true));
        current = getState();

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

    const { state: stateAfterMove, forcedDraw } = applyMove(state, socketId, move);
    room.state = stateAfterMove;
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
    return room;
  }

  // ─────────────────────────────
  // PASS
  // ─────────────────────────────
  if (type === 'PASS') {
    room.state = applyMove(state, socketId, { type: 'pass' }).state;
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
