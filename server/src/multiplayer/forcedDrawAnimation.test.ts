import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, Tile } from '../game/types';
import { applyMove, getLegalMoves } from '../game/engine';
import { simulatePlacement } from '../game/scoring';
import { act, createReservedRoom, getRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  emitForcedDrawAnimationPayload,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';

const t = (low: number, high: number): Tile => ({ low: Math.min(low, high), high: Math.max(low, high) });

function allDoubleSixTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (let hi = 0; hi <= 6; hi++) {
    for (let lo = 0; lo <= hi; lo++) {
      tiles.push(t(lo, hi));
    }
  }
  return tiles;
}

function removeTiles(pool: Tile[], used: Tile[]): Tile[] {
  const remaining = [...pool];
  for (const tile of used) {
    const idx = remaining.findIndex((candidate) => candidate.low === tile.low && candidate.high === tile.high);
    if (idx < 0) throw new Error(`tile missing from pool: ${tile.low}|${tile.high}`);
    remaining.splice(idx, 1);
  }
  return remaining;
}

function setupState(overrides: Partial<GameState> & { board?: GameState['board'] }): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 0,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
    },
    playerIds: ['seat-a', 'seat-b'],
    players: {
      'seat-a': { id: 'seat-a', hand: [t(0, 1), t(0, 2)], score: 0 },
      'seat-b': { id: 'seat-b', hand: [t(2, 3)], score: 0 },
    },
    board: simulatePlacement(null, t(6, 6), 'left'),
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 2,
    ...overrides,
  };
}

function seedRoomForAct(roomCode: string, state: GameState) {
  createReservedRoom(roomCode, { winningScore: 60 });
  const room = getRoom(roomCode);
  room.players = ['seat-a', 'seat-b'];
  room.state = state;
  room.matchId = '11111111-1111-4111-8111-111111111111';
  room.eventLogVersion = 1;
  room.eventSequence = 1;
  room.events = [
    {
      id: 'evt-1',
      version: 1,
      matchId: room.matchId,
      roomCode,
      sequence: 1,
      type: 'match_started',
      timestamp: new Date().toISOString(),
      handNumber: 1,
      stateSequence: state.sequence,
      actorSocketId: null,
      actorUserId: null,
      payload: {},
    },
  ];
  setRoomRoster(roomCode, [
    { id: 'seat-a', socketId: 'sock-a', username: 'Drawer', userId: 'user-a' },
    { id: 'seat-b', socketId: 'sock-b', username: 'Opponent', userId: 'user-b' },
  ]);
}

function makeIo(drawerSocketId: string, opponentSocketId: string, roomCode: string) {
  const drawerEmit = vi.fn();
  const opponentEmit = vi.fn();
  const exceptEmit = vi.fn();

  const io = {
    sockets: {
      sockets: new Map([
        [drawerSocketId, { id: drawerSocketId, rooms: new Set([roomCode]), data: { playerId: 'seat-a' }, emit: drawerEmit }],
        [opponentSocketId, { id: opponentSocketId, rooms: new Set([roomCode]), data: { playerId: 'seat-b' }, emit: opponentEmit }],
      ]),
      adapter: {
        rooms: new Map([[roomCode, new Set([drawerSocketId, opponentSocketId])]]),
      },
    },
    to: vi.fn((target: string) => {
      if (target === roomCode) {
        return { emit: vi.fn(), except: vi.fn(() => ({ emit: exceptEmit })) };
      }
      return { emit: target === drawerSocketId ? drawerEmit : opponentEmit };
    }),
  };

  return { io: io as any, drawerEmit, opponentEmit, exceptEmit };
}

function buildSessionDeps() {
  return {
    resolveSocketIdentity: async () => ({ username: 'Drawer', userId: 'user-a' }),
    normalizeUsername: (v: unknown) => (typeof v === 'string' ? v : 'Guest'),
    normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    maybeFinalizeTournamentMatch: () => undefined,
    persistRoomMatchLog: async () => undefined,
    onGameOver: () => null,
    finalizeTournamentMatch: () => undefined,
  };
}

function buildLongDrawChainState(stepTarget: number): GameState {
  const board = simulatePlacement(null, t(6, 6), 'left');
  const boardTiles = [t(6, 6)];
  const seatAHand = [t(0, 1), t(0, 2)];
  const seatBHand = [t(2, 3)];
  const pool = removeTiles(allDoubleSixTiles(), [...boardTiles, ...seatAHand, ...seatBHand]);
  const playableCap = t(5, 6);
  const filler = removeTiles(pool, [playableCap]);
  const boneyard = [...filler.slice(0, stepTarget), playableCap, ...filler.slice(stepTarget)];

  const state = setupState({
    board,
    players: {
      'seat-a': { id: 'seat-a', hand: seatAHand, score: 0 },
      'seat-b': { id: 'seat-b', hand: seatBHand, score: 0 },
    },
    boneyard,
    deadTiles: [],
  });

  expect(getLegalMoves(state, 'seat-a').every((move) => move.type !== 'play')).toBe(true);
  return state;
}

