/**
 * F1e-5 historical Game Review replay artifact — server boundary.
 *
 * Path A: persist rendered coaching prose alongside facts so historical
 * reopen does not depend on a prose-renderer version dispatcher (none exists
 * today). `artifactVersion` is the only supported discriminator; unknown
 * versions are rejected rather than reinterpreted by current code.
 */

export const GAME_REVIEW_REPLAY_ARTIFACT_VERSION = 1 as const;

export type GameReviewReplayArtifactV1 = {
  readonly artifactVersion: typeof GAME_REVIEW_REPLAY_ARTIFACT_VERSION;
  /** Serialized GameAnalysis (navigation, boards, ratings). */
  readonly analysis: Record<string, unknown>;
  /** moveNumber → decisionId pairs in display order. */
  readonly decisionIds: readonly { readonly moveNumber: number; readonly decisionId: string }[];
  /**
   * Per-decision canonical coaching payload. Evaluations remain in the
   * parent row's `evaluations` column; this map keys the coaching layer.
   */
  readonly decisions: readonly {
    readonly decisionId: string;
    readonly coachingFacts: Record<string, unknown>;
    readonly coachingProse: {
      readonly headline: string;
      readonly detail: string;
      readonly takeaway: string;
    };
  }[];
};

export function parseGameReviewReplayArtifact(
  value: unknown,
): GameReviewReplayArtifactV1 | { error: string } | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'replayArtifact must be an object when present.' };
  }
  const record = value as Record<string, unknown>;
  if (record.artifactVersion !== GAME_REVIEW_REPLAY_ARTIFACT_VERSION) {
    return { error: `Unsupported replayArtifact.artifactVersion (expected ${GAME_REVIEW_REPLAY_ARTIFACT_VERSION}).` };
  }
  if (typeof record.analysis !== 'object' || record.analysis === null || Array.isArray(record.analysis)) {
    return { error: 'replayArtifact.analysis is required.' };
  }
  if (!Array.isArray(record.decisionIds)) {
    return { error: 'replayArtifact.decisionIds must be an array.' };
  }
  if (!Array.isArray(record.decisions)) {
    return { error: 'replayArtifact.decisions must be an array.' };
  }
  for (const entry of record.decisionIds) {
    if (typeof entry !== 'object' || entry === null) {
      return { error: 'replayArtifact.decisionIds entries must be objects.' };
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.moveNumber !== 'number' || typeof row.decisionId !== 'string' || !row.decisionId) {
      return { error: 'replayArtifact.decisionIds entries need moveNumber and decisionId.' };
    }
  }
  for (const entry of record.decisions) {
    if (typeof entry !== 'object' || entry === null) {
      return { error: 'replayArtifact.decisions entries must be objects.' };
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.decisionId !== 'string' || !row.decisionId) {
      return { error: 'replayArtifact.decisions entries need decisionId.' };
    }
    if (typeof row.coachingFacts !== 'object' || row.coachingFacts === null) {
      return { error: 'replayArtifact.decisions entries need coachingFacts.' };
    }
    const prose = row.coachingProse;
    if (typeof prose !== 'object' || prose === null) {
      return { error: 'replayArtifact.decisions entries need coachingProse.' };
    }
    const p = prose as Record<string, unknown>;
    if (typeof p.headline !== 'string' || typeof p.detail !== 'string' || typeof p.takeaway !== 'string') {
      return { error: 'replayArtifact.coachingProse needs headline, detail, takeaway strings.' };
    }
  }
  return value as GameReviewReplayArtifactV1;
}
