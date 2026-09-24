import { applyGameCommand, type GameCommand } from './commands';
import { canDraw, getLegalMoves } from './engine';
import { computePlayScore, simulatePlacement } from './scoring';
import { sha256Hex } from './sha256Hex';
import type { BoardState, Config, GameState, PlacementPosition, Tile } from './types';
import { GAME_COMMAND_VERSION, GAME_RULES_VERSION } from './versions';

export {
  dedupeCandidatesByTile,
  countDistinctLegalActions,
  isForcedDecision,
  reviewActionIdentityKey,
} from './reviewCandidateDedupe';

export const REVIEW_POSITION_SNAPSHOT_VERSION = 2 as const;
export const REVIEW_EVALUATION_VERSION = 1 as const;
export const REVIEW_STATE_DIGEST_VERSION = 1 as const;
export const REVIEW_ENGINE_CONTRACT_VERSION = 'review-engine-v1' as const;

export type ReviewGameMode = 'play-vs-fritz' | 'multiplayer' | 'daily-fritz' | 'fixture';

export type ReviewAction =
  | {
      readonly kind: 'play';
      readonly tile: Tile;
      readonly position: PlacementPosition;
    }
  | { readonly kind: 'draw' }
  | { readonly kind: 'pass' };

export type ReviewKnownMissingPipEvidence = {
  readonly opponentId: string;
  readonly pip: number;
  readonly reason: 'passed_on_open_end' | 'drew_past_open_end' | 'authority_observation';
  readonly observedHandNumber: number;
  readonly observedSequence: number;
  readonly openEnds: readonly number[];
};

/**
 * Ordered public actions from hand start through (but not including) this
 * decision's actualAction. Required to reproduce the engine information set
 * without reconstructing chronology from unrelated telemetry.
 */
export type ReviewPublicActionEvent = {
  readonly sequence: number;
  readonly actorId: string;
  readonly kind: 'play' | 'draw' | 'pass';
  readonly tile?: Tile;
  readonly position?: PlacementPosition;
  /** Matchable open-end pip values immediately before this action. */
  readonly openEnds: readonly number[];
};

/**
 * Correctness-relevant subset of Config for hidden-state generation / search.
 * Deterministically equal to authorityPreState.config fields listed here.
 */
export type ReviewRulesetConfig = {
  readonly maxPips: number;
  readonly tilesPerPlayer: number;
  readonly deadTileCount: number;
  readonly scoringMultiple: number;
  readonly blockedHandRule: Config['blockedHandRule'];
  readonly endHandBonus: Config['endHandBonus'];
  readonly winningScore: number;
  readonly skipPregameDraw: boolean;
};

export type ReviewPositionIdentifiers = {
  readonly sessionId: string;
  readonly gameId: string;
  readonly handId: string;
  readonly decisionId: string;
  readonly mode: ReviewGameMode;
  readonly gameNumber: number;
  readonly handNumber: number;
  readonly actionNumber: number;
  readonly turnSequence: number;
  readonly actorId: string;
  readonly opponentId: string;
};

/**
 * Public information available to a fair post-game evaluator at one decision.
 * Hidden tile identities and boneyard order are deliberately absent.
 */
