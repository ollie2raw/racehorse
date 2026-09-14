import { GAME_COMMAND_VERSION, type GameCommand } from '@racehorse/game-core';
import type {
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/reviewContracts';
import type { PlacementPosition, Tile } from '../../types.ts';
import type { BotMatchState, BotPlayerId } from '../match/runtime/botEngine.ts';
import { toCoreGameState } from '../match/runtime/gameCoreAdapter.ts';
import { captureReviewSnapshotAtDecision } from './captureReviewSnapshotAtDecision.ts';

export type ReviewActorAction =
  | { readonly kind: 'play'; readonly tile: Tile; readonly position: PlacementPosition }
  | { readonly kind: 'draw' }
  | { readonly kind: 'pass' };

/** @deprecated Prefer ReviewActorAction — kept for A3 call-site compatibility. */
export type PlayerReviewAction = ReviewActorAction;

/**
 * In-memory bag of V2 review snapshots for one PVF match session.
 * Not persisted (A6) and not server-written (E0). Cleared on rematch.
 */
export class ReviewSnapshotRecorder {
  private snapshots: ReviewPositionSnapshotV2[] = [];
  private nextActionNumber = 1;
  private sessionId: string;
  private gameId: string;

  constructor(ids?: { sessionId?: string; gameId?: string }) {
    this.sessionId = ids?.sessionId ?? `pvf-session-${Date.now()}`;
    this.gameId = ids?.gameId ?? this.sessionId;
  }

  getSnapshots(): readonly ReviewPositionSnapshotV2[] {
    return this.snapshots;
  }

  clear(ids?: { sessionId?: string; gameId?: string }): void {
    this.snapshots = [];
    this.nextActionNumber = 1;
    if (ids?.sessionId) this.sessionId = ids.sessionId;
    else this.sessionId = `pvf-session-${Date.now()}`;
    this.gameId = ids?.gameId ?? this.sessionId;
  }

  recordPlayerDecision(
    preState: BotMatchState,
    action: ReviewActorAction,
    enabled: boolean,
  ): ReviewPositionSnapshotV2 | null {
    return this.recordActorDecision(preState, 'you', action, enabled);
  }

  recordBotDecision(
    preState: BotMatchState,
    action: ReviewActorAction,
    enabled: boolean,
  ): ReviewPositionSnapshotV2 | null {
    return this.recordActorDecision(preState, 'bot', action, enabled);
  }

  /**
   * Capture one actor decision at the true pre-action boundary.
   * No-ops when `enabled` is false. Swallows capture errors so live play
   * cannot break if a digest/command envelope fails.
   */
  recordActorDecision(
    preState: BotMatchState,
    actorId: BotPlayerId,
    action: ReviewActorAction,
    enabled: boolean,
  ): ReviewPositionSnapshotV2 | null {
    if (!enabled) return null;
    if (preState.currentPlayer !== actorId) return null;
    if (preState.handOver || preState.gameOver) return null;

    try {
      const actionNumber = this.nextActionNumber;
      const decisionId = `${this.sessionId}:${actorId}:${actionNumber}`;
      const command = buildReviewGameCommand(preState, actorId, action, decisionId);
      const snapshot = captureReviewSnapshotAtDecision({
        preState,
        command,
        identifiers: {
          sessionId: this.sessionId,
          gameId: this.gameId,
          handId: `hand-${preState.handNumber}`,
          decisionId,
          mode: 'play-vs-fritz',
          gameNumber: 1,
          actionNumber,
        },
      });
      this.nextActionNumber += 1;
      this.snapshots = [...this.snapshots, snapshot];
      return snapshot;
    } catch {
      return null;
    }
  }
}

export function buildReviewGameCommand(
  preState: BotMatchState,
  actorId: BotPlayerId,
  action: ReviewActorAction,
  decisionId: string,
): GameCommand {
  const authority = toCoreGameState(preState);
  const base = {
    version: GAME_COMMAND_VERSION,
    commandId: decisionId,
    sequence: authority.sequence,
    actorId,
  };
  if (action.kind === 'play') {
    return {
      ...base,
      kind: 'play',
      tile: action.tile,
      position: action.position,
    };
  }
  return { ...base, kind: action.kind };
}

/** @deprecated Prefer buildReviewGameCommand. */
export function buildPlayerReviewGameCommand(
  preState: BotMatchState,
  action: ReviewActorAction,
  decisionId: string,
): GameCommand {
  return buildReviewGameCommand(preState, 'you', action, decisionId);
}
