import {
  createReviewPositionSnapshotV2,
  type ReviewAction,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { GAME_COMMAND_VERSION, type GameCommand } from '@racehorse/game-core';
import { DEFAULT_CONFIG } from '@racehorse/game-core/types';
import type { GameState, PlacementPosition, Tile } from '../types.ts';

function placeholderTiles(count: number): Tile[] {
  return Array.from({ length: Math.max(0, count) }, () => ({ low: 0, high: 0 }));
}

/** Build a review snapshot from MP's masked, player-visible state only. */
export function captureMultiplayerReviewSnapshot(input: {
  state: GameState;
  actorId: string;
  action: ReviewAction;
  sessionId: string;
  gameId: string;
  actionNumber: number;
}): ReviewPositionSnapshotV2 {
  const { state, actorId, action, sessionId, gameId, actionNumber } = input;
  const opponentId = state.playerIds.find((id) => id !== actorId);
  if (!opponentId) throw new Error('Multiplayer review requires a 1v1 state.');
  const actorIndex = state.playerIds.indexOf(actorId);
  if (actorIndex < 0 || state.currentPlayerIndex !== actorIndex) {
    throw new Error('Multiplayer review actor is not the current player.');
  }

  const authorityState = {
    config: { ...DEFAULT_CONFIG, ...state.config },
    playerIds: [actorId, opponentId],
    players: {
      [actorId]: { id: actorId, hand: state.players[actorId]?.hand ?? [], score: state.players[actorId]?.score ?? 0 },
      [opponentId]: {
        id: opponentId,
        // Placeholder identities preserve only the public count; the factory
        // never exposes these values in the V2 snapshot.
        hand: placeholderTiles(state.handCounts?.[opponentId] ?? state.players[opponentId]?.hand.length ?? 0),
        score: state.players[opponentId]?.score ?? 0,
      },
    },
    board: state.board,
    boneyard: placeholderTiles(state.boneyard.length),
    deadTiles: placeholderTiles(state.deadTiles.length),
    currentPlayerIndex: 0,
    handNumber: state.handNumber,
    handOpen: state.handOpen,
    handOver: state.handOver,
    gameOver: state.gameOver,
    winnerId: state.winnerId,
    consecutivePasses: state.consecutivePasses,
    sequence: state.sequence,
  };
  const command: GameCommand = {
    version: GAME_COMMAND_VERSION,
    commandId: `${sessionId}:${actionNumber}`,
    sequence: state.sequence,
    actorId,
    ...(action.kind === 'play'
      ? { kind: 'play' as const, tile: action.tile, position: action.position as PlacementPosition }
      : { kind: action.kind }),
  };
  return createReviewPositionSnapshotV2({
    authorityPreState: authorityState,
    command,
    identifiers: {
      sessionId,
      gameId,
      handId: `hand-${state.handNumber}`,
      decisionId: `${sessionId}:${actorId}:${actionNumber}`,
      mode: 'multiplayer',
      gameNumber: 1,
      actionNumber,
    },
    knownMissingPipEvidence: [],
  });
}
