import { describe, expect, it } from 'vitest';
import { generateFullSet, tileEquals, type Tile } from '@racehorse/game-core';
import { GAME_COMMAND_VERSION, GAME_RULES_VERSION } from '@racehorse/game-core';
import {
  REVIEW_ENGINE_CONTRACT_VERSION,
  REVIEW_POSITION_SNAPSHOT_VERSION,
  REVIEW_STATE_DIGEST_VERSION,
  type ReviewKnownMissingPipEvidence,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import type { BoardState } from '@racehorse/game-core/types';
import { sampleHiddenAllocation } from '../sampleHiddenAllocation';

const FULL_SET = generateFullSet(6);

function boardFromTiles(tiles: readonly Tile[]): BoardState {
  return {
    mainLine: tiles.map((tile) => ({ tile, orientation: 'horizontal-normal' as const })),
    leftEnd: 0,
    rightEnd: 0,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    hubDoubles: [],
  };
}

function makeSnapshot(args: {
  actorHand: readonly Tile[];
  boardTiles: readonly Tile[];
  opponentTileCount: number;
  boneyard: { physicalCount: number; drawableCount: number; deadCount: number };
  knownMissingPipEvidence?: readonly ReviewKnownMissingPipEvidence[];
}): ReviewPositionSnapshotV2 {
  return {
    snapshotVersion: REVIEW_POSITION_SNAPSHOT_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    commandVersion: GAME_COMMAND_VERSION,
    reviewEngineVersion: REVIEW_ENGINE_CONTRACT_VERSION,
    stateDigestVersion: REVIEW_STATE_DIGEST_VERSION,
    identifiers: {
      sessionId: 'session-1',
      gameId: 'game-1',
      handId: 'hand-1',
      decisionId: 'session-1:you:1',
      mode: 'play-vs-fritz',
      gameNumber: 1,
      handNumber: 1,
      actionNumber: 1,
      turnSequence: 0,
      actorId: 'you',
      opponentId: 'bot',
    },
    preAction: {
      board: boardFromTiles(args.boardTiles),
      actorHand: args.actorHand,
      opponentTileCount: args.opponentTileCount,
      boneyard: args.boneyard,
      scores: { actor: 0, opponent: 0 },
      winningTarget: 60,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: args.knownMissingPipEvidence ?? [],
    },
    legalActions: [],
    actualAction: { kind: 'pass' },
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  };
}

function evidenceExcludingPip(pip: number): ReviewKnownMissingPipEvidence {
  return {
    opponentId: 'bot',
    pip,
    reason: 'passed_on_open_end',
    observedHandNumber: 1,
    observedSequence: 0,
    openEnds: [pip],
  };
}

// generateFullSet(6) index map, by construction (nested for-loops, high 0..6,
// low 0..high) — verified directly against packages/game-core/src/types.ts:
//  0:(0,0) 1:(0,1) 2:(1,1) 3:(0,2) 4:(1,2) 5:(2,2) 6:(0,3) 7:(1,3) 8:(2,3)
//  9:(3,3) 10:(0,4) 11:(1,4) 12:(2,4) 13:(3,4) 14:(4,4) 15:(0,5) 16:(1,5)
//  17:(2,5) 18:(3,5) 19:(4,5) 20:(5,5) 21:(0,6) 22:(1,6) 23:(2,6) 24:(3,6)
//  25:(4,6) 26:(5,6) 27:(6,6)
//
// "Typical" fixture: actorHand = first 3, board = next 15, hidden pool = last
// 10 -- (3,5)(4,5)(5,5)(0,6)(1,6)(2,6)(3,6)(4,6)(5,6)(6,6). 7 of those 10
// contain pip 6; only 3 -- (3,5)(4,5)(5,5) -- contain pip 5.
const TYPICAL_ACTOR_HAND = FULL_SET.slice(0, 3);
const TYPICAL_BOARD_TILES = FULL_SET.slice(3, 18);
const TYPICAL_HIDDEN_POOL = FULL_SET.slice(18); // 10 tiles

function typicalSnapshot(evidence: ReviewKnownMissingPipEvidence[] = []): ReviewPositionSnapshotV2 {
  return makeSnapshot({
    actorHand: TYPICAL_ACTOR_HAND,
    boardTiles: TYPICAL_BOARD_TILES,
    opponentTileCount: 4,
    boneyard: { physicalCount: 6, drawableCount: 5, deadCount: 1 },
    knownMissingPipEvidence: evidence,
  });
}

function hasPip(tile: Tile, pip: number): boolean {
  return tile.low === pip || tile.high === pip;
}

function canonicalKey(tile: Tile): string {
  const lo = Math.min(tile.low, tile.high);
  const hi = Math.max(tile.low, tile.high);
  return `${lo}-${hi}`;
}

function sortedKeys(tiles: readonly Tile[]): string[] {
  return tiles.map(canonicalKey).sort();
}

describe('sampleHiddenAllocation (B1)', () => {
  it('never places an excluded pip in the opponent hand, across multiple seeds', () => {
    // Exclude pip 5 -- present on exactly 3 of the typical fixture's 10
    // hidden tiles, leaving 7 eligible for a 4-tile opponent hand (feasible).
    const snapshot = typicalSnapshot([evidenceExcludingPip(5)]);

    for (const seed of ['seed-a', 'seed-b', 'seed-c', 42, 'another-seed']) {
      const result = sampleHiddenAllocation(snapshot, seed);
      expect(result).not.toBeNull();
      for (const tile of result!.opponentHand) {
        expect(hasPip(tile, 5)).toBe(false);
      }
    }
  });

  it('is seed-stable: the same snapshot and seed produce a byte-identical result', () => {
    const snapshot = typicalSnapshot();
    const first = sampleHiddenAllocation(snapshot, 'stable-seed');
    const second = sampleHiddenAllocation(snapshot, 'stable-seed');
    expect(first).toEqual(second);
    // Called again to rule out any accidental cross-call mutation of the input.
    const third = sampleHiddenAllocation(snapshot, 'stable-seed');
    expect(third).toEqual(first);
  });

  it('different seeds produce different allocations (the RNG is actually consumed)', () => {
    const snapshot = typicalSnapshot();
    const seeds = ['s1', 's2', 's3', 's4', 's5'];
    const results = seeds.map((seed) => sampleHiddenAllocation(snapshot, seed));
    expect(results.every((r) => r !== null)).toBe(true);
    const opponentHandKeys = results.map((r) => sortedKeys(r!.opponentHand).join(','));
    expect(new Set(opponentHandKeys).size).toBeGreaterThan(1);
  });

  it('satisfies the arithmetic invariant: counts match, and the four sources reconstruct exactly one full domino set', () => {
    const snapshot = typicalSnapshot();
    const result = sampleHiddenAllocation(snapshot, 'invariant-seed');
    expect(result).not.toBeNull();
    const { opponentHand, boneyardDrawable, boneyardDead } = result!;

    expect(opponentHand.length).toBe(snapshot.preAction.opponentTileCount);
    expect(boneyardDrawable.length).toBe(snapshot.preAction.boneyard.drawableCount);
    expect(boneyardDead.length).toBe(snapshot.preAction.boneyard.deadCount);

    const reconstructed = sortedKeys([
      ...TYPICAL_ACTOR_HAND,
      ...TYPICAL_BOARD_TILES,
      ...opponentHand,
      ...boneyardDrawable,
      ...boneyardDead,
    ]);
    const expected = sortedKeys(FULL_SET);
    expect(reconstructed).toEqual(expected);
  });

  it('returns null, deterministically, when evidence excludes more than the remaining pool can support', () => {
    // Concrete infeasible scenario, reasoned from the research pass: 0-tile
    // actor hand, a 20-tile board, leaving an 8-tile hidden pool -- the 7
    // pip-6 tiles plus (0,5). Excluding pip 6 leaves only (0,5) eligible (1
    // tile) for a 7-tile opponent hand. 0 + 7 (opponent) + 1 (boneyard) + 20
    // (board) = 28.
    const pip6Tiles = FULL_SET.filter((t) => hasPip(t, 6));
    expect(pip6Tiles.length).toBe(7);
    const zeroFive = FULL_SET.find((t) => tileEquals(t, { low: 0, high: 5 }))!;
    const hiddenTiles = [...pip6Tiles, zeroFive];
    expect(hiddenTiles.length).toBe(8);
    const boardTiles = FULL_SET.filter((t) => !hiddenTiles.some((h) => tileEquals(h, t)));
    expect(boardTiles.length).toBe(20);

    const snapshot = makeSnapshot({
      actorHand: [],
      boardTiles,
      opponentTileCount: 7,
      boneyard: { physicalCount: 1, drawableCount: 1, deadCount: 0 },
      knownMissingPipEvidence: [evidenceExcludingPip(6)],
    });

    expect(sampleHiddenAllocation(snapshot, 'infeasible-seed')).toBeNull();
    // Deterministic null, not a flaky one.
    expect(sampleHiddenAllocation(snapshot, 'infeasible-seed')).toBeNull();
    expect(sampleHiddenAllocation(snapshot, 'a-different-seed')).toBeNull();
  });

  it('produces a valid, count-correct allocation with no evidence at all (no constraint pruning)', () => {
    const snapshot = typicalSnapshot([]);
    const result = sampleHiddenAllocation(snapshot, 'no-evidence-seed');
    expect(result).not.toBeNull();
    expect(result!.opponentHand.length).toBe(4);
    expect(result!.boneyardDrawable.length).toBe(5);
    expect(result!.boneyardDead.length).toBe(1);
  });
});
