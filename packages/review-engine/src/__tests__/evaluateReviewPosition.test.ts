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

vi.mock('../solveExactEndgame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../solveExactEndgame')>();
  return { ...actual, solveExactEndgame: vi.fn(actual.solveExactEndgame) };
});
vi.mock('../solveMidgameDeterminization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../solveMidgameDeterminization')>();
  return { ...actual, solveMidgameDeterminization: vi.fn(actual.solveMidgameDeterminization) };
});
vi.mock('../solveHeuristicOpening', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../solveHeuristicOpening')>();
  return { ...actual, solveHeuristicOpening: vi.fn(actual.solveHeuristicOpening) };
});

// Imported after the mocks above so evaluateReviewPosition picks up the
// mocked (but real-implementation-wrapping) bindings.
import { evaluateReviewPosition, type ReviewDispatchBudget } from '../evaluateReviewPosition';
import * as solveExactEndgameModule from '../solveExactEndgame';
import * as solveMidgameDeterminizationModule from '../solveMidgameDeterminization';
import * as solveHeuristicOpeningModule from '../solveHeuristicOpening';

afterEach(() => {
  vi.mocked(solveExactEndgameModule.solveExactEndgame).mockClear();
  vi.mocked(solveMidgameDeterminizationModule.solveMidgameDeterminization).mockClear();
  vi.mocked(solveHeuristicOpeningModule.solveHeuristicOpening).mockClear();
});

// ─── Real fixtures, pulled verbatim from packages/game-core's built fixture
// corpus during integration research (the corpus has no public export, same
// reason B1-B4's own tests self-author snapshots -- these four are
// hardcoded literals, not invented). ────────────────────────────────────

