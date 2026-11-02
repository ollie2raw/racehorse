/**
 * The differential test for multiplayer game records (docs/review-game-record-architecture.md, "Multiplayer", item 6).
 *
 * Real games are played end to end through the real room code (`startGame`, `act`, `nextHand`) with a seeded policy, a record is DERIVED from what the room
 * holds (events + the server's per-player move log), and that record is then REPLAYED in a second room from explicit deals. Every hand's score and the final
 * result must come out identical. If this holds, a multiplayer game can be saved and rebuilt without changing any authority code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createInitialState, generateFullSet, startNewHand } from '../game/engine';
import type { Tile } from '../game/types';
import * as livePersistence from '../multiplayer/roomLivePersistence';
import { resetRoomGameplayLocksForTests } from '../multiplayer/roomGameplayLock';
import { initRoomSession, resetRoomSessionStoresForTests } from '../multiplayer/roomSession';
import { deriveMultiplayerRecord, type MultiplayerRecordDraft } from './multiplayerRecord';

function makeIo() {
  const emit = vi.fn();
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: vi.fn(() => ({ emit, except: vi.fn(() => ({ emit })) })),
    emit,
  } as any;
}

/** mulberry32: a small seeded generator, used for both the dealing shuffle and the move choices so a failing seed reproduces. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tileOf = (key: string): Tile => {
  const [low, high] = key.split('|').map(Number);
  return { low, high };
};
const keyOf = (t: Tile) => `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;

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

/** Plays a whole game with the seeded policy. Returns the finished room. */
async function playGame(code: string, seed: number, config: Record<string, unknown> = {}): Promise<Room> {
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

/** Replays a derived record in a fresh room from its explicit deals. Returns the per-hand scores it produced and the final state. */
async function replay(record: MultiplayerRecordDraft, original: Room): Promise<{ handScores: Array<Record<string, number>>; room: Room }> {
  const code = `RPL${Math.floor(Math.random() * 1e6)}`;
  createReservedRoom(code, { skipPregameDraw: true });
  const room = getRoom(code);
  room.players = [...record.players];
  room.activeTileSetSize = original.activeTileSetSize;
  const full = generateFullSet(original.state!.config.maxPips);
  room.state = createInitialState(record.players, original.state!.config);
  const io = makeIo();
  const handScores: Array<Record<string, number>> = [];

  for (const hand of record.hands) {
    const used = new Set<string>();
    const deck: Tile[] = [];
    for (const seat of record.players) {
      for (const key of hand.deals[seat]) {
        deck.push(tileOf(key));
        used.add(key);
      }
    }
    for (const key of hand.drawn) {
      deck.push(tileOf(key));
      used.add(key);
    }
    for (const t of full) if (!used.has(keyOf(t))) deck.push(t); // never drawn, so their order cannot matter
    room.state = startNewHand(room.state!, deck, hand.starterId);

    for (const action of hand.actions) {
      const payload: ActionPayload =
        action.type === 'MOVE'
          ? { type: 'MOVE', move: { tile: tileOf(action.tile), position: action.position as never } }
          : { type: action.type };
      await act(code, action.seat, payload, io, () => {});
    }
    handScores.push(Object.fromEntries(record.players.map((p) => [p, room.state!.players[p].score])));
  }
  return { handScores, room };
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7);

describe('multiplayer game records: a derived record replays to the same game', () => {
  it.each(SEEDS)('seed %i: every hand and the final result match', async (seed) => {
    const original = await playGame(`DIFF${seed}`, seed);
    const derived = deriveMultiplayerRecord({ players: original.players, events: original.events, ghostMoveLogs: original.ghostMoveLogs });
    expect(derived.ok, JSON.stringify(derived)).toBe(true);
    if (!derived.ok) return;

    const { handScores, room } = await replay(derived.record, original);

    expect(handScores).toEqual(derived.record.hands.map((h) => h.endScores));
    const finalOriginal = Object.fromEntries(original.players.map((p) => [p, original.state!.players[p].score]));
    expect(derived.record.finalScores).toEqual(finalOriginal);
    expect(Object.fromEntries(room.players.map((p) => [p, room.state!.players[p].score]))).toEqual(finalOriginal);
    expect(room.state!.gameOver).toBe(true);
    expect(room.state!.winnerId).toBe(original.state!.winnerId);
    expect(derived.record.winnerId).toBe(original.state!.winnerId);
  });

  it('records more than one hand in a typical game, including draws and passes, so the coverage above means something', async () => {
    let multiHand = 0;
    let draws = 0;
    let passes = 0;
    for (const seed of SEEDS) {
      const original = await playGame(`COV${seed}`, seed);
      const derived = deriveMultiplayerRecord({ players: original.players, events: original.events, ghostMoveLogs: original.ghostMoveLogs });
      if (!derived.ok) continue;
      if (derived.record.hands.length > 1) multiHand += 1;
      for (const hand of derived.record.hands) {
        draws += hand.actions.filter((a) => a.type === 'DRAW').length;
        passes += hand.actions.filter((a) => a.type === 'PASS').length;
      }
      resetRoomRuntimeForTests();
    }
    // Measured on these seeds: every game has several hands and there are hundreds of submitted draws (forced draws after a play are exercised too).
    // Submitted PASS never happens in real play (the engine auto-passes a blocked seat), so that rule has its own unit test below.
    expect(multiHand).toBeGreaterThan(20);
    expect(draws).toBeGreaterThan(200);
    expect(passes).toBe(0);
  });
});

describe('deriveMultiplayerRecord refuses what it cannot rebuild', () => {
  it('a game that has not finished', async () => {
    const io = makeIo();
    createReservedRoom('UNFIN', { skipPregameDraw: true });
    joinRoom('UNFIN', 'seat-a');
    joinRoom('UNFIN', 'seat-b');
    const room = getRoom('UNFIN');
    room.players = ['seat-a', 'seat-b'];
    room.state = null;
    await startGame('UNFIN', io);
    const result = deriveMultiplayerRecord({ players: room.players, events: room.events, ghostMoveLogs: room.ghostMoveLogs });
    expect(result).toEqual({ ok: false, reason: 'not_finished' });
  });

  it('a game whose move log has a gap (a seat with no logged action in a hand)', async () => {
    const original = await playGame('GAP1', 4242);
    const gappy = { ...original.ghostMoveLogs, 'seat-a': [] };
    const result = deriveMultiplayerRecord({ players: original.players, events: original.events, ghostMoveLogs: gappy });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/^missing_deal:seat-a:/);
  });

  describe('which passes count as submitted', () => {
    const ev = (sequence: number, type: string, actorSocketId: string | null, payload: Record<string, unknown> = {}) => ({ sequence, type, actorSocketId, payload }) as never;
    const base = [
      ev(1, 'hand_started', null, { handNumber: 1, currentPlayerId: 'a' }),
    ];
    const end = [
      ev(90, 'hand_ended', 'a', { handNumber: 1, winnerId: 'a', gameOver: true, scores: { a: 60, b: 10 } }),
      ev(91, 'match_ended', 'a', { winnerId: 'a', handNumber: 1, scores: { a: 60, b: 10 } }),
    ];
    const logs = { a: [{ hand_number: 1, hand_before: ['1|2'] }], b: [{ hand_number: 1, hand_before: ['3|4'] }] } as never;
    const actionsOf = (events: unknown[]) => {
      const r = deriveMultiplayerRecord({ players: ['a', 'b'], events: events as never, ghostMoveLogs: logs });
      if (!r.ok) throw new Error(r.reason);
      return r.record.hands[0].actions;
    };

    it('a pass straight after a draw is the draw running out of boneyard, so it is not a submitted action', () => {
      expect(actionsOf([...base, ev(2, 'draw_requested', null, { playerSeatId: 'a' }), ev(3, 'tile_drawn', 'a', { tile: '0|1' }), ev(4, 'turn_passed', 'a'), ...end]))
        .toEqual([{ seat: 'a', type: 'DRAW' }]);
      expect(actionsOf([...base, ev(2, 'draw_requested', null, { playerSeatId: 'a' }), ev(3, 'turn_passed', 'a'), ...end]))
        .toEqual([{ seat: 'a', type: 'DRAW' }]);
    });

    it('a pass that does not follow a draw was submitted', () => {
      expect(actionsOf([...base, ev(2, 'tile_played', 'a', { tile: '1|2', position: 'left' }), ev(3, 'turn_passed', 'b'), ...end]))
        .toEqual([{ seat: 'a', type: 'MOVE', tile: '1|2', position: 'left' }, { seat: 'b', type: 'PASS' }]);
    });

    it('tiles drawn by a forced draw after a play are recorded as drawn, not as actions', () => {
      const result = deriveMultiplayerRecord({
        players: ['a', 'b'],
        events: [...base, ev(2, 'tile_played', 'a', { tile: '1|2', position: 'left', forcedDraw: true }), ev(3, 'tile_drawn', 'a', { tile: '5|6' }), ...end] as never,
        ghostMoveLogs: logs,
      });
      expect(result.ok && result.record.hands[0].actions).toEqual([{ seat: 'a', type: 'MOVE', tile: '1|2', position: 'left' }]);
      expect(result.ok && result.record.hands[0].drawn).toEqual(['5|6']);
    });
  });

  it('anything but two players', () => {
    expect(deriveMultiplayerRecord({ players: ['a', 'b', 'c'], events: [], ghostMoveLogs: {} })).toEqual({ ok: false, reason: 'not_two_players' });
  });
});
