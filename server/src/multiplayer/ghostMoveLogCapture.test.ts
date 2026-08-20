import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLegalMoves } from '../game/engine';
import {
  act,
  createReservedRoom,
  getRoom,
  joinRoom,
  resetRoomRuntimeForTests,
} from '../rooms';
import { resetRoomSessionStoresForTests } from './roomSession';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';
import { verifyPlayerMoveLog } from '../ghost/verifier';
import type { BoardState, GameState, Tile } from '../game/types';

const t = (low: number, high: number): Tile => ({
  low: Math.min(low, high),
  high: Math.max(low, high),
});

function pt(tile: Tile) {
  return { tile, orientation: 'horizontal-normal' as const };
}

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: () => {}, except: () => ({ emit: () => {} }) }),
  } as any;
}

function seedRoom(code: string, state: GameState) {
  createReservedRoom(code);
  joinRoom(code, 'seat-1');
  joinRoom(code, 'seat-2');
  const room = getRoom(code);
  room.players = ['seat-1', 'seat-2'];
  room.state = state;
  room.activeTileSetSize = 28;
  return room;
}

describe('ghost move log capture for verification', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetRoomGameplayLocksForTests();
    vi.stubEnv('SOFT_GAME_INVARIANTS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('logs draw steps and verifies after DRAW then MOVE in the same hand', async () => {
    const code = 'DRAWMV';
    const board: BoardState = {
      mainLine: [pt(t(1, 4))],
      leftEnd: 1,
      rightEnd: 4,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    };
    seedRoom(code, {
      config: {
        maxPips: 6,
        tilesPerPlayer: 7,
        deadTileCount: 0,
        scoringMultiple: 5,
        blockedHandRule: 'lowestPips',
        endHandBonus: 'sumOpponentPenalties',
        winningScore: 60,
      },
      playerIds: ['seat-1', 'seat-2'],
      players: {
        'seat-1': { id: 'seat-1', hand: [t(2, 3), t(2, 5), t(0, 0)], score: 0 },
        'seat-2': { id: 'seat-2', hand: [t(1, 1), t(3, 3)], score: 0 },
      },
      board,
      boneyard: [t(4, 4)],
      deadTiles: [],
      currentPlayerIndex: 0,
      handNumber: 1,
      handOpen: true,
      handOver: false,
      gameOver: false,
      sequence: 1,
    } as GameState);

    const io = makeIo();
    await act(code, 'seat-1', { type: 'DRAW', requestId: 'd1' }, io, () => {});

    const afterDraw = getRoom(code);
    const playMoves = getLegalMoves(afterDraw.state!, 'seat-1').filter((move) => move.type === 'play');
    expect(playMoves.length).toBeGreaterThan(0);
    await act(
      code,
      'seat-1',
      {
        type: 'MOVE',
        requestId: 'm1',
        move: { tile: playMoves[0]!.tile, position: playMoves[0]!.position },
      },
      io,
      () => {},
    );

    const log = getRoom(code).ghostMoveLogs['seat-1'] ?? [];
    expect(log.some((entry) => entry.branch === 'draw' && entry.drawn_tile === '4|4')).toBe(true);
    expect(verifyPlayerMoveLog(log, { strictHandContinuity: true })).toEqual({ ok: true });
  });

  it('logs forced-draw steps and verifies after forced-draw MOVE then continuation MOVE', async () => {
    const code = 'FRCMV';
    seedRoom(code, {
      config: {
        maxPips: 6,
        tilesPerPlayer: 7,
        deadTileCount: 0,
        scoringMultiple: 5,
        blockedHandRule: 'lowestPips',
        endHandBonus: 'sumOpponentPenalties',
        winningScore: 60,
      },
      playerIds: ['seat-1', 'seat-2'],
      players: {
        'seat-1': { id: 'seat-1', hand: [t(1, 6)], score: 0 },
        'seat-2': { id: 'seat-2', hand: [t(0, 0)], score: 0 },
      },
      board: {
        mainLine: [pt(t(1, 4))],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      boneyard: [t(2, 3), t(3, 5), t(4, 4)],
      deadTiles: [],
      currentPlayerIndex: 0,
      handNumber: 1,
      handOpen: true,
      handOver: false,
      gameOver: false,
      sequence: 1,
    } as GameState);

    const io = makeIo();
    await act(
      code,
      'seat-1',
      { type: 'MOVE', requestId: 'm1', move: { tile: t(1, 6), position: 'left' } },
      io,
      () => {},
    );

    const afterForced = getRoom(code);
    const logAfterForced = afterForced.ghostMoveLogs['seat-1'] ?? [];
    expect(logAfterForced.some((entry) => entry.forced_draw === true && entry.tile_played === '1|6')).toBe(
      true,
    );
    expect(logAfterForced.filter((entry) => entry.branch === 'draw').length).toBeGreaterThan(0);
    expect(verifyPlayerMoveLog(logAfterForced, { strictHandContinuity: true })).toEqual({ ok: true });

    const followUp = getLegalMoves(afterForced.state!, 'seat-1').filter((move) => move.type === 'play');
    expect(followUp.length).toBeGreaterThan(0);
    await act(
      code,
      'seat-1',
      {
        type: 'MOVE',
        requestId: 'm2',
        move: { tile: followUp[0]!.tile, position: followUp[0]!.position },
      },
      io,
      () => {},
    );

    const fullLog = getRoom(code).ghostMoveLogs['seat-1'] ?? [];
    expect(verifyPlayerMoveLog(fullLog, { strictHandContinuity: true })).toEqual({ ok: true });
  });
});