const LOCKED_YARD_FEASIBLE_SNAPSHOT = {"snapshotVersion":2,"rulesVersion":1,"commandVersion":1,"reviewEngineVersion":"review-engine-v1","stateDigestVersion":1,"identifiers":{"sessionId":"fixture-session:review-corpus:26","gameId":"fixture-game:review-corpus:26","handId":"fixture-game:review-corpus:26:hand-4","decisionId":"locked-yard-feasible-endgame","mode":"fixture","gameNumber":1,"actionNumber":29,"handNumber":4,"turnSequence":89,"actorId":"player","opponentId":"opponent"},"preAction":{"board":{"mainLine":[{"tile":{"low":3,"high":5},"orientation":"horizontal-normal"},{"tile":{"low":5,"high":5},"orientation":"vertical-normal"},{"tile":{"low":4,"high":5},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":4},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":2},"orientation":"horizontal-normal"},{"tile":{"low":2,"high":2},"orientation":"vertical-normal"},{"tile":{"low":1,"high":2},"orientation":"horizontal-flipped"},{"tile":{"low":1,"high":6},"orientation":"horizontal-normal"},{"tile":{"low":5,"high":6},"orientation":"horizontal-flipped"},{"tile":{"low":1,"high":5},"orientation":"horizontal-flipped"},{"tile":{"low":1,"high":4},"orientation":"horizontal-normal"},{"tile":{"low":2,"high":4},"orientation":"horizontal-flipped"},{"tile":{"low":2,"high":3},"orientation":"horizontal-normal"},{"tile":{"low":0,"high":3},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":5},"orientation":"horizontal-normal"},{"tile":{"low":2,"high":5},"orientation":"horizontal-flipped"}],"leftEnd":3,"rightEnd":2,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[{"hubId":0,"laneType":"mainline","laneRef":"mainline","tileIndex":5,"mainlineIndex":5,"hubValue":2,"isCrossed":true,"leftSideFilled":true,"rightSideFilled":true,"branches":[{"tiles":[{"tile":{"low":2,"high":6},"orientation":"vertical-normal"},{"tile":{"low":0,"high":6},"orientation":"vertical-flipped"},{"tile":{"low":0,"high":1},"orientation":"vertical-normal"},{"tile":{"low":1,"high":3},"orientation":"vertical-normal"},{"tile":{"low":3,"high":3},"orientation":"vertical-normal"}],"openEnd":3,"openEndIsDouble":true},null]},{"hubId":1,"laneType":"mainline","laneRef":"mainline","tileIndex":1,"mainlineIndex":1,"hubValue":5,"isCrossed":true,"leftSideFilled":true,"rightSideFilled":true,"branches":[]},{"hubId":2,"laneType":"branch","laneRef":"branch-0-0","branchDepth":4,"tileIndex":-1,"hubValue":3,"leftSideFilled":true,"rightSideFilled":false,"isCrossed":false,"branches":[]}]},"actorHand":[{"low":3,"high":4},{"low":4,"high":4}],"opponentTileCount":3,"boneyard":{"physicalCount":2,"drawableCount":0,"deadCount":2},"scores":{"actor":49,"opponent":52},"winningTarget":60,"consecutivePasses":1,"handOpen":true,"knownMissingPipEvidence":[{"opponentId":"opponent","pip":2,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":60,"openEnds":[2,2]},{"opponentId":"opponent","pip":3,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":85,"openEnds":[3,2,3,2,5,5]},{"opponentId":"opponent","pip":2,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":85,"openEnds":[3,2,3,2,5,5]},{"opponentId":"opponent","pip":5,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":85,"openEnds":[3,2,3,2,5,5]}]},"legalActions":[{"kind":"play","tile":{"low":3,"high":4},"position":"left"},{"kind":"play","tile":{"low":3,"high":4},"position":"branch-0-0"}],"actualAction":{"kind":"play","tile":{"low":3,"high":4},"position":"branch-0-0"},"outcome":{"immediatePoints":0,"postActionBoard":null,"postActionActorScore":49},"integrity":{"authorityPreStateDigest":"review-state-v1:42fdea2a","authorityPostStateDigest":"review-state-v1:93e22d47"}} as unknown as ReviewPositionSnapshotV2;

const LOCKED_YARD_INFEASIBLE_SNAPSHOT = {"snapshotVersion":2,"rulesVersion":1,"commandVersion":1,"reviewEngineVersion":"review-engine-v1","stateDigestVersion":1,"identifiers":{"sessionId":"fixture-session:review-corpus:2","gameId":"fixture-game:review-corpus:2","handId":"fixture-game:review-corpus:2:hand-4","decisionId":"locked-yard-five-tile-endgame","mode":"fixture","gameNumber":1,"actionNumber":27,"handNumber":4,"turnSequence":82,"actorId":"player","opponentId":"opponent"},"preAction":{"board":{"mainLine":[{"tile":{"low":1,"high":6},"orientation":"horizontal-normal"},{"tile":{"low":6,"high":6},"orientation":"vertical-normal"},{"tile":{"low":5,"high":6},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":5},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":6},"orientation":"horizontal-normal"},{"tile":{"low":3,"high":6},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":3},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":4},"orientation":"horizontal-normal"},{"tile":{"low":1,"high":4},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":1},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":2},"orientation":"horizontal-normal"},{"tile":{"low":1,"high":2},"orientation":"horizontal-flipped"},{"tile":{"low":1,"high":3},"orientation":"horizontal-normal"},{"tile":{"low":3,"high":5},"orientation":"horizontal-normal"},{"tile":{"low":2,"high":5},"orientation":"horizontal-flipped"},{"tile":{"low":2,"high":3},"orientation":"horizontal-normal"},{"tile":{"low":3,"high":4},"orientation":"horizontal-normal"},{"tile":{"low":4,"high":4},"orientation":"vertical-normal"},{"tile":{"low":2,"high":4},"orientation":"horizontal-flipped"},{"tile":{"low":2,"high":2},"orientation":"vertical-normal"}],"leftEnd":1,"rightEnd":2,"leftEndIsDouble":false,"rightEndIsDouble":true,"hubDoubles":[{"hubId":0,"laneType":"mainline","laneRef":"mainline","tileIndex":17,"mainlineIndex":17,"hubValue":4,"isCrossed":true,"leftSideFilled":true,"rightSideFilled":true,"branches":[{"tiles":[{"tile":{"low":4,"high":5},"orientation":"vertical-normal"}],"openEnd":5,"openEndIsDouble":false},null]},{"hubId":1,"laneType":"mainline","laneRef":"mainline","tileIndex":1,"mainlineIndex":1,"hubValue":6,"isCrossed":true,"leftSideFilled":true,"rightSideFilled":true,"branches":[]},{"hubId":2,"laneType":"mainline","laneRef":"mainline","tileIndex":19,"mainlineIndex":19,"hubValue":2,"isCrossed":false,"leftSideFilled":true,"rightSideFilled":false,"branches":[]}]},"actorHand":[{"low":2,"high":6}],"opponentTileCount":4,"boneyard":{"physicalCount":2,"drawableCount":0,"deadCount":2},"scores":{"actor":51,"opponent":54},"winningTarget":60,"consecutivePasses":0,"handOpen":true,"knownMissingPipEvidence":[{"opponentId":"opponent","pip":5,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":70,"openEnds":[5,4]},{"opponentId":"opponent","pip":4,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":70,"openEnds":[5,4]},{"opponentId":"opponent","pip":5,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":71,"openEnds":[5,4]},{"opponentId":"opponent","pip":4,"reason":"drew_past_open_end","observedHandNumber":4,"observedSequence":71,"openEnds":[5,4]}]},"legalActions":[{"kind":"play","tile":{"low":2,"high":6},"position":"right"},{"kind":"play","tile":{"low":2,"high":6},"position":"branch-1-0"},{"kind":"play","tile":{"low":2,"high":6},"position":"branch-1-1"}],"actualAction":{"kind":"play","tile":{"low":2,"high":6},"position":"branch-1-0"},"outcome":{"immediatePoints":0,"postActionBoard":null,"postActionActorScore":54},"integrity":{"authorityPreStateDigest":"review-state-v1:2e7cd3e8","authorityPostStateDigest":"review-state-v1:82f6a9eb"}} as unknown as ReviewPositionSnapshotV2;

const AMBIGUOUS_MIDGAME_SNAPSHOT = {"snapshotVersion":2,"rulesVersion":1,"commandVersion":1,"reviewEngineVersion":"review-engine-v1","stateDigestVersion":1,"identifiers":{"sessionId":"fixture-session:review-corpus:0","gameId":"fixture-game:review-corpus:0","handId":"fixture-game:review-corpus:0:hand-4","decisionId":"hidden-allocation-ambiguous-midgame","mode":"fixture","gameNumber":1,"actionNumber":3,"handNumber":4,"turnSequence":43,"actorId":"opponent","opponentId":"player"},"preAction":{"board":{"mainLine":[{"tile":{"low":0,"high":3},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":0},"orientation":"vertical-normal"}],"leftEnd":3,"rightEnd":0,"leftEndIsDouble":false,"rightEndIsDouble":true,"hubDoubles":[{"hubId":0,"laneType":"mainline","laneRef":"mainline","tileIndex":1,"mainlineIndex":1,"hubValue":0,"isCrossed":false,"leftSideFilled":true,"rightSideFilled":false,"branches":[]}]},"actorHand":[{"low":0,"high":4},{"low":4,"high":5},{"low":0,"high":1},{"low":2,"high":2},{"low":4,"high":6},{"low":3,"high":6},{"low":2,"high":4}],"opponentTileCount":5,"boneyard":{"physicalCount":14,"drawableCount":12,"deadCount":2},"scores":{"actor":52,"opponent":48},"winningTarget":60,"consecutivePasses":0,"handOpen":true,"knownMissingPipEvidence":[]},"legalActions":[{"kind":"play","tile":{"low":0,"high":1},"position":"right"},{"kind":"play","tile":{"low":0,"high":4},"position":"right"},{"kind":"play","tile":{"low":3,"high":6},"position":"left"}],"actualAction":{"kind":"play","tile":{"low":3,"high":6},"position":"left"},"outcome":{"immediatePoints":0,"postActionBoard":null,"postActionActorScore":52},"integrity":{"authorityPreStateDigest":"review-state-v1:f3a11745","authorityPostStateDigest":"review-state-v1:84cd277a"}} as unknown as ReviewPositionSnapshotV2;

const OPENING_SNAPSHOT = {"snapshotVersion":2,"rulesVersion":1,"commandVersion":1,"reviewEngineVersion":"review-engine-v1","stateDigestVersion":1,"identifiers":{"sessionId":"fixture-session:review-corpus:0","gameId":"fixture-game:review-corpus:0","handId":"fixture-game:review-corpus:0:hand-4","decisionId":"opening-double-from-live-deal","mode":"fixture","gameNumber":1,"actionNumber":1,"handNumber":4,"turnSequence":40,"actorId":"player","opponentId":"opponent"},"preAction":{"board":null,"actorHand":[{"low":3,"high":5},{"low":0,"high":6},{"low":1,"high":6},{"low":0,"high":0},{"low":0,"high":3},{"low":5,"high":6},{"low":1,"high":3}],"opponentTileCount":7,"boneyard":{"physicalCount":14,"drawableCount":12,"deadCount":2},"scores":{"actor":48,"opponent":52},"winningTarget":60,"consecutivePasses":0,"handOpen":false,"knownMissingPipEvidence":[]},"legalActions":[{"kind":"play","tile":{"low":0,"high":0},"position":"left"}],"actualAction":{"kind":"play","tile":{"low":0,"high":0},"position":"left"},"outcome":{"immediatePoints":0,"postActionBoard":null,"postActionActorScore":48},"integrity":{"authorityPreStateDigest":"review-state-v1:00000000","authorityPostStateDigest":"review-state-v1:11111111"}} as unknown as ReviewPositionSnapshotV2;

// ─── Self-authored scenarios (no real fixture identified for these during
// research), same construction pattern as B2/B3/B4's own tests: a single
// uncrossed double (2,2) -- leftEnd === rightEnd === 2 -- with one actor
// tile, (2,6), matching both ends. ──────────────────────────────────────

const BOARD: BoardState = simulatePlacement(null, { low: 2, high: 2 }, 'left');
const ACTOR_HAND: readonly Tile[] = [{ low: 2, high: 6 }];

function evidenceExcludingPip(pip: number): ReviewKnownMissingPipEvidence {
  return {
    opponentId: 'bot',
    pip,
    reason: 'authority_observation',
    observedHandNumber: 1,
    observedSequence: 0,
    openEnds: [pip],
  };
}

function makeSnapshot(args: {
  opponentTileCount: number;
  boneyardDrawableCount: number;
  boneyardDeadCount: number;
  knownMissingPipEvidence?: readonly ReviewKnownMissingPipEvidence[];
}): ReviewPositionSnapshotV2 {
  const legalActions: ReviewAction[] = [
    { kind: 'play', tile: { low: 2, high: 6 }, position: 'left' },
    { kind: 'play', tile: { low: 2, high: 6 }, position: 'right' },
  ];
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

// opponentTileCount 1 keeps C(n,1) small (linear in pool size) regardless
// of how large the hidden pool is -- 26 hidden tiles here -- so coverage
// climbs fast even at modest budgets, unlike a wide hand (confirmed via
// real numbers gathered during research: a real fixture with
// opponentTileCount 1 reached 63.6% coverage at just 10 samples).
function thinHandMidgameSnapshot(): ReviewPositionSnapshotV2 {
  return makeSnapshot({ opponentTileCount: 1, boneyardDrawableCount: 6, boneyardDeadCount: 19 });
}

// evidence excludes every pip -> globally infeasible regardless of
// drawableCount (B3's own Adjustment 1 -- C(0, k) = 0 for any k > 0).
function midgameGloballyInfeasibleSnapshot(): ReviewPositionSnapshotV2 {
  return makeSnapshot({
    opponentTileCount: 1,
    boneyardDrawableCount: 6,
    boneyardDeadCount: 19,
    knownMissingPipEvidence: [0, 1, 2, 3, 4, 5, 6].map(evidenceExcludingPip),
  });
}

const REALISTIC_BUDGET: ReviewDispatchBudget = {
  maxNodes: 200_000,
  maxHiddenStateSamples: 100,
  maxPlyDepth: 2,
  seed: 'dispatch-test-seed',
};

const PROVISIONAL_COVERAGE_THRESHOLD = 0.02; // 2%, per the coverage-threshold decision

describe('evaluateReviewPosition dispatch (integration)', () => {
  it('locked yard, B2 feasible -> exact/high, B3 and B4 never invoked', () => {
    const result = evaluateReviewPosition(LOCKED_YARD_FEASIBLE_SNAPSHOT, REALISTIC_BUDGET, PROVISIONAL_COVERAGE_THRESHOLD);
    expect(result.evidence).toEqual({ source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' });
    expect(solveExactEndgameModule.solveExactEndgame).toHaveBeenCalledTimes(1);
    expect(solveMidgameDeterminizationModule.solveMidgameDeterminization).not.toHaveBeenCalled();
    expect(solveHeuristicOpeningModule.solveHeuristicOpening).not.toHaveBeenCalled();
  });

  it('locked yard, B2 infeasible -> falls straight to B4, B3 skipped entirely', () => {
    const result = evaluateReviewPosition(LOCKED_YARD_INFEASIBLE_SNAPSHOT, REALISTIC_BUDGET, PROVISIONAL_COVERAGE_THRESHOLD);
    expect(result.evidence.source).toBe('heuristic');
    expect(solveExactEndgameModule.solveExactEndgame).toHaveBeenCalledTimes(1);
    expect(solveMidgameDeterminizationModule.solveMidgameDeterminization).not.toHaveBeenCalled();
    expect(solveHeuristicOpeningModule.solveHeuristicOpening).toHaveBeenCalledTimes(1);
  });

  it('midgame, coverage at or above threshold -> search/medium, with convergence folded into diagnostics', () => {
    const result = evaluateReviewPosition(
      thinHandMidgameSnapshot(),
      { ...REALISTIC_BUDGET, maxHiddenStateSamples: 10 },
      PROVISIONAL_COVERAGE_THRESHOLD,
    );
    expect(result.evidence).toEqual({ source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' });
    expect(result.search.coverage).toBeGreaterThanOrEqual(PROVISIONAL_COVERAGE_THRESHOLD);
    expect(result.diagnostics.some((d) => d.startsWith('convergence:'))).toBe(true);
    expect(solveMidgameDeterminizationModule.solveMidgameDeterminization).toHaveBeenCalledTimes(1);
    expect(solveHeuristicOpeningModule.solveHeuristicOpening).not.toHaveBeenCalled();
  });

  it('midgame, coverage below threshold -> full fallthrough to B4, not a down-weighted search result', () => {
    const result = evaluateReviewPosition(AMBIGUOUS_MIDGAME_SNAPSHOT, REALISTIC_BUDGET, PROVISIONAL_COVERAGE_THRESHOLD);
    expect(result.evidence.source).toBe('heuristic');
    expect(solveMidgameDeterminizationModule.solveMidgameDeterminization).toHaveBeenCalledTimes(1);
    expect(solveHeuristicOpeningModule.solveHeuristicOpening).toHaveBeenCalledTimes(1);
  });

  it('midgame, B3 globally infeasible -> falls to B4', () => {
    const result = evaluateReviewPosition(midgameGloballyInfeasibleSnapshot(), REALISTIC_BUDGET, PROVISIONAL_COVERAGE_THRESHOLD);
    expect(result.evidence.source).toBe('heuristic');
    expect(solveMidgameDeterminizationModule.solveMidgameDeterminization).toHaveBeenCalledTimes(1);
    expect(solveHeuristicOpeningModule.solveHeuristicOpening).toHaveBeenCalledTimes(1);
  });

  it('opening position routes to B4 via the coverage threshold, with no dedicated opening detector', () => {
    const result = evaluateReviewPosition(OPENING_SNAPSHOT, REALISTIC_BUDGET, PROVISIONAL_COVERAGE_THRESHOLD);
    expect(result.evidence.source).toBe('heuristic');
    // Reached B3 first (drawableCount > 0), which genuinely ran and
    // reported coverage below threshold -- not a special-cased "is this
    // opening" branch that skipped B3 outright.
    expect(solveMidgameDeterminizationModule.solveMidgameDeterminization).toHaveBeenCalledTimes(1);
    expect(solveHeuristicOpeningModule.solveHeuristicOpening).toHaveBeenCalledTimes(1);
  });

  it('coverageThreshold genuinely participates in the branch -- the same call flips outcome when the threshold changes', () => {
    const snapshot = thinHandMidgameSnapshot();
    const budget = { ...REALISTIC_BUDGET, maxHiddenStateSamples: 10 };

    const lowThreshold = evaluateReviewPosition(snapshot, budget, 0.02);
    expect(lowThreshold.evidence.source).toBe('search');

    const highThreshold = evaluateReviewPosition(snapshot, budget, 0.9);
    expect(highThreshold.evidence.source).toBe('heuristic');
  });
});
