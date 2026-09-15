import { afterEach, describe, expect, it, vi } from 'vitest';
import { simulatePlacement, type Tile } from '@racehorse/game-core';
import {
  GAME_COMMAND_VERSION,
  GAME_RULES_VERSION,
  REVIEW_ENGINE_CONTRACT_VERSION,
  REVIEW_POSITION_SNAPSHOT_VERSION,
  REVIEW_STATE_DIGEST_VERSION,
  type ReviewAction,
  type ReviewKnownMissingPipEvidence,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import type { BoardState } from '@racehorse/game-core/types';
import type { ReviewSearchBudget } from '../evaluateReviewPosition';
import * as searchGameTreeModule from '../searchGameTree';
import * as sampleHiddenAllocationModule from '../sampleHiddenAllocation';

vi.mock('../searchGameTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../searchGameTree')>();
  return { ...actual, searchGameTree: vi.fn(actual.searchGameTree) };
});
vi.mock('../sampleHiddenAllocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sampleHiddenAllocation')>();
  return { ...actual, sampleHiddenAllocation: vi.fn(actual.sampleHiddenAllocation) };
});

// Imported after the mocks above so the module under test picks up the
// mocked bindings of searchGameTree / sampleHiddenAllocation.
import { solveMidgameDeterminization } from '../solveMidgameDeterminization';

afterEach(() => {
  vi.mocked(searchGameTreeModule.searchGameTree).mockClear();
  vi.mocked(sampleHiddenAllocationModule.sampleHiddenAllocation).mockClear();
});

// Self-authored midgame scenario, same mirror-symmetry construction as B2's
// tie-break test: a single uncrossed double (2,2) on the board (leftEnd ===
// rightEnd === 2), and the actor holding exactly one tile, (2,6), that
// matches both open ends. Playing it at 'left' vs 'right' produces the exact
// same resulting open-end set either way -- an exact mirror, not a
// contrived tie -- which this suite uses to make convergence/tie-break
// assertions independently verifiable by proof rather than by trusting the
// implementation's own arithmetic. Unlike B2, boneyard.drawableCount is
// nonzero here (this is midgame scope, not locked-yard scope).
const BOARD: BoardState = simulatePlacement(null, { low: 2, high: 2 }, 'left');
const ACTOR_HAND: readonly Tile[] = [{ low: 2, high: 6 }];

function legalActionsFor(): ReviewAction[] {
  return [
    { kind: 'play', tile: { low: 2, high: 6 }, position: 'left' },
    { kind: 'play', tile: { low: 2, high: 6 }, position: 'right' },
  ];
}

function makeSnapshot(args: {
  opponentTileCount: number;
  boneyardDrawableCount: number;
  boneyardDeadCount: number;
  knownMissingPipEvidence?: readonly ReviewKnownMissingPipEvidence[];
}): ReviewPositionSnapshotV2 {
  const legalActions = legalActionsFor();
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
      board: BOARD,
      actorHand: ACTOR_HAND,
      opponentTileCount: args.opponentTileCount,
      boneyard: {
        physicalCount: args.boneyardDrawableCount + args.boneyardDeadCount,
        drawableCount: args.boneyardDrawableCount,
        deadCount: args.boneyardDeadCount,
      },
      scores: { actor: 0, opponent: 0 },
      winningTarget: 1_000_000,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: args.knownMissingPipEvidence ?? [],
    },
    legalActions,
    actualAction: legalActions[0],
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  };
}

// Hidden pool = 28 - board(1) - actorHand(1) = 26 tiles, no evidence
// exclusion -> all 26 eligible. C(26,3) = 2600 -- a genuinely large,
// unenumerable-in-practice space, appropriate for a "samplable, not
// exhaustible" midgame scenario.
function feasibleSnapshot(): ReviewPositionSnapshotV2 {
  return makeSnapshot({ opponentTileCount: 3, boneyardDrawableCount: 6, boneyardDeadCount: 17 });
}

// Evidence excludes every pip 0-6 -> eligibleForOpponent is empty ->
// C(0, opponentTileCount) = 0 for any opponentTileCount > 0.
function globallyInfeasibleSnapshot(): ReviewPositionSnapshotV2 {
  return makeSnapshot({
    opponentTileCount: 3,
    boneyardDrawableCount: 6,
    boneyardDeadCount: 17,
    knownMissingPipEvidence: [0, 1, 2, 3, 4, 5, 6].map((pip) => ({
      opponentId: 'bot',
      pip,
      reason: 'passed_on_open_end',
      observedHandNumber: 1,
      observedSequence: 0,
      openEnds: [pip],
    })),
  });
}