export type ReviewPositionSnapshotV2 = {
  readonly snapshotVersion: typeof REVIEW_POSITION_SNAPSHOT_VERSION;
  readonly rulesVersion: typeof GAME_RULES_VERSION;
  readonly commandVersion: typeof GAME_COMMAND_VERSION;
  readonly reviewEngineVersion: typeof REVIEW_ENGINE_CONTRACT_VERSION;
  readonly stateDigestVersion: typeof REVIEW_STATE_DIGEST_VERSION;
  readonly identifiers: ReviewPositionIdentifiers;
  /**
   * Full correctness-relevant ruleset. Absent only on historical captures —
   * when absent, derived from winningTarget + DEFAULT_CONFIG defaults for
   * read compatibility (new captures always populate this).
   */
  readonly rulesetConfig?: ReviewRulesetConfig;
  /**
   * Ordered public actions in this hand before the decision. Absent only on
   * historical captures; empty array means hand-start (no prior public acts).
   */
  readonly publicActionHistory?: readonly ReviewPublicActionEvent[];
  readonly preAction: {
    readonly board: BoardState | null;
    readonly actorHand: readonly Tile[];
    readonly opponentTileCount: number;
    readonly boneyard: {
      readonly physicalCount: number;
      readonly drawableCount: number;
      readonly deadCount: number;
    };
    readonly scores: {
      readonly actor: number;
      readonly opponent: number;
    };
    readonly winningTarget: number;
    readonly consecutivePasses: number;
    readonly handOpen: boolean;
    readonly knownMissingPipEvidence: readonly ReviewKnownMissingPipEvidence[];
  };
  readonly legalActions: readonly ReviewAction[];
  readonly actualAction: ReviewAction;
  readonly outcome: {
    readonly immediatePoints: number;
    readonly postActionBoard: BoardState | null;
    readonly postActionActorScore: number;
  };
  readonly integrity: {
    readonly authorityPreStateDigest: string;
    readonly authorityPostStateDigest: string;
    /**
     * Canonical semantic position hash (SHA-256 over full public fair
     * serialization). Additive — absent on historical snapshots.
     */
    readonly positionHash?: string;
  };
};

export type ReviewEvaluationValue = {
  readonly expectedPointDifferential: number;
  readonly winProbability: number | null;
};

export type ReviewPrincipalVariationStep = {
  readonly actor: 'reviewed-player' | 'opponent';
  readonly action: ReviewAction;
  readonly immediatePoints: number;
};

export type ReviewCandidateEvaluationV1 = {
  readonly action: ReviewAction;
  readonly value: ReviewEvaluationValue;
  readonly immediatePoints: number;
  readonly principalVariation: readonly ReviewPrincipalVariationStep[];
  /**
   * Uncalibrated, solver-specific scoring signal -- present only when
   * `value.expectedPointDifferential` isn't a real point-differential
   * estimate (today: heuristic-path candidates only, where that field is
   * always 0 by design -- see solveHeuristicOpening.ts). Absent on
   * exact/search candidates, where `value` already carries a calibrated
   * number and this would be redundant. Never itself a point differential --
   * exists so a rating/UI layer can read *relative* spread across a
   * candidate set (e.g. how much better one move looks than another), not
   * an absolute magnitude of advantage. Do not average, threshold, or
   * otherwise treat it as being on the same scale as
   * `value.expectedPointDifferential`.
   */
  readonly rawScore?: number;
};

export type ReviewEvaluationEvidence =
  | {
      readonly source: 'exact';
      readonly confidence: 'high';
      readonly displayLabel: 'Exact analysis';
    }
  | {
      readonly source: 'search';
      readonly confidence: 'high' | 'medium' | 'low';
      readonly displayLabel: 'Review Engine search';
    }
  | {
      readonly source: 'heuristic';
      readonly confidence: 'low';
      readonly displayLabel: 'Heuristic estimate';
    };

