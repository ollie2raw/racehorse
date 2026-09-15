import { describe, expect, it } from 'vitest';
import { simulatePlacement, type Tile } from '@racehorse/game-core';
import {
  GAME_COMMAND_VERSION,
  GAME_RULES_VERSION,
  REVIEW_ENGINE_CONTRACT_VERSION,
  REVIEW_EVALUATION_VERSION,
  REVIEW_POSITION_SNAPSHOT_VERSION,
  REVIEW_STATE_DIGEST_VERSION,
  type ReviewAction,
  type ReviewEvaluationEvidence,
  type ReviewKnownMissingPipEvidence,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import type { BoardState } from '@racehorse/game-core/types';
import {
  computeEndDangerPenalty,
  computeTrapPenalty,
  solveHeuristicOpening,
} from '../solveHeuristicOpening';

function makeSnapshot(args: {
  board: BoardState | null;
  actorHand: readonly Tile[];
  legalActions: readonly ReviewAction[];
  opponentTileCount?: number;
  boneyard?: { physicalCount: number; drawableCount: number; deadCount: number };
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
      board: args.board,
      actorHand: args.actorHand,
      opponentTileCount: args.opponentTileCount ?? 5,
      boneyard: args.boneyard ?? { physicalCount: 14, drawableCount: 12, deadCount: 2 },
      scores: { actor: 0, opponent: 0 },
      winningTarget: 60,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: args.knownMissingPipEvidence ?? [],
    },
    legalActions: args.legalActions,
    actualAction: args.legalActions[0],
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
    reason: 'authority_observation',
    observedHandNumber: 1,
    observedSequence: 0,
    openEnds: [pip],
  };
}

function actionKeyOf(action: ReviewAction): string {
  return action.kind === 'play' ? `play(${action.tile.low},${action.tile.high})@${action.position}` : action.kind;
}

