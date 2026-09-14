import type { GameCommand } from '@racehorse/game-core';
import {
  createReviewPositionSnapshotV2,
  type ReviewKnownMissingPipEvidence,
  type ReviewPositionIdentifiers,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/reviewContracts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { toCoreGameState } from '../match/runtime/gameCoreAdapter.ts';
import { toReviewKnownMissingPipEvidence } from './missingPipEvidenceAdapter.ts';

/** Caller-supplied IDs; hand/turn/actor/opponent are filled from authority state. */
export type CaptureReviewSnapshotIdentifiers = Omit<
  ReviewPositionIdentifiers,
  'handNumber' | 'turnSequence' | 'actorId' | 'opponentId'
>;

export type CaptureReviewSnapshotAtDecisionArgs = {
  readonly preState: BotMatchState;
  readonly command: GameCommand;
  readonly identifiers: CaptureReviewSnapshotIdentifiers;
  /**
   * Optional explicit evidence. When omitted, converts
   * `preState.reviewMissingPipObservations` and keeps only rows about the
   * decision opponent (same filter as the fixture corpus).
   */
  readonly knownMissingPipEvidence?: readonly ReviewKnownMissingPipEvidence[];
};

/**
 * Thin PVF capture wrapper: project live `BotMatchState` through
 * `toCoreGameState` into `createReviewPositionSnapshotV2`. Does not invent
 * public facts — the factory projects them from authority.
 */
export function captureReviewSnapshotAtDecision(
  args: CaptureReviewSnapshotAtDecisionArgs,
): ReviewPositionSnapshotV2 {
  const authorityPreState = toCoreGameState(args.preState);
  const actorId = authorityPreState.playerIds[authorityPreState.currentPlayerIndex];
  const opponentId = authorityPreState.playerIds.find((id) => id !== actorId);
  if (!opponentId) {
    throw new Error('captureReviewSnapshotAtDecision requires a 1v1 pre-state.');
  }

  const knownMissingPipEvidence =
    args.knownMissingPipEvidence
    ?? toReviewKnownMissingPipEvidence(args.preState.reviewMissingPipObservations ?? []).filter(
      (row) => row.opponentId === opponentId,
    );

  return createReviewPositionSnapshotV2({
    authorityPreState,
    command: args.command,
    identifiers: args.identifiers,
    knownMissingPipEvidence,
  });
}
