import {
  parseGameReviewReplayArtifact,
  type GameReviewReplayArtifactV1,
} from './gameReviewReplayArtifact';

export type GameReviewMode = 'pvf' | 'mp' | 'multiplayer';

export interface GameReviewInsertInput {
  userId: string;
  gameDigest: string;
  reviewEngineVersion: string;
  accuracyModelVersion: string;
  evaluations: readonly Record<string, unknown>[];
  accuracyModelResult: Record<string, unknown>;
  mode: GameReviewMode;
  sourceMatchId?: string | null;
  /** F1e-5 optional versioned historical replay payload. */
  replayArtifact?: GameReviewReplayArtifactV1 | null;
}

export interface GameReviewInsertPayload {
  user_id: string;
  game_digest: string;
  review_engine_version: string;
  accuracy_model_version: string;
  evaluations: readonly Record<string, unknown>[];
  accuracy_model_result: Record<string, unknown>;
  mode: GameReviewMode;
  source_match_id?: string;
  replay_artifact?: GameReviewReplayArtifactV1;
}

export function buildGameReviewInsertPayload(input: GameReviewInsertInput): GameReviewInsertPayload {
  const payload: GameReviewInsertPayload = {
    user_id: input.userId,
    game_digest: input.gameDigest,
    review_engine_version: input.reviewEngineVersion,
    accuracy_model_version: input.accuracyModelVersion,
    evaluations: input.evaluations,
    accuracy_model_result: input.accuracyModelResult,
    mode: input.mode,
  };

  const sourceMatchId = input.sourceMatchId?.trim();
  if (sourceMatchId) {
    payload.source_match_id = sourceMatchId;
  }
  if (input.replayArtifact) {
    payload.replay_artifact = input.replayArtifact;
  }

  return payload;
}

/**
 * Validates and normalizes an untyped request body into a GameReviewInsertInput.
 * Field-level shape of `evaluations`/`accuracyModelResult` is intentionally not
 * deep-validated here -- they persist as opaque jsonb, the same trust boundary
 * daily_fritz_runs.hand_deals already uses for client-computed JSON blobs. This
 * function only enforces the fields the idempotency key and RLS ownership
 * depend on being present and well-typed. `replayArtifact` is version-gated.
 */
export function parseGameReviewRequestBody(
  body: unknown,
  userId: string,
): GameReviewInsertInput | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Request body must be an object.' };
  }
  const record = body as Record<string, unknown>;

  const gameDigest = typeof record.gameDigest === 'string' ? record.gameDigest.trim() : '';
  if (!gameDigest) {
    return { error: 'gameDigest is required.' };
  }

  const reviewEngineVersion =
    typeof record.reviewEngineVersion === 'string' ? record.reviewEngineVersion.trim() : '';
  if (!reviewEngineVersion) {
    return { error: 'reviewEngineVersion is required.' };
  }

  const accuracyModelVersion =
    typeof record.accuracyModelVersion === 'string' ? record.accuracyModelVersion.trim() : '';
  if (!accuracyModelVersion) {
    return { error: 'accuracyModelVersion is required.' };
  }

  if (!Array.isArray(record.evaluations) || record.evaluations.length === 0) {
    return { error: 'evaluations must be a non-empty array.' };
  }

  if (typeof record.accuracyModelResult !== 'object' || record.accuracyModelResult === null) {
    return { error: 'accuracyModelResult is required.' };
  }

  const mode = record.mode;
  if (mode !== 'pvf' && mode !== 'mp' && mode !== 'multiplayer') {
    return { error: "mode must be 'pvf', 'mp', or 'multiplayer'." };
  }

  const sourceMatchId = typeof record.sourceMatchId === 'string' ? record.sourceMatchId : null;

  const replayParsed = parseGameReviewReplayArtifact(record.replayArtifact);
  if (replayParsed && 'error' in replayParsed) {
    return { error: replayParsed.error };
  }

  return {
    userId,
    gameDigest,
    reviewEngineVersion,
    accuracyModelVersion,
    evaluations: record.evaluations as Record<string, unknown>[],
    accuracyModelResult: record.accuracyModelResult as Record<string, unknown>,
    mode,
    sourceMatchId,
    replayArtifact: replayParsed,
  };
}
