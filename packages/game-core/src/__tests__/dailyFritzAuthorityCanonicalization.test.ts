/**
 * GC-5 (HARDENING_PLAN §7.3) — confirmed live incident, 2026-09-04: the v1
 * authority digest embedded `state.board` via raw `JSON.stringify`, which is
 * key-insertion-order sensitive. Two structurally-identical `GameState`s built
 * by different code paths (the client and server do not always construct a
 * board object the same way) could digest differently despite representing the
 * exact same game state, producing a false `fritz_state_mismatch` — this fired
 * 12 times in prod since 2026-08-01, always on exactly one hand of an otherwise
 * cleanly-verifying run (the signature of a construction-order artifact, not a
 * real divergence).
 *
 * v2 fixes this: the digest is computed from a canonical (recursively
 * key-sorted) projection, so it depends only on *value*, never on how the
 * objects holding that value happened to be built.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  canonicalizeDailyFritzAuthorityStateV1,
  canonicalizeDailyFritzAuthorityStateV2,
  getDailyFritzAuthorityStateDigest,
  type BoardState,
  type GameState,
  type HubDouble,
} from '../index';

/** Same fields, assigned in reverse key order — still deep-equal, different insertion order. */
function reorderKeys<T extends object>(value: T): T {
  const out = {} as T;
  for (const key of Object.keys(value).reverse() as (keyof T)[]) {
    out[key] = value[key];
  }
  return out;
}

function baseBoard(): BoardState {
  const crossedHub: HubDouble = {
    hubId: 0,
    laneType: 'mainline',
    laneRef: 'mainline',
    tileIndex: 1,
    mainlineIndex: 1,
    hubValue: 3,
    isCrossed: true,
    leftSideFilled: true,
    rightSideFilled: true,
    branches: [
      { tiles: [{ tile: { low: 1, high: 3 }, orientation: 'vertical-normal' }], openEnd: 1, openEndIsDouble: false },
      null,
    ],
  };
  return {
    mainLine: [
      { tile: { low: 2, high: 3 }, orientation: 'horizontal-normal' },
      { tile: { low: 3, high: 3 }, orientation: 'vertical-normal' },
      { tile: { low: 3, high: 5 }, orientation: 'horizontal-flipped' },
    ],
    leftEnd: 2,
    rightEnd: 5,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    hubDoubles: [crossedHub],
  };
}

/** The same board, with every nested object's keys assigned in reverse order. */
function reorderedBoard(): BoardState {
  const b = baseBoard();
  return reorderKeys({
    ...b,
    mainLine: b.mainLine.map((placed) => reorderKeys({ ...placed, tile: reorderKeys({ ...placed.tile }) })),
    hubDoubles: b.hubDoubles.map((hub) =>
      reorderKeys({
        ...hub,
        branches: hub.branches.map((branch) =>
          branch === null
            ? null
            : reorderKeys({
                ...branch,
                tiles: branch.tiles.map((placed) => reorderKeys({ ...placed, tile: reorderKeys({ ...placed.tile }) })),
              }),
        ),
      }),
    ),
  });
}

function stateWithBoard(board: BoardState): GameState {
  return {
    config: DEFAULT_CONFIG,
    playerIds: ['player', 'fritz'],
    players: {
      player: { id: 'player', hand: [{ low: 4, high: 4 }], score: 12 },
      fritz: { id: 'fritz', hand: [{ low: 6, high: 6 }], score: 7 },
    },
    board,
    boneyard: [{ low: 1, high: 2 }],
    deadTiles: [{ low: 0, high: 0 }],
    currentPlayerIndex: 0,
    handNumber: 3,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 18,
  };
}

describe('daily Fritz authority digest — construction-order independence (GC-5)', () => {
  it('sanity: the two boards really are deep-equal, just built with different key order', () => {
    expect(reorderedBoard()).toEqual(baseBoard());
    // ...but NOT the same object identity / JSON text, proving this is a real order difference.
    expect(JSON.stringify(reorderedBoard())).not.toBe(JSON.stringify(baseBoard()));
  });

  it('v1 (legacy) is order-sensitive — this is the confirmed bug, kept only for back-compat', () => {
    const a = canonicalizeDailyFritzAuthorityStateV1(stateWithBoard(baseBoard()));
    const b = canonicalizeDailyFritzAuthorityStateV1(stateWithBoard(reorderedBoard()));
    expect(a).not.toBe(b);
  });

  it('v2 (current) is construction-order independent — two structurally-equal GameStates, built with different key insertion order, produce the same canonical projection', () => {
    const a = canonicalizeDailyFritzAuthorityStateV2(stateWithBoard(baseBoard()));
    const b = canonicalizeDailyFritzAuthorityStateV2(stateWithBoard(reorderedBoard()));
    expect(a).toBe(b);
  });

  it('v2 digest matches for the same GameState built two different ways', () => {
    const digestA = getDailyFritzAuthorityStateDigest(stateWithBoard(baseBoard()), 2);
    const digestB = getDailyFritzAuthorityStateDigest(stateWithBoard(reorderedBoard()), 2);
    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^df-state-v2:[0-9a-f]{8}$/);
  });

  it('v1 digest (still exposed for in-flight attempts) is prefixed df-state-v1 and does NOT match v2 for the same state', () => {
    const state = stateWithBoard(baseBoard());
    const v1 = getDailyFritzAuthorityStateDigest(state, 1);
    const v2 = getDailyFritzAuthorityStateDigest(state, 2);
    expect(v1).toMatch(/^df-state-v1:[0-9a-f]{8}$/);
    expect(v2).toMatch(/^df-state-v2:[0-9a-f]{8}$/);
    expect(v1).not.toBe(v2);
  });

  it('v2 still detects a REAL state difference (not just insensitive to everything)', () => {
    const a = getDailyFritzAuthorityStateDigest(stateWithBoard(baseBoard()), 2);
    const changed = stateWithBoard(baseBoard());
    const mutablePlayers = changed.players as Record<string, { score: number }>;
    mutablePlayers.fritz.score = 99;
    const b = getDailyFritzAuthorityStateDigest(changed, 2);
    expect(a).not.toBe(b);
  });

  it('getDailyFritzAuthorityStateDigest defaults to the current version', () => {
    const state = stateWithBoard(baseBoard());
    expect(getDailyFritzAuthorityStateDigest(state)).toBe(getDailyFritzAuthorityStateDigest(state, 2));
  });
});