export type ReviewEvaluationV1 = {
  readonly evaluationVersion: typeof REVIEW_EVALUATION_VERSION;
  readonly snapshotId: string;
  readonly rulesVersion: typeof GAME_RULES_VERSION;
  readonly reviewEngineVersion: string;
  readonly evidence: ReviewEvaluationEvidence;
  readonly played: ReviewCandidateEvaluationV1;
  readonly best: ReviewCandidateEvaluationV1;
  readonly candidates: readonly ReviewCandidateEvaluationV1[];
  readonly loss: {
    readonly expectedPointDifferential: number;
    readonly winProbability: number | null;
  };
  readonly search: {
    readonly nodes: number;
    readonly depth: number;
    readonly hiddenStateSamples: number;
    readonly coverage: number;
    readonly complete: boolean;
  };
  readonly diagnostics: readonly string[];
  /**
   * Structured sample-stability signal from the search (B3) path only --
   * absent for exact and heuristic results. Promotes B-integration's
   * original diagnostics-string folding of this same data into a real
   * field so a rating/UI layer can read it without string-parsing; the
   * formatted diagnostics entry is still also present, not replaced.
   */
  readonly convergence?: {
    readonly sameTopAction: boolean;
    readonly valueDelta: number;
  };
  /**
   * Populated only when `evidence.source === 'heuristic'`, by
   * evaluateReviewPosition's dispatcher -- not by solveHeuristicOpening
   * itself, which has no way to know why it was invoked (traced: every
   * call site that routes to it does so identically, with no context
   * parameter). Distinguishes three situations `evidence.source` alone
   * conflates:
   *  - 'locked-yard-infeasible': the exact (B2) solver found zero feasible
   *    opponent-hand allocations for a locked yard.
   *  - 'globally-infeasible': the search (B3) solver's own feasibility
   *    check found zero feasible allocations for a non-locked yard.
   *  - 'coverage-below-threshold': the search (B3) solver produced a real
   *    result, but its coverage didn't clear the caller's coverageThreshold.
   *
   * This is a deliberately *closed* set reflecting exactly the three
   * heuristic-routing branches that exist in evaluateReviewPosition today
   * -- confirmed by tracing every call site, not assumed. A fourth
   * "the solver call itself failed" case is not currently reachable here
   * (solveHeuristicOpening does not throw or return null for any input
   * evaluateReviewPosition passes it). If a future dispatch path adds a
   * new way to reach the heuristic fallback, it must add a new literal
   * here rather than silently reusing one of these three.
   */
  readonly heuristicFallbackReason?:
    | 'locked-yard-infeasible'
    | 'globally-infeasible'
    | 'coverage-below-threshold';
  /**
   * Additive observability / finalization metadata (2026-09-23 coverage
   * completion contract). Absent on historical evaluations — treat missing
   * as "live / pre-completion" with legacy estimate semantics.
   *
   * `unavailableReason` means this decision must NOT enter calibrated
   * accuracy and must present as UNAVAILABLE (never ESTIMATE) once a
   * post-game completion pass has finished. Live analysis may still emit
   * heuristic estimates without this field.
   */
  readonly evaluationProvenance?: ReviewEvaluationProvenance;
};

/**
 * Authoritative per-decision analysis lifecycle for fresh completed games.
 * Budget exhaustion / worker crash / infra → FAILED_RETRYABLE (requeue).
 * Only corrupt/unsupported source data → FAILED_FATAL.
 */
export type ReviewDecisionLifecycle =
  | 'PENDING'
  | 'SEARCHING'
  | 'SCORED'
  | 'FORCED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FATAL';

/**
 * Why a non-forced decision lacks an exact/search score after (or during)
 * evaluation. Closed set for log/artifact answers to "why wasn't X search-scored?"
 * Budget/exhaustion reasons are FAILED_RETRYABLE, not final UNAVAILABLE.
 */
export type ReviewEvaluationNotScoredReason =
  | 'coverage-below-threshold'
  | 'coverage-unreachable'
  | 'locked-yard-infeasible'
  | 'globally-infeasible'
  | 'wall-clock-exhausted'
  | 'node-exhausted'
  | 'evaluation-error'
  | 'missing-snapshot'
  | 'correlation-failure'
  | 'corrupt-snapshot';

export type ReviewEvaluationProvenance = {
  /** Which evaluation phase produced this authoritative result. */
  readonly phase: 'live' | 'completion';
  /** Lifecycle status — finalized fresh games must be SCORED or FORCED only. */
  readonly lifecycle?: ReviewDecisionLifecycle;
  /** Public position hash that produced this evaluation (when known). */
  readonly positionHash?: string;
  /** Escalation tier that produced a SCORED result (1–4). */
  readonly escalationTier?: 1 | 2 | 3 | 4;
  /**
   * @deprecated Prefer lifecycle FAILED_* . Retained for mixed-version reads
   * of the prior UNAVAILABLE finalization path.
   */
  readonly unavailableReason?: ReviewEvaluationNotScoredReason;
  /** Retryable/fatal failure reason when lifecycle is FAILED_*. */
  readonly failureReason?: ReviewEvaluationNotScoredReason;
  /** Optional structured note for logs (not shown in player UI). */
  readonly detail?: string;
};

