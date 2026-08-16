import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { GameState } from '../game/types';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: () => {}, except: () => ({ emit: () => {} }) }),
  } as any;
}

/**
 * Claim 2's load-bearing assertion is that room.state.players[*].hand/board
 * can ONLY be mutated through the gated act() pipeline. If that claim were
 * ever wrong — a future admin route, a buggy reconnect path, anything that
 * writes room.state.players[seat].hand directly — this test proves the
 * fail-closed backstop (verifyPlayerMoveLog) still catches the resulting
 * inconsistent move log at completion time, rather than silently accepting
 * a fabricated hand.
 */
describe('hand-state tamper backstop', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetRoomGameplayLocksForTests();
    // The tile-count invariant (server/src/game/invariants.ts) is a separate,
    // already-existing backstop that would independently reject this
    // synthetic scenario's imperfect tile accounting. Soften it here so this
    // test can isolate and prove the specific claim under test —
    // verifyPlayerMoveLog — without that unrelated backstop short-circuiting
    // first.
    vi.stubEnv('SOFT_GAME_INVARIANTS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifyPlayerMoveLog rejects a move log produced after room.state.players[seat].hand was mutated directly, bypassing act()', async () => {
    const roomCode = 'TAMPER1';
    createReservedRoom(roomCode);
    joinRoom(roomCode, 'seat-1');
    joinRoom(roomCode, 'seat-2');
    const room = getRoom(roomCode);
    room.players = ['seat-1', 'seat-2'];

    const initialState: GameState = {
      config: {
        maxPips: 6,
        tilesPerPlayer: 7,
        deadTileCount: 2,
        scoringMultiple: 5,
        blockedHandRule: 'lowestPips',
        endHandBonus: 'sumOpponentPenalties',
        winningScore: 60,
      },
      playerIds: ['seat-1', 'seat-2'],
      players: {
        'seat-1': { id: 'seat-1', hand: [t(6, 6), t(2, 2)], score: 0 },
        'seat-2': { id: 'seat-2', hand: [t(4, 4)], score: 0 },
      },
      board: null,
      boneyard: [],
      deadTiles: [],
      currentPlayerIndex: 0,
      handNumber: 1,
      handOver: false,
      gameOver: false,
      sequence: 0,
    } as unknown as GameState;
    room.state = initialState;
    room.activeTileSetSize = 4;

    const io = makeIo();

    // Move 1: a genuine, gated action — seat-1 legitimately opens with the
    // double 6|6 on the empty board.
    const result1 = await act(
      roomCode,
      'seat-1',
      { type: 'MOVE', requestId: 'm1', move: { tile: { low: 6, high: 6 }, position: 'left' } },
      io,
      () => {},
    );
    expect(result1.room.state?.players['seat-1'].hand).toHaveLength(1);

    // Force it back to seat-1's turn (a blocked seat-2 may have auto-passed
    // the hand to "over" — force it back open) and, critically, mutate the
    // hand DIRECTLY — this is the bypass under test, not going through act().
    room.state!.currentPlayerIndex = 0;
    room.state!.handOver = false;
    room.state!.players['seat-1'].hand.push(t(6, 3));

    // Move 2: seat-1 "legitimately" plays the tile that was just smuggled
    // into their hand by direct mutation (connects to the open 6 end left by
    // move 1). The engine itself allows it — it trusts room.state as ground
    // truth, exactly as Claim 2's premise says.
    const result2 = await act(
      roomCode,
      'seat-1',
      { type: 'MOVE', requestId: 'm2', move: { tile: { low: 3, high: 6 }, position: 'left' } },
      io,
      () => {},
    );
    expect(result2.room.state?.gameOver).toBeFalsy();

    const moveLog = room.ghostMoveLogs['seat-1'] ?? [];
    expect(moveLog.length).toBeGreaterThanOrEqual(2);

    const verification = verifyPlayerMoveLog(moveLog);

    expect(verification.ok).toBe(false);
    if (!verification.ok) {
      expect(verification.reason).toContain('hand_before is not consistent');
    }
  });
});
