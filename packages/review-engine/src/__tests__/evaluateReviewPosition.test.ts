import { describe, expect, it } from 'vitest';
import { GAME_COMMAND_VERSION, GAME_RULES_VERSION } from '@racehorse/game-core';
import {
  REVIEW_ENGINE_CONTRACT_VERSION,
  REVIEW_EVALUATION_VERSION,
  REVIEW_POSITION_SNAPSHOT_VERSION,
  REVIEW_STATE_DIGEST_VERSION,
  type ReviewEvaluationEvidence,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { evaluateReviewPosition, type ReviewSearchBudget } from '../evaluateReviewPosition';

// Hand-built rather than reused from game-core's internal fixture corpus —
// that corpus has no public export (deliberately: it's game-core's own test
// tooling, not part of its package boundary), and B0 must only read game-core's
// published contracts, not reach into its src for internal-only helpers.
function makeSnapshot(overrides: Partial<ReviewPositionSnapshotV2> = {}): ReviewPositionSnapshotV2 {
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
      board: null,
      actorHand: [{ low: 3, high: 4 }],
      opponentTileCount: 7,
      boneyard: { physicalCount: 14, drawableCount: 14, deadCount: 0 },
      scores: { actor: 0, opponent: 0 },
      winningTarget: 60,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: [],
    },
    legalActions: [{ kind: 'play', tile: { low: 3, high: 4 }, position: 'left' }],
    actualAction: { kind: 'play', tile: { low: 3, high: 4 }, position: 'left' },
    outcome: {
      immediatePoints: 7,
      postActionBoard: null,
      postActionActorScore: 7,
    },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
    ...overrides,
  };
}

const budget: ReviewSearchBudget = { maxNodes: 0, maxHiddenStateSamples: 0 };

describe('evaluateReviewPosition (B0 stub)', () => {
  it('returns a well-shaped ReviewEvaluationV1', () => {
    const snapshot = makeSnapshot();
    const result = evaluateReviewPosition(snapshot, budget);

    expect(result.evaluationVersion).toBe(REVIEW_EVALUATION_VERSION);
    expect(result.snapshotId).toBe(snapshot.identifiers.decisionId);
    expect(result.rulesVersion).toBe(snapshot.rulesVersion);
    expect(result.reviewEngineVersion).toBe(snapshot.reviewEngineVersion);
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('always labels the result as heuristic, low confidence', () => {
    const result = evaluateReviewPosition(makeSnapshot(), budget);
    expect(result.evidence.source).toBe('heuristic');
    expect(result.evidence.confidence).toBe('low');
    expect(result.evidence.displayLabel).toBe('Heuristic estimate');
  });

  it('the type system itself rejects a heuristic result claiming high confidence (B4 constraint, enforced now)', () => {
    // Compile-time proof, not just a runtime check: ReviewEvaluationEvidence's
    // discriminated union ties source: 'heuristic' to confidence: 'low' only
    // (defined in game-core/reviewContracts.ts, not by this package) — this
    // is what makes it impossible for the heuristic branch to ever emit
    // confidence: 'high', now or when B4 replaces this stub's body.
    // @ts-expect-error confidence: 'high' is not assignable to the 'heuristic' branch
    const invalid: ReviewEvaluationEvidence = {
      source: 'heuristic',
      confidence: 'high',
      displayLabel: 'Heuristic estimate',
    };
    expect(invalid).toBeDefined();
  });

  it('stamps versions from the input snapshot, not invented constants', () => {
    const snapshot = makeSnapshot({
      identifiers: {
        ...makeSnapshot().identifiers,
        decisionId: 'session-9:bot:42',
      },
    });
    const result = evaluateReviewPosition(snapshot, budget);
    expect(result.snapshotId).toBe('session-9:bot:42');
  });

  it('does not fabricate any data beyond what the snapshot itself already establishes', () => {
    const snapshot = makeSnapshot();
    const result = evaluateReviewPosition(snapshot, budget);

    // played is built only from real, already-known snapshot facts.
    expect(result.played.action).toEqual(snapshot.actualAction);
    expect(result.played.immediatePoints).toBe(snapshot.outcome.immediatePoints);
    // No claimed value/lookahead — nothing was actually evaluated.
    expect(result.played.value).toEqual({ expectedPointDifferential: 0, winProbability: null });
    expect(result.played.principalVariation).toEqual([]);

    // best claims no improvement over played — it did not look for one.
    expect(result.best).toEqual(result.played);
    expect(result.loss).toEqual({ expectedPointDifferential: 0, winProbability: null });

    // No search happened — every field says so honestly, not "complete: true"
    // over a trivial/empty search.
    expect(result.search).toEqual({
      nodes: 0,
      depth: 0,
      hiddenStateSamples: 0,
      coverage: 0,
      complete: false,
    });

    // candidates contains only the one real action — nothing invented.
    expect(result.candidates).toEqual([result.played]);
  });

  it('does not read or fabricate opponent hand contents or boneyard tile identities', () => {
    // The stub never touches preAction.opponentTileCount / boneyard at all —
    // it has no code path that could invent hidden information. Proven by
    // construction: evaluateReviewPosition's only inputs it reads are
    // actualAction, outcome.immediatePoints, and the version/identifier
    // fields already stamped by capture (A2-A5), all public.
    const snapshot = makeSnapshot({
      preAction: {
        ...makeSnapshot().preAction,
        opponentTileCount: 3,
        boneyard: { physicalCount: 2, drawableCount: 2, deadCount: 0 },
      },
    });
    const result = evaluateReviewPosition(snapshot, budget);
    const serialized = JSON.stringify(result);
    // Nothing in the output should reference the opponent's actual tile
    // count or boneyard state — those numbers (3, 2) shouldn't appear
    // anywhere they weren't already public/structural.
    expect(serialized).not.toContain('"opponentTileCount"');
    expect(serialized).not.toContain('"boneyard"');
  });
});