describe('solveHeuristicOpening (B4)', () => {
  it('returns a well-shaped result: one candidate per legal action, best at the top, heuristic/low confidence', () => {
    const board = simulatePlacement(null, { low: 1, high: 2 }, 'left');
    const snapshot = makeSnapshot({
      board,
      actorHand: [{ low: 1, high: 3 }, { low: 2, high: 5 }],
      legalActions: [
        { kind: 'play', tile: { low: 1, high: 3 }, position: 'left' },
        { kind: 'play', tile: { low: 2, high: 5 }, position: 'right' },
      ],
    });
    const result = solveHeuristicOpening(snapshot);
    expect(result.candidates).toHaveLength(snapshot.legalActions.length);
    expect(result.best).toEqual(result.candidates[0]);
    expect(result.evidence.source).toBe('heuristic');
    expect(result.evidence.confidence).toBe('low');
    // 'Heuristic estimate', not the scoping doc's "Fritz's read" copy --
    // ReviewEvaluationEvidence's 'heuristic' branch only permits this
    // literal (see issue #224 for the doc/type naming mismatch).
    expect(result.evidence.displayLabel).toBe('Heuristic estimate');
    expect(result.evaluationVersion).toBe(REVIEW_EVALUATION_VERSION);
    expect(result.snapshotId).toBe(snapshot.identifiers.decisionId);
    expect(result.rulesVersion).toBe(snapshot.rulesVersion);
    expect(result.reviewEngineVersion).toBe(snapshot.reviewEngineVersion);
  });

  it('the type system itself rejects a heuristic result claiming high confidence (proven for this construction path specifically)', () => {
    // @ts-expect-error confidence: 'high' is not assignable to the 'heuristic' branch
    const invalid: ReviewEvaluationEvidence = {
      source: 'heuristic',
      confidence: 'high',
      displayLabel: 'Heuristic estimate',
    };
    expect(invalid).toBeDefined();
  });

  it('does not read or fabricate opponent hand contents or boneyard tile identities', () => {
    const board = simulatePlacement(null, { low: 1, high: 2 }, 'left');
    const snapshot = makeSnapshot({
      board,
      actorHand: [{ low: 1, high: 3 }],
      legalActions: [{ kind: 'play', tile: { low: 1, high: 3 }, position: 'left' }],
      opponentTileCount: 5,
      boneyard: { physicalCount: 9, drawableCount: 7, deadCount: 2 },
    });
    const result = solveHeuristicOpening(snapshot);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('"opponentTileCount"');
    expect(serialized).not.toContain('"boneyard"');
  });

  it('ranks the objectively better action first: creating an open end the opponent is evidenced not to hold, over raw pip value', () => {
    // Board: a single uncrossed double (3,3) -- leftEnd === rightEnd === 3
    // (per engine.ts, an unplayed double exposes its own value on both
    // sides). Actor holds (2,3) and (3,6), each matching the only open
    // value (3). Evidence excludes pip 2 for the opponent.
    //
    // Independent reasoning about which action is objectively better:
    // - Playing (2,3) opens a new end at value 2 -- a pip the opponent is
    //   evidenced not to hold, denying them a reply there (a real
    //   strategic gain: pressureScore rewards this directly).
    // - Playing (3,6) opens a new end at value 6, with no such evidence --
    //   no denial benefit.
    // - Every other feature is symmetric between the two actions by
    //   construction: both leave exactly one non-matching tile in hand
    //   (so endControlScore's weak-support penalty and trapPenalty's
    //   playable-count are equal), neither played tile is a double (so
    //   doubleScore is 0 for both), and both leave a hand that can go out
    //   in one more move (so exitBonus/safeFinishBonus are equal). Only
    //   unloadTieBreaker favors (3,6) (higher pip sum, by 2), which is
    //   deliberately outweighed by the pressure-denial bonus for (2,3) --
    //   proving the ranking is driven by the ported strategic feature, not
    //   merely the trivial tie-breaker.
    const board = simulatePlacement(null, { low: 3, high: 3 }, 'left');
    const actionA: ReviewAction = { kind: 'play', tile: { low: 2, high: 3 }, position: 'left' };
    const actionB: ReviewAction = { kind: 'play', tile: { low: 3, high: 6 }, position: 'left' };
    const snapshot = makeSnapshot({
      board,
      actorHand: [{ low: 2, high: 3 }, { low: 3, high: 6 }],
      legalActions: [actionB, actionA], // deliberately not in the expected winning order
      knownMissingPipEvidence: [evidenceExcludingPip(2)],
    });

    const result = solveHeuristicOpening(snapshot);
    expect(result.best.action).toEqual(actionA);
    expect(actionKeyOf(result.candidates[0].action)).toBe(actionKeyOf(actionA));
  });

  it('zero-differential honesty: every candidate reports expectedPointDifferential 0, and loss is always 0', () => {
    const board = simulatePlacement(null, { low: 1, high: 2 }, 'left');
    const snapshot = makeSnapshot({
      board,
      actorHand: [{ low: 1, high: 3 }, { low: 2, high: 5 }],
      legalActions: [
        { kind: 'play', tile: { low: 1, high: 3 }, position: 'left' },
        { kind: 'play', tile: { low: 2, high: 5 }, position: 'right' },
      ],
    });
    const result = solveHeuristicOpening(snapshot);
    for (const candidate of result.candidates) {
      expect(candidate.value.expectedPointDifferential).toBe(0);
    }
    expect(result.loss).toEqual({ expectedPointDifferential: 0, winProbability: null });
  });

  it('diagnostics has one entry per candidate in the same order, each matching the documented "<key>: <score>" format', () => {
    const board = simulatePlacement(null, { low: 1, high: 2 }, 'left');
    const snapshot = makeSnapshot({
      board,
      actorHand: [{ low: 1, high: 3 }, { low: 2, high: 5 }],
      legalActions: [
        { kind: 'play', tile: { low: 1, high: 3 }, position: 'left' },
        { kind: 'play', tile: { low: 2, high: 5 }, position: 'right' },
      ],
    });
    const result = solveHeuristicOpening(snapshot);
    expect(result.diagnostics).toHaveLength(result.candidates.length);
    result.diagnostics.forEach((entry, index) => {
      const match = entry.match(/^(.+): (-?\d+(?:\.\d+)?)$/);
      expect(match, `diagnostics[${index}] = ${JSON.stringify(entry)} did not match "<key>: <score>"`).not.toBeNull();
      expect(match![1]).toBe(actionKeyOf(result.candidates[index].action));
    });
  });

  it('reports an honest, trivial search block -- no fabricated search story', () => {
    const board = simulatePlacement(null, { low: 1, high: 2 }, 'left');
    const snapshot = makeSnapshot({
      board,
      actorHand: [{ low: 1, high: 3 }],
      legalActions: [{ kind: 'play', tile: { low: 1, high: 3 }, position: 'left' }],
    });
    const result = solveHeuristicOpening(snapshot);
    expect(result.search).toEqual({
      nodes: result.candidates.length,
      depth: 0,
      hiddenStateSamples: 0,
      coverage: 0,
      complete: true,
    });
  });
});