export type LegacyReviewEvaluationDisclosure = {
  readonly source: 'heuristic';
  readonly confidence: 'low';
  readonly displayLabel: 'Legacy heuristic estimate';
  readonly reason: 'incomplete-v1-position-snapshot';
};

export const LEGACY_REVIEW_EVALUATION_DISCLOSURE: LegacyReviewEvaluationDisclosure = {
  source: 'heuristic',
  confidence: 'low',
  displayLabel: 'Legacy heuristic estimate',
  reason: 'incomplete-v1-position-snapshot',
};

export type CreateReviewPositionSnapshotV2Input = {
  readonly authorityPreState: GameState;
  readonly command: GameCommand;
  readonly identifiers: Omit<
    ReviewPositionIdentifiers,
    'handNumber' | 'turnSequence' | 'actorId' | 'opponentId'
  >;
  readonly knownMissingPipEvidence?: readonly ReviewKnownMissingPipEvidence[];
  /** Ordered public actions in this hand before this decision (canonical). */
  readonly publicActionHistory?: readonly ReviewPublicActionEvent[];
};

export type ReviewReplayFixture = {
  readonly snapshot: ReviewPositionSnapshotV2;
  /** Exact authority input retained only as replay evidence, not analyzer input. */
  readonly authorityPreState: GameState;
};

function tileValue(tile: Tile): readonly [number, number] {
  return [Math.min(tile.low, tile.high), Math.max(tile.low, tile.high)];
}

