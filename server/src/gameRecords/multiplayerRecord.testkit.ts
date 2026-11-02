/**
 * Shared test harness for the multiplayer record tests: plays a whole game through the REAL room code (`startGame`, `act`, `nextHand`) with a seeded policy.
 * Not a test file; imported by the tests that need a genuinely finished room.
 */
import { afterEach, beforeEach, vi } from 'vitest';
import {
  act,
  createReservedRoom,
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  joinRoom,
  nextHand,
  resetRoomRuntimeForTests,
  startGame,
  type ActionPayload,
  type Room,
} from '../rooms';
import type { Tile } from '../game/types';
import * as livePersistence from '../multiplayer/roomLivePersistence';
import { resetRoomGameplayLocksForTests } from '../multiplayer/roomGameplayLock';
import { initRoomSession, resetRoomSessionStoresForTests } from '../multiplayer/roomSession';

export function makeIo() {
  const emit = vi.fn();
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: vi.fn(() => ({ emit, except: vi.fn(() => ({ emit })) })),
    emit,
  } as any;
}

/** mulberry32: a small seeded generator, used for both the dealing shuffle and the move choices so a failing seed reproduces. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Call once at the top level of a test file: resets the room runtime and stubs the persistence seam, around every test. */
export function installRoomHarness(): void {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomGameplayLocksForTests();
    resetRoomSessionStoresForTests();
    initRoomSession(makeIo(), {
      resolveSocketIdentity: async () => ({ username: 'P', userId: null }),
      normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
      normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    } as any);
    vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({ flushedRoomCodes: [] });
    vi.spyOn(livePersistence, 'isLiveRoomDurablyRecoverable').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());
}

/** Plays a whole game with the seeded policy. Returns the finished room. */
export async function playGame(code: string, seed: number, config: Record<string, unknown> = {}): Promise<Room> {
  const rng = seeded(seed);
  vi.spyOn(Math, 'random').mockImplementation(rng); // the dealing shuffle
  const io = makeIo();
  createReservedRoom(code, { skipPregameDraw: true, ...config });
  joinRoom(code, 'seat-a');
  joinRoom(code, 'seat-b');
  const room = getRoom(code);
  room.players = ['seat-a', 'seat-b'];
  room.state = null;
  await startGame(code, io);

  for (let guard = 0; guard < 2000; guard += 1) {
    const state = getRoom(code).state!;
    if (state.gameOver) return getRoom(code);
    if (state.handOver) {
      await nextHand(code, io);
      continue;
    }
    const seat = state.playerIds[state.currentPlayerIndex];
    const plays = getRoomLegalMoves(code, seat).filter((m) => m.type === 'play');
    let action: ActionPayload;
    if (plays.length > 0) {
      const pick = plays[Math.floor(rng() * plays.length)] as { type: 'play'; tile: Tile; position: string };
      action = { type: 'MOVE', move: { tile: pick.tile, position: pick.position as never } };
    } else if (getRoomCanDraw(code, seat)) {
      action = { type: 'DRAW' };
    } else {
      action = { type: 'PASS' };
    }
    await act(code, seat, action, io, () => {});
  }
  throw new Error(`game did not finish (seed ${seed})`);
}