function buildBranchForcedDrawMove() {
  let board = simulatePlacement(null, t(1, 1), 'left');
  board = simulatePlacement(board, t(1, 3), 'right');
  board = simulatePlacement(board, t(4, 1), 'left');
  board = simulatePlacement(board, t(3, 3), 'right');
  const boardTiles = [t(1, 1), t(1, 3), t(4, 1), t(3, 3)];
  const seatAHand = [t(1, 5)];
  const seatBHand = [t(0, 1)];
  const pool = removeTiles(allDoubleSixTiles(), [...boardTiles, ...seatAHand, ...seatBHand]);
  const state = setupState({
    board,
    players: {
      'seat-a': { id: 'seat-a', hand: seatAHand, score: 0 },
      'seat-b': { id: 'seat-b', hand: seatBHand, score: 0 },
    },
    boneyard: pool,
    deadTiles: [],
  });
  const branchMove = getLegalMoves(state, 'seat-a').find(
    (move) => move.type === 'play' && move.position === 'branch-0-0',
  );
  if (!branchMove || branchMove.type !== 'play') {
    throw new Error('Expected branch scoring play for forced-draw fixture');
  }
  return {
    state,
    move: {
      type: 'play' as const,
      tile: branchMove.tile,
      position: branchMove.position,
    },
  };
}

describe('forced draw animation smoke', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
  });

  it('resolves a 5-10 tile draw animation chain via act(DRAW)', async () => {
    const state = buildLongDrawChainState(8);
    seedRoomForAct('FDDRAW', state);
    const { io } = makeIo('sock-a', 'sock-b', 'FDDRAW');
    initRoomSession(io, buildSessionDeps());

    const result = await act('FDDRAW', 'seat-a', { type: 'DRAW', requestId: 'draw-chain' }, io, () => {});

    const steps = result.forcedDrawAnimation?.steps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps.length).toBeLessThanOrEqual(10);
    expect(result.forcedDrawAnimation?.stoppedReason).toBe('playable');
    expect(steps.every((step) => step.tile !== null)).toBe(true);
  });

  it('MOVE scoring forced-draw still emits a multi-step animation chain', async () => {
    const { state, move } = buildBranchForcedDrawMove();
    seedRoomForAct('FDMOVE', state);
    const { io } = makeIo('sock-a', 'sock-b', 'FDMOVE');
    initRoomSession(io, buildSessionDeps());

    const result = await act(
      'FDMOVE',
      'seat-a',
      { type: 'MOVE', move: { tile: move.tile, position: move.position } },
      io,
      () => {},
    );

    const steps = result.forcedDrawAnimation?.steps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(result.forcedDrawAnimation?.stoppedReason).toMatch(/playable|locked_pass/);
  });

  it('emits drawer-visible tiles and opponent-masked tiles for a 7-step chain', async () => {
    const state = buildLongDrawChainState(7);
    seedRoomForAct('FDEMIT', state);
    const { io, drawerEmit, exceptEmit } = makeIo('sock-a', 'sock-b', 'FDEMIT');
    initRoomSession(io, buildSessionDeps());

    const result = await act('FDEMIT', 'seat-a', { type: 'DRAW', requestId: 'draw-emit' }, io, () => {});
    expect(result.forcedDrawAnimation).toBeDefined();
    expect(result.forcedDrawAnimation!.steps.length).toBeGreaterThanOrEqual(5);

    emitForcedDrawAnimationPayload('FDEMIT', result.forcedDrawAnimation!);

    const drawerPayload = drawerEmit.mock.calls.find(([event]) => event === 'game:draw_animation')?.[1];
    const opponentPayload = exceptEmit.mock.calls.find(([event]) => event === 'game:draw_animation')?.[1];

    expect(drawerPayload?.mode).toBe('forced_draw');
    expect(opponentPayload?.mode).toBe('forced_draw');
    expect(drawerPayload?.steps.length).toBeGreaterThanOrEqual(5);
    expect(opponentPayload?.steps.length).toBe(drawerPayload?.steps.length);
    expect(drawerPayload?.steps.every((step: { tile: Tile | null }) => step.tile !== null)).toBe(true);
    expect(opponentPayload?.steps.every((step: { tile: Tile | null }) => step.tile === null)).toBe(true);
    expect(drawerPayload?.final?.drewCount).toBe(drawerPayload?.steps.length);
    expect(opponentPayload?.final?.drewCount).toBe(opponentPayload?.steps.length);
  });

  it('synthetic 7-step payload keeps tile secrecy between seats', () => {
    const state = buildLongDrawChainState(7);
    seedRoomForAct('FDSYN', state);
    const { io, drawerEmit, exceptEmit } = makeIo('sock-a', 'sock-b', 'FDSYN');
    initRoomSession(io, buildSessionDeps());

    const steps = Array.from({ length: 7 }, (_, index) => ({
      tile: t(index % 6, (index + 2) % 6),
      boneyardCount: 14 - index,
      drawerHandCount: 2 + index,
    }));

    emitForcedDrawAnimationPayload('FDSYN', {
      playerId: 'seat-a',
      sequence: state.sequence,
      steps,
      stoppedReason: 'playable',
      finalState: state,
    });

    const drawerPayload = drawerEmit.mock.calls.find(([event]) => event === 'game:draw_animation')?.[1];
    const opponentPayload = exceptEmit.mock.calls.find(([event]) => event === 'game:draw_animation')?.[1];
    expect(drawerPayload?.steps).toHaveLength(7);
    expect(opponentPayload?.steps).toHaveLength(7);
    expect(drawerPayload?.steps.every((step: { tile: Tile | null }) => step.tile !== null)).toBe(true);
    expect(opponentPayload?.steps.every((step: { tile: Tile | null }) => step.tile === null)).toBe(true);
  });
});