function canonicalBoard(board: BoardState | null): unknown {
  if (!board) return null;
  return {
    mainLine: board.mainLine.map((placed) => ({
      tile: tileValue(placed.tile),
      orientation: placed.orientation,
    })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble,
    rightEndIsDouble: board.rightEndIsDouble,
    hubDoubles: board.hubDoubles.map((hub) => ({
      hubId: hub.hubId ?? null,
      laneType: hub.laneType ?? null,
      laneRef: hub.laneRef ?? null,
      branchDepth: hub.branchDepth ?? null,
      tileIndex: hub.tileIndex,
      mainlineIndex: hub.mainlineIndex ?? null,
      hubValue: hub.hubValue,
      leftSideFilled: hub.leftSideFilled ?? null,
      rightSideFilled: hub.rightSideFilled ?? null,
      isCrossed: hub.isCrossed,
      branches: hub.branches.map((branch) =>
        branch
          ? {
              tiles: branch.tiles.map((placed) => ({
                tile: tileValue(placed.tile),
                orientation: placed.orientation,
              })),
              openEnd: branch.openEnd,
              openEndIsDouble: branch.openEndIsDouble,
            }
          : null,
      ),
    })),
  };
}

export function canonicalizeReviewAuthorityState(state: GameState): string {
  return JSON.stringify({
    config: {
      maxPips: state.config.maxPips,
      tilesPerPlayer: state.config.tilesPerPlayer,
      deadTileCount: state.config.deadTileCount,
      scoringMultiple: state.config.scoringMultiple,
      blockedHandRule: state.config.blockedHandRule,
      endHandBonus: state.config.endHandBonus,
      winningScore: state.config.winningScore,
      skipPregameDraw: state.config.skipPregameDraw ?? false,
      policyProfile: state.config.policyProfile ?? null,
    },
    playerIds: [...state.playerIds],
    players: state.playerIds.map((id) => ({
      id,
      hand: state.players[id].hand.map(tileValue).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      score: state.players[id].score,
    })),
    board: canonicalBoard(state.board),
    boneyard: state.boneyard.map(tileValue),
    deadTiles: state.deadTiles.map(tileValue).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    currentPlayerIndex: state.currentPlayerIndex,
    handNumber: state.handNumber,
    handOpen: state.handOpen,
    handOver: state.handOver,
    gameOver: state.gameOver,
    winnerId: state.winnerId,
    consecutivePasses: state.consecutivePasses,
    sequence: state.sequence,
    handStarters: state.handStarters ?? [],
  });
}

/**
 * FNV-1a 32-bit, exported so other digests over a canonical string can reuse
 * the exact same primitive getReviewAuthorityStateDigest uses below, rather
 * than a second hand-copied hash implementation drifting from this one.
 * Pure/deterministic; returns an 8-char lowercase hex string.
 */
export function fnv1a32Hex(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function tileKeyForHash(tile: Tile): [number, number] {
  return [Math.min(tile.low, tile.high), Math.max(tile.low, tile.high)];
}

function actionKeyForHash(action: ReviewAction): unknown {
  if (action.kind === 'play') {
    return { kind: 'play', tile: tileKeyForHash(action.tile), position: action.position };
  }
  return { kind: action.kind };
}

/**
 * Canonical normalized serialization of every correctness-relevant public
 * semantic field used by hidden-state generation and search.
 */
export function canonicalizeReviewPositionSemantics(
  snapshot: Omit<ReviewPositionSnapshotV2, 'integrity'> & {
    readonly integrity?: ReviewPositionSnapshotV2['integrity'];
  },
): string {
  const { preAction, identifiers } = snapshot;
  const ruleset = snapshot.rulesetConfig ?? {
    maxPips: 6,
    tilesPerPlayer: 7,
    deadTileCount: preAction.boneyard.deadCount,
    scoringMultiple: 5,
    blockedHandRule: 'lowestPips' as const,
    endHandBonus: 'sumOpponentPenalties' as const,
    winningScore: preAction.winningTarget,
    skipPregameDraw: false,
  };
  const history = snapshot.publicActionHistory ?? [];
  return JSON.stringify({
    snapshotVersion: snapshot.snapshotVersion,
    rulesVersion: snapshot.rulesVersion,
    commandVersion: snapshot.commandVersion,
    reviewEngineVersion: snapshot.reviewEngineVersion,
    stateDigestVersion: snapshot.stateDigestVersion,
    rulesetConfig: {
      maxPips: ruleset.maxPips,
      tilesPerPlayer: ruleset.tilesPerPlayer,
      deadTileCount: ruleset.deadTileCount,
      scoringMultiple: ruleset.scoringMultiple,
      blockedHandRule: ruleset.blockedHandRule,
      endHandBonus: ruleset.endHandBonus,
      winningScore: ruleset.winningScore,
      skipPregameDraw: ruleset.skipPregameDraw,
    },
    identifiers: {
      gameId: identifiers.gameId,
      handId: identifiers.handId,
      decisionId: identifiers.decisionId,
      handNumber: identifiers.handNumber,
      actionNumber: identifiers.actionNumber,
      turnSequence: identifiers.turnSequence,
      actorId: identifiers.actorId,
      opponentId: identifiers.opponentId,
      mode: identifiers.mode,
    },
    publicActionHistory: history.map((event) => ({
      sequence: event.sequence,
      actorId: event.actorId,
      kind: event.kind,
      tile: event.tile ? tileKeyForHash(event.tile) : null,
      position: event.position ?? null,
      openEnds: [...event.openEnds].sort((a, b) => a - b),
    })),
    preAction: {
      board: canonicalBoard(preAction.board),
      actorHand: [...preAction.actorHand].map(tileKeyForHash).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      opponentTileCount: preAction.opponentTileCount,
      boneyard: preAction.boneyard,
      scores: preAction.scores,
      winningTarget: preAction.winningTarget,
      consecutivePasses: preAction.consecutivePasses,
      handOpen: preAction.handOpen,
      knownMissingPipEvidence: preAction.knownMissingPipEvidence.map((row) => ({
        opponentId: row.opponentId,
        pip: row.pip,
        reason: row.reason,
        observedHandNumber: row.observedHandNumber,
        observedSequence: row.observedSequence,
        openEnds: [...row.openEnds].sort((a, b) => a - b),
      })),
    },
    legalActions: snapshot.legalActions.map(actionKeyForHash),
    actualAction: actionKeyForHash(snapshot.actualAction),
  });
}

/**
 * Collision-resistant public fair-position content address (no hidden tiles,
 * no authority digests). SHA-256 over canonicalizeReviewPositionSemantics.
 */
export function computePublicPositionHash(snapshot: Omit<ReviewPositionSnapshotV2, 'integrity'> & {
  readonly integrity?: ReviewPositionSnapshotV2['integrity'];
}): string {
  const canonical = canonicalizeReviewPositionSemantics(snapshot);
  return `position-v${REVIEW_STATE_DIGEST_VERSION}-sha256:${sha256Hex(canonical)}`;
}

export function getReviewAuthorityStateDigest(state: GameState): string {
  const serialized = canonicalizeReviewAuthorityState(state);
  return `review-state-v${REVIEW_STATE_DIGEST_VERSION}:${fnv1a32Hex(serialized)}`;
}

function actionFromCommand(command: GameCommand): ReviewAction {
  if (command.kind === 'play') {
    return { kind: 'play', tile: command.tile, position: command.position };
  }
  return { kind: command.kind };
}

function legalReviewActions(state: GameState, actorId: string): ReviewAction[] {
  const actions: ReviewAction[] = getLegalMoves(state, actorId).map((move) =>
    move.type === 'play'
      ? { kind: 'play', tile: move.tile, position: move.position }
      : { kind: 'pass' },
  );
  if (canDraw(state, actorId)) actions.push({ kind: 'draw' });
  return actions;
}

function immediatePointsForCommand(state: GameState, command: GameCommand): number {
  if (command.kind !== 'play') return 0;
  return computePlayScore(
    simulatePlacement(state.board, command.tile, command.position),
    state.config,
  );
}

export function createReviewPositionSnapshotV2(
  input: CreateReviewPositionSnapshotV2Input,
): ReviewPositionSnapshotV2 {
  const state = input.authorityPreState;
  const actorId = state.playerIds[state.currentPlayerIndex];
  if (state.playerIds.length !== 2) throw new Error('ReviewPositionSnapshotV2 currently requires a 1v1 state.');
  if (input.command.actorId !== actorId) throw new Error('Review command actor does not own the turn.');
  if (input.command.sequence !== state.sequence) throw new Error('Review command sequence is stale.');
  const opponentId = state.playerIds.find((id) => id !== actorId);
  if (!opponentId) throw new Error('Review snapshot requires an opponent.');

  const result = applyGameCommand(state, input.command);
  const drawableCount = Math.max(0, state.boneyard.length - state.config.deadTileCount);

  const rulesetConfig: ReviewRulesetConfig = {
    maxPips: state.config.maxPips,
    tilesPerPlayer: state.config.tilesPerPlayer,
    deadTileCount: state.config.deadTileCount,
    scoringMultiple: state.config.scoringMultiple,
    blockedHandRule: state.config.blockedHandRule,
    endHandBonus: state.config.endHandBonus,
    winningScore: state.config.winningScore,
    skipPregameDraw: state.config.skipPregameDraw ?? false,
  };

  const base = {
    snapshotVersion: REVIEW_POSITION_SNAPSHOT_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    commandVersion: GAME_COMMAND_VERSION,
    reviewEngineVersion: REVIEW_ENGINE_CONTRACT_VERSION,
    stateDigestVersion: REVIEW_STATE_DIGEST_VERSION,
    identifiers: {
      ...input.identifiers,
      handNumber: state.handNumber,
      turnSequence: state.sequence,
      actorId,
      opponentId,
    },
    rulesetConfig,
    publicActionHistory: input.publicActionHistory ?? [],
    preAction: {
      board: state.board,
      actorHand: state.players[actorId].hand,
      opponentTileCount: state.players[opponentId].hand.length,
      boneyard: {
        physicalCount: state.boneyard.length,
        drawableCount,
        deadCount: state.deadTiles.length,
      },
      scores: {
        actor: state.players[actorId].score,
        opponent: state.players[opponentId].score,
      },
      winningTarget: state.config.winningScore,
      consecutivePasses: state.consecutivePasses,
      handOpen: state.handOpen,
      knownMissingPipEvidence: input.knownMissingPipEvidence ?? [],
    },
    legalActions: legalReviewActions(state, actorId),
    actualAction: actionFromCommand(input.command),
    outcome: {
      immediatePoints: immediatePointsForCommand(state, input.command),
      postActionBoard: result.state.board,
      postActionActorScore: result.state.players[actorId].score,
    },
  } as const;

  return {
    ...base,
    integrity: {
      authorityPreStateDigest: getReviewAuthorityStateDigest(state),
      authorityPostStateDigest: getReviewAuthorityStateDigest(result.state),
      positionHash: computePublicPositionHash(base),
    },
  };
}

function canonicalAction(action: ReviewAction): string {
  return action.kind === 'play'
    ? `${action.kind}:${tileValue(action.tile).join('|')}@${action.position}`
    : action.kind;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

/**
 * Proves a public V2 snapshot against exact authority evidence and replays its
 * action through the canonical command engine. No hidden state is fabricated.
 */
export function replayReviewFixture(fixture: ReviewReplayFixture): GameState {
  const { snapshot, authorityPreState } = fixture;
  const actorId = authorityPreState.playerIds[authorityPreState.currentPlayerIndex];
  const opponentId = authorityPreState.playerIds.find((id) => id !== actorId);
  if (!opponentId) throw new Error('Replay fixture requires an opponent.');

  if (getReviewAuthorityStateDigest(authorityPreState) !== snapshot.integrity.authorityPreStateDigest) {
    throw new Error('Review fixture authority pre-state digest mismatch.');
  }
  if (snapshot.identifiers.actorId !== actorId || snapshot.identifiers.opponentId !== opponentId) {
    throw new Error('Review fixture participant identifiers diverge from authority state.');
  }
  assertEqual(canonicalBoard(authorityPreState.board), canonicalBoard(snapshot.preAction.board), 'Review fixture pre-action board mismatch.');
  assertEqual(authorityPreState.players[actorId].hand, snapshot.preAction.actorHand, 'Review fixture actor hand mismatch.');
  if (authorityPreState.players[opponentId].hand.length !== snapshot.preAction.opponentTileCount) {
    throw new Error('Review fixture opponent tile count mismatch.');
  }
  const drawableCount = Math.max(0, authorityPreState.boneyard.length - authorityPreState.config.deadTileCount);
  assertEqual(
    {
      physicalCount: authorityPreState.boneyard.length,
      drawableCount,
      deadCount: authorityPreState.deadTiles.length,
    },
    snapshot.preAction.boneyard,
    'Review fixture boneyard counts mismatch.',
  );
  assertEqual(
    legalReviewActions(authorityPreState, actorId).map(canonicalAction),
    snapshot.legalActions.map(canonicalAction),
    'Review fixture legal actions mismatch.',
  );

  const command: GameCommand = snapshot.actualAction.kind === 'play'
    ? {
        version: GAME_COMMAND_VERSION,
        commandId: `review-replay:${snapshot.identifiers.decisionId}`,
        sequence: authorityPreState.sequence,
        actorId,
        kind: 'play',
        tile: snapshot.actualAction.tile,
        position: snapshot.actualAction.position,
      }
    : {
        version: GAME_COMMAND_VERSION,
        commandId: `review-replay:${snapshot.identifiers.decisionId}`,
        sequence: authorityPreState.sequence,
        actorId,
        kind: snapshot.actualAction.kind,
      };
  const result = applyGameCommand(authorityPreState, command).state;
  assertEqual(canonicalBoard(result.board), canonicalBoard(snapshot.outcome.postActionBoard), 'Review fixture post-action board mismatch.');
  if (immediatePointsForCommand(authorityPreState, command) !== snapshot.outcome.immediatePoints) {
    throw new Error('Review fixture immediate points mismatch.');
  }
  if (result.players[actorId].score !== snapshot.outcome.postActionActorScore) {
    throw new Error('Review fixture post-action score mismatch.');
  }
  if (getReviewAuthorityStateDigest(result) !== snapshot.integrity.authorityPostStateDigest) {
    throw new Error('Review fixture authority post-state digest mismatch.');
  }
  return result;
}