describe('solveHeuristicOpening feature spot-checks', () => {
  it('computeTrapPenalty: a hand left with zero playable tiles after the move scores strictly worse than one left with several', () => {
    const openEnds = [4];
    const mobileHand: readonly Tile[] = [{ low: 4, high: 1 }, { low: 4, high: 2 }, { low: 0, high: 0 }];
    const trappedHand: readonly Tile[] = [{ low: 0, high: 0 }, { low: 1, high: 1 }, { low: 2, high: 2 }];
    const mobile = computeTrapPenalty(mobileHand, openEnds, 'mid');
    const trapped = computeTrapPenalty(trappedHand, openEnds, 'mid');
    // Independently verified: trappedHand has 0 tiles matching the only
    // open end (all three are doubles of pips 0/1/2, none equal to 4) --
    // playableNext=0 triggers the bottleneck penalty and the full orphan
    // penalty for all 3 tiles. mobileHand has 2 tiles matching the open
    // end (4,1) and (4,2), so playableNext=2, no bottleneck, only 1 orphan
    // tile (0,0). The trapped hand must score strictly worse (higher
    // penalty).
    expect(trapped.playableNext).toBe(0);
    expect(mobile.playableNext).toBe(2);
    expect(trapped.trapPenalty).toBeGreaterThan(mobile.trapPenalty);
  });

  it('computeEndDangerPenalty: an open end with many matching unseen tiles and no own-hand support is more dangerous than one with few matches and strong support', () => {
    const freqStrongSupport = [0, 0, 0, 0, 3, 0, 0]; // 3 own-hand tiles carry pip 4
    const freqNoSupport = [0, 0, 0, 0, 0, 0, 0];
    // Unseen pool: 6 tiles carry pip 5, only 1 carries pip 4.
    const unseenPool: readonly Tile[] = [
      { low: 5, high: 0 }, { low: 5, high: 1 }, { low: 5, high: 2 },
      { low: 5, high: 3 }, { low: 5, high: 5 }, { low: 5, high: 6 },
      { low: 4, high: 6 },
    ];
    const dangerousEnd = computeEndDangerPenalty([5], freqNoSupport, unseenPool);
    const saferEnd = computeEndDangerPenalty([4], freqStrongSupport, unseenPool);
    // Independently verified: pip 5 has 6 unseen matches and 0 own-hand
    // support (denominator 1); pip 4 has 1 unseen match and 3 own-hand
    // support tiles (denominator 1 + 0.6*3 = 2.8). 6/1 = 6 vs 1/2.8 ≈ 0.36
    // (times the same dangerWeight constant either way) -- the pip-5 end
    // must score strictly higher danger.
    expect(dangerousEnd).toBeGreaterThan(saferEnd);
  });
});
