/**
 * A scoring play or a double keeps the turn; if nothing is then playable, the
 * engine draws until a play appears or the drawable boneyard runs out, and in
 * the latter case passes — handing the turn on. rooms.ts used to ask
 * getLegalMoves for the mover after that pass, which throws "It is not X's
 * turn", rejecting a legal move (for humans and Fritz alike) after the ghost
 * move and tile_played event had already been written.
 *
 * Fixtures are exact positions (10 physical tiles; the room's active tile-set
 * size says so), found by search and checked against the engine below.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, Tile } from '../game/types';
import { applyMove, getLegalMoves } from '../game/engine';
import { collectGameStateViolations, tilesOnBoard } from '../game/invariants';
import { simulatePlacement } from '../game/scoring';
import { act, createReservedRoom, getRoom, resetRoomRuntimeForTests, type ActionPayload } from '../rooms';
import {
  initRoomSession,
  performAutomaticSeatAction,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';

const t = (low: number, high: number): Tile => ({ low: Math.min(low, high), high: Math.max(low, high) });
const tk = (key: string): Tile => t(Number(key[0]), Number(key[1]));
const FRITZ = 'bot:fritz:handoff:1';

type Fixture = {
  board: [string, string];
  moverHand: string[];
  otherHand: string[];
  /** Drawable boneyard, in draw order. */
  drawable: string[];
  /** The locked tail (deadTileCount = 2). */
  locked: [string, string];
  move: { tile: string; position: 'left' | 'right' };
};

/** Board [1|5][5|2] (ends 1, 2). [2|4] on the right makes ends 1+4 = 5 (scores); [5|5] is then dead; both drawable tiles are dead. */
const SCORING_LOCKS_OUT: Fixture = {
  board: ['15', '25'], moverHand: ['24', '55'], otherHand: ['00', '16'],
  drawable: ['06', '26'], locked: ['12', '66'], move: { tile: '24', position: 'right' },
};
/** Board [0|3][1|1]. The double [0|0] on the left keeps the turn; [5|5] is dead; both drawable tiles are dead. */
const DOUBLE_LOCKS_OUT: Fixture = {
  board: ['03', '11'], moverHand: ['55', '00'], otherHand: ['02', '16'],
  drawable: ['45', '66'], locked: ['56', '25'], move: { tile: '00', position: 'left' },
};
/** Same as SCORING_LOCKS_OUT, but the second drawable tile [1|4] is playable: the ordinary forced draw. */
const SCORING_DRAWS_PLAYABLE: Fixture = { ...SCORING_LOCKS_OUT, drawable: ['06', '14'] };

function buildState(f: Fixture, mover: string, other: string): GameState {
  let board = simulatePlacement(null, tk(f.board[0]), 'left');
  board = simulatePlacement(board, tk(f.board[1]), 'right');
  return {
    config: {
      maxPips: 6, tilesPerPlayer: 7, deadTileCount: 2, scoringMultiple: 5,
      blockedHandRule: 'lowestPips', endHandBonus: 'sumOpponentPenalties', winningScore: 60,
    },
    playerIds: [mover, other],
    players: {
      [mover]: { id: mover, hand: f.moverHand.map(tk), score: 0 },
      [other]: { id: other, hand: f.otherHand.map(tk), score: 0 },
    },
    board,
    boneyard: [...f.drawable, ...f.locked].map(tk),
    deadTiles: f.locked.map(tk),
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 2,
  } as GameState;
}

function makeIo() {
  const emit = vi.fn();
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: vi.fn(() => ({ emit, except: vi.fn(() => ({ emit })) })),
    emit,
  } as any;
}

let seq = 0;
function seedRoom(f: Fixture, mover: string, other = 'seat-b'): { code: string; state: GameState } {
  seq += 1;
  const code = `FDH${seq}`;
  const state = buildState(f, mover, other);
  const room = createReservedRoom(code, { winningScore: 60 });
  room.players = [mover, other];
  room.state = state;
  room.activeTileSetSize = 10;
  room.matchId = `00000000-0000-4000-8000-00000000000${seq % 10}`;
  setRoomRoster(code, [mover, other].map((id) => ({
    id, socketId: '', username: id, userId: id.startsWith('bot:') ? null : `user-${id}`,
  })));
  return { code, state };
}

const moveAction = (f: Fixture): ActionPayload => ({ type: 'MOVE', move: { tile: tk(f.move.tile), position: f.move.position } });
const tileKeyOf = (tile: Tile) => `${Math.min(tile.low, tile.high)}-${Math.max(tile.low, tile.high)}`;

beforeEach(() => {
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async () => ({ username: 'P', userId: null }),
    normalizeUsername: (v: unknown) => (typeof v === 'string' ? v : 'Guest'),
    normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped',
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    maybeFinalizeTournamentMatch: () => undefined,
    persistRoomMatchLog: async () => undefined,
    onGameOver: () => null,
    finalizeTournamentMatch: () => undefined,
  } as any);
});