// The real hidden_information_ambiguity fixture ("hidden-allocation-
// ambiguous-midgame", seed 'review-corpus:0', actionIndex 2), pulled
// verbatim from packages/game-core's built fixture corpus during B3
// research. Not reachable directly from review-engine (the corpus isn't
// exported outside game-core's package boundary), so hardcoded here as a
// literal -- same approach B1/B2's tests already use for self-authored
// snapshots. actorHand has 7 tiles, opponentTileCount 5, boneyard.
// drawableCount 12 (genuinely nonzero, unlike B2's scope), no evidence yet
// at this early decision, 3 legal actions.
const AMBIGUOUS_MIDGAME_SNAPSHOT: ReviewPositionSnapshotV2 = {
  snapshotVersion: REVIEW_POSITION_SNAPSHOT_VERSION,
  rulesVersion: GAME_RULES_VERSION,
  commandVersion: GAME_COMMAND_VERSION,
  reviewEngineVersion: REVIEW_ENGINE_CONTRACT_VERSION,
  stateDigestVersion: REVIEW_STATE_DIGEST_VERSION,
  identifiers: {
    sessionId: 'fixture-session:review-corpus:0',
    gameId: 'fixture-game:review-corpus:0',
    handId: 'fixture-game:review-corpus:0:hand-4',
    decisionId: 'hidden-allocation-ambiguous-midgame',
    mode: 'fixture',
    gameNumber: 1,
    actionNumber: 3,
    handNumber: 4,
    turnSequence: 43,
    actorId: 'opponent',
    opponentId: 'player',
  },
  preAction: {
    board: {
      mainLine: [
        { tile: { low: 0, high: 3 }, orientation: 'horizontal-flipped' },
        { tile: { low: 0, high: 0 }, orientation: 'vertical-normal' },
      ],
      leftEnd: 3,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: true,
      hubDoubles: [
        {
          hubId: 0,
          laneType: 'mainline',
          laneRef: 'mainline',
          tileIndex: 1,
          mainlineIndex: 1,
          hubValue: 0,
          isCrossed: false,
          leftSideFilled: true,
          rightSideFilled: false,
          branches: [],
        },
      ],
    },
    actorHand: [
      { low: 0, high: 4 },
      { low: 4, high: 5 },
      { low: 0, high: 1 },
      { low: 2, high: 2 },
      { low: 4, high: 6 },
      { low: 3, high: 6 },
      { low: 2, high: 4 },
    ],
    opponentTileCount: 5,
    boneyard: { physicalCount: 14, drawableCount: 12, deadCount: 2 },
    scores: { actor: 52, opponent: 48 },
    winningTarget: 60,
    consecutivePasses: 0,
    handOpen: true,
    knownMissingPipEvidence: [],
  },
  legalActions: [
    { kind: 'play', tile: { low: 0, high: 1 }, position: 'right' },
    { kind: 'play', tile: { low: 0, high: 4 }, position: 'right' },
    { kind: 'play', tile: { low: 3, high: 6 }, position: 'left' },
  ],
  actualAction: { kind: 'play', tile: { low: 3, high: 6 }, position: 'left' },
  outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 52 },
  integrity: {
    authorityPreStateDigest: 'review-state-v1:f3a11745',
    authorityPostStateDigest: 'review-state-v1:84cd277a',
  },
};

const GENEROUS_BUDGET = (maxHiddenStateSamples: number): ReviewSearchBudget => ({
  maxNodes: 1_000_000,
  maxHiddenStateSamples,
});

