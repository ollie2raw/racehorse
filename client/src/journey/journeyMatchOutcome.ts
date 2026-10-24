import { JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, getJourneyNodeById } from './journeyChapters';
import {
  isJourneyAttemptOwnedByThisPage,
  loadJourneyAttempts,
  settleJourneyAttempt,
  startJourneyAttempt,
} from './journeyAttempts';
import { settleAndApplyJourneyAttempt, type JourneyMatchOutcomeResult } from './journeyCompletionCore';
import { getJourneyNodeStatus, loadJourneyProgress } from './journeyStorage';
import type { JourneyActiveChallenge } from './journeyRuntime';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';

export type { JourneyMatchOutcomeResult };

/**
 * Journey's side of the match lifecycle: start an attempt when a trial launches, record its outcome
 * when the match reaches game over, and treat any other exit as abandonment.
 *
 * WIN → PROGRESS
 *
 * A win is two writes to two keys: the attempt becomes `won`, and the stage becomes complete in the progress
 * store. The second is a whole-object read-modify-write that another tab can overwrite, so it can be lost
 * after the first succeeded. To keep a recorded win from being silently disconnected from progress:
 *
 *   1. validate the attempt and write a durable PENDING-COMPLETION record (`journeyPendingCompletions.ts`);
 *   2. settle the attempt as `won` (terminal, immutable);
 *   3. apply the completion — idempotent — and read it back, re-applying a bounded number of times;
 *   4. delete the record only when the stage is verifiably complete.
 *
 * Settling comes before completing, so a failed settlement can never leave a completed stage. A crash, reload
 * or exhausted retries leaves the record in place, and `recoverPendingJourneyCompletions` finishes the job on
 * the next Journey load. Retries therefore survive reloads: the in-run retry count is bounded, the obligation
 * is not. Completion is awarded only for an attempt that went through step 1 — never from an attempt entry
 * alone.
 *
 * RECOVERY lives in `journeyCompletionRecovery.ts`, not here. This module is imported by the ordinary match
 * routes (`soloPlayRoutes` → `AppRoutes`), which must not statically pull in lesson content, the lesson
 * controller or sprint data; recovery has to know about all three, so it sits on the lazy Journey screen path.
 * `journeyModuleBoundary.test.ts` pins that boundary.
 */

/** Starts a `match` attempt for the challenge and returns the challenge carrying its `attemptId`. */
export function beginJourneyMatchAttempt(challenge: JourneyActiveChallenge): JourneyActiveChallenge {
  const node = getJourneyNodeById(challenge.nodeId);
  const replay = node ? getJourneyNodeStatus(node, loadJourneyProgress()) === 'completed' : false;
  const attempt = startJourneyAttempt({
    nodeId: challenge.nodeId,
    kind: 'match',
    detail: {
      stage: challenge.nodeTitle,
      rival: challenge.rivalName ?? null,
      fritzTier: challenge.fritzTier,
      dealSize: challenge.dealSize,
      winningScore: challenge.winningScore,
      headStartYou: challenge.scoreHandicap?.you ?? 0,
      headStartBot: challenge.scoreHandicap?.bot ?? 0,
      replay,
      // Which Chapter One layout this attempt belongs to (null for other chapters). Recovery refuses an
      // attempt from another layout, where the same node ID meant a different stage.
      chapterLayout: node?.chapterId === JOURNEY_CHAPTER_1_ID ? JOURNEY_CHAPTER_ONE_LAYOUT_VERSION : null,
    },
  });
  return { ...challenge, attemptId: attempt.attemptId };
}

export function recordJourneyMatchOutcome(input: {
  attemptId: string;
  nodeId: string;
  won: boolean;
  finalScore?: { you: number; bot: number };
}): JourneyMatchOutcomeResult {
  // The register → settle → apply and verify → clear sequence is shared with lessons and sprints
  // (`journeyCompletionCore.ts`); a match win needs no extra proof beyond the engine's game-over result.
  return settleAndApplyJourneyAttempt({
    attemptId: input.attemptId,
    nodeId: input.nodeId,
    expectedKind: 'match',
    won: input.won,
    settleDetail: input.finalScore ? { finalYou: input.finalScore.you, finalBot: input.finalScore.bot } : undefined,
  });
}

/**
 * Any exit that is not a recorded game-over result. A no-op for an attempt that already reached
 * `won`/`lost`, so leaving after the result card cannot rewrite it.
 */
export function abandonJourneyMatchAttempt(attemptId: string | null | undefined): boolean {
  if (!attemptId) return false;
  return settleJourneyAttempt(attemptId, 'abandoned').changed;
}

/**
 * Called when the trail screen mounts. A live match and the trail are never mounted together *in one
 * page*, so any `match` attempt this page still has open is dead — the player left by browser back or a
 * swipe, where no exit handler ran — and is settled as abandoned. Returns how many were settled.
 */
export function abandonStaleJourneyMatchAttempts(): number {
  let settled = 0;
  for (const attempt of loadJourneyAttempts()) {
    // Only this page's own attempts: a live match in another tab is that tab's to finish. (Attempts nobody
    // owns any more — a killed tab — were already settled by the read above, via the heartbeat rule.)
    if (
      attempt.kind === 'match'
      && attempt.outcome === 'in_progress'
      && isJourneyAttemptOwnedByThisPage(attempt)
      && settleJourneyAttempt(attempt.attemptId, 'abandoned').changed
    ) {
      settled += 1;
    }
  }
  return settled;
}