describe('forced draw that ends in a locked-boneyard pass', () => {
  it('the fixtures are what they claim (checked against the engine)', () => {
    for (const f of [SCORING_LOCKS_OUT, DOUBLE_LOCKS_OUT]) {
      const state = buildState(f, 'seat-a', 'seat-b');
      const { state: after, forcedDraw } = applyMove(state, 'seat-a', { type: 'play', tile: tk(f.move.tile), position: f.move.position });
      expect(forcedDraw).not.toBeNull();
      expect(after.playerIds[after.currentPlayerIndex]).toBe('seat-b');
      expect(after.handOver).toBe(false);
      // The bug: asking for the mover's legal moves now throws.
      expect(() => getLegalMoves(after, 'seat-a')).toThrow(/It is not seat-a's turn/);
    }
  });

  for (const [name, f] of [['a scoring play', SCORING_LOCKS_OUT], ['a double', DOUBLE_LOCKS_OUT]] as const) {
    it(`${name}: the move is accepted, the drawable boneyard is drawn, and the turn passes to the opponent`, async () => {
      const { code, state } = seedRoom(f, 'seat-a');

      const result = await act(code, 'seat-a', moveAction(f), makeIo(), () => {});

      const after = getRoom(code).state!;
      expect(after.playerIds[after.currentPlayerIndex]).toBe('seat-b');
      expect(after.consecutivePasses).toBe(1);
      expect(after.sequence).toBeGreaterThan(state.sequence);
      expect(after.boneyard.map(tileKeyOf)).toEqual(f.locked.map((k) => tileKeyOf(tk(k))));
      // Mover: played one tile, drew both drawable tiles.
      expect(after.players['seat-a'].hand).toHaveLength(f.moverHand.length - 1 + f.drawable.length);
      expect(result.forcedDrawAnimation).toMatchObject({ playerId: 'seat-a', stoppedReason: 'locked_pass' });
      expect(result.forcedDrawAnimation!.steps).toHaveLength(f.drawable.length);
      // The opponent can now move.
      expect(getLegalMoves(after, 'seat-b').some((m) => m.type === 'play')).toBe(true);
    });
  }

  it('a human seat executes it through act() (the game:action path) without the bogus turn error', async () => {
    const { code } = seedRoom(SCORING_LOCKS_OUT, 'seat-a');

    await expect(act(code, 'seat-a', moveAction(SCORING_LOCKS_OUT), makeIo(), () => {})).resolves.toBeTruthy();
  });

  it('Fritz executes the same position through its automatic-action path', async () => {
    const { code, state } = seedRoom(DOUBLE_LOCKS_OUT, FRITZ);

    const after = await performAutomaticSeatAction(code, FRITZ, moveAction(DOUBLE_LOCKS_OUT));

    expect(after).toMatchObject({ currentSeatId: 'seat-b', consecutivePasses: 1, handOver: false, gameOver: false });
    expect(after!.sequence).toBeGreaterThan(state.sequence);
  });

  it('state, event log and ghost moves agree after the move', async () => {
    const f = SCORING_LOCKS_OUT;
    const { code } = seedRoom(f, 'seat-a');
    const room = getRoom(code);
    const eventsBefore = room.events.length;

    await act(code, 'seat-a', moveAction(f), makeIo(), () => {});

    expect(collectGameStateViolations(room.state!, 10)).toEqual([]);
    const events = room.events.slice(eventsBefore);
    expect(events.filter((e) => e.type === 'tile_played')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tile_drawn')).toHaveLength(f.drawable.length);
    const ghost = room.ghostMoveLogs['seat-a'] ?? [];
    const played = ghost.filter((g) => g.tile_played !== null && g.branch !== 'pass' && g.branch !== 'draw');
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({ forced_draw: true });
    // The logged play is the tile now on the board, and nothing else was logged as played.
    expect(tilesOnBoard(room.state!.board).map(tileKeyOf)).toContain(tileKeyOf(tk(f.move.tile)));
    expect(events.find((e) => e.type === 'tile_played')?.payload).toMatchObject({ forcedDraw: true });
  });

  it('the ordinary forced draw is unchanged: it stops at the first playable tile and the mover keeps the turn', async () => {
    const f = SCORING_DRAWS_PLAYABLE;
    const { code } = seedRoom(f, 'seat-a');

    const result = await act(code, 'seat-a', moveAction(f), makeIo(), () => {});

    const after = getRoom(code).state!;
    expect(after.playerIds[after.currentPlayerIndex]).toBe('seat-a');
    expect(result.forcedDrawAnimation).toMatchObject({ stoppedReason: 'playable' });
    expect(result.forcedDrawAnimation!.steps).toHaveLength(2);
    expect(getLegalMoves(after, 'seat-a').some((m) => m.type === 'play')).toBe(true);
  });
});