describe('solveMidgameDeterminization (B3)', () => {
  it('returns a non-null result with one candidate per legal action, hiddenStateSamples matching the requested budget, complete at a generous budget', () => {
    const snapshot = feasibleSnapshot();
    const result = solveMidgameDeterminization(snapshot, GENEROUS_BUDGET(10), 'b3-seed', 3);
    expect(result).not.toBeNull();
    expect(result!.candidates).toHaveLength(snapshot.legalActions.length);
    expect(result!.hiddenStateSamples).toBe(10);
    expect(result!.complete).toBe(true);
  });

  it('returns null on global infeasibility, without ever sampling or searching (Adjustment 1: a single up-front check, not per-sample skipping)', () => {
    const snapshot = globallyInfeasibleSnapshot();
    const result = solveMidgameDeterminization(snapshot, GENEROUS_BUDGET(10), 'b3-seed', 3);
    expect(result).toBeNull();
    expect(searchGameTreeModule.searchGameTree).not.toHaveBeenCalled();
    expect(sampleHiddenAllocationModule.sampleHiddenAllocation).not.toHaveBeenCalled();
  });

  it('coverage increases monotonically with budget on the real ambiguous fixture, deterministically (fixed seed, growing sample-count prefix)', () => {
    const fixedSeed = 'b3-coverage-fixed-seed';
    const r10 = solveMidgameDeterminization(AMBIGUOUS_MIDGAME_SNAPSHOT, GENEROUS_BUDGET(10), fixedSeed, 2);
    const r50 = solveMidgameDeterminization(AMBIGUOUS_MIDGAME_SNAPSHOT, GENEROUS_BUDGET(50), fixedSeed, 2);
    const r200 = solveMidgameDeterminization(AMBIGUOUS_MIDGAME_SNAPSHOT, GENEROUS_BUDGET(200), fixedSeed, 2);
    expect(r10).not.toBeNull();
    expect(r50).not.toBeNull();
    expect(r200).not.toBeNull();
    expect(r10!.coverage).toBeLessThanOrEqual(r50!.coverage);
    expect(r50!.coverage).toBeLessThanOrEqual(r200!.coverage);
  });

  it('computes convergence correctly -- independently provable at maxPlyDepth 0, where every sample must yield the identical value', () => {
    // At maxPlyDepth: 0, searchGameTree's isCutoff (depth >= maxPlyDepth)
    // fires immediately on the post-action state, before it ever consults
    // getLegalMoves -- meaning the leaf value never depends on the sampled
    // hidden allocation at all, only on the actor's own move. Since the two
    // legal actions here are exact mirrors of each other (see the BOARD/
    // ACTOR_HAND comment above), both actions' post-action score
    // differential is identical, and -- critically for this test -- that
    // same fixed number is what every single sample contributes, with zero
    // sample-to-sample variance. That makes the running average at the
    // halfway checkpoint and at the final count provably, exactly equal:
    // valueDelta must be 0 and the top action must be identical at both
    // checkpoints, not just approximately or on average. This isolates and
    // independently verifies the checkpoint-bookkeeping mechanism itself
    // (the thing this test targets), deliberately removing all sampling
    // variance rather than trying to hand-trace it.
    const snapshot = feasibleSnapshot();
    const result = solveMidgameDeterminization(snapshot, GENEROUS_BUDGET(4), 'b3-convergence-seed', 0);
    expect(result).not.toBeNull();
    expect(result!.candidates[0].value.expectedPointDifferential).toBeCloseTo(
      result!.candidates[1].value.expectedPointDifferential,
    );
    expect(result!.convergence.sameTopAction).toBe(true);
    expect(result!.convergence.valueDelta).toBeCloseTo(0);
  });

  it('respects the node budget: marks complete false, does real bounded work, and never exceeds maxNodes', () => {
    const snapshot = feasibleSnapshot();
    const tinyBudget: ReviewSearchBudget = { maxNodes: 1, maxHiddenStateSamples: 10 };
    const result = solveMidgameDeterminization(snapshot, tinyBudget, 'b3-seed', 3);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(false);
    expect(result!.nodes).toBeGreaterThan(0);
    expect(result!.nodes).toBeLessThanOrEqual(tinyBudget.maxNodes);
  });

  it('is byte-stable: repeated calls on independently-constructed, deep-cloned snapshots deep-equal', () => {
    const first = solveMidgameDeterminization(structuredClone(feasibleSnapshot()), GENEROUS_BUDGET(10), 'b3-stable-seed', 3);
    const second = solveMidgameDeterminization(structuredClone(feasibleSnapshot()), GENEROUS_BUDGET(10), 'b3-stable-seed', 3);
    const third = solveMidgameDeterminization(structuredClone(feasibleSnapshot()), GENEROUS_BUDGET(10), 'b3-stable-seed', 3);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});
