import { applyGameCommand, type GameCommand } from './commands';
import { canDraw, getLegalMoves } from './engine';
import { computePlayScore, simulatePlacement } from './scoring';
import type { BoardState, GameState, PlacementPosition, Tile } from './types';
import { GAME_COMMAND_VERSION, GAME_RULES_VERSION } from './versions';

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

export function getReviewAuthorityStateDigest(state: GameState): string {
  const serialized = canonicalizeReviewAuthorityState(state);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `review-state-v${REVIEW_STATE_DIGEST_VERSION}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
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

  return {
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
    integrity: {
      authorityPreStateDigest: getReviewAuthorityStateDigest(state),
      authorityPostStateDigest: getReviewAuthorityStateDigest(result.state),
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
