import { getJourneyNodeById } from './journeyChapters';
import {
  findJourneyAttempt,
  isJourneyAttemptOwnedByThisPage,
  settleJourneyAttempt,
  type JourneyAttemptDetail,
  type JourneyAttemptKind,
  type JourneyAttemptSettlementRefusal,
} from './journeyAttempts';
import { registerPendingCompletion, removePendingCompletion } from './journeyPendingCompletions';
import { canMarkJourneyNodeComplete, getJourneyNodeStatus, loadJourneyProgress, markJourneyNodeCompleted } from './journeyStorage';

/**
 * The write sequence every Journey attempt that can complete a stage goes through — matches, lessons and
 * sprints share it, so there is exactly one implementation of the ordering that makes a win survive a crash:
 *
 *   1. register a durable pending-completion record (only for a win this page can settle on a completable stage);
 *   2. settle the attempt (terminal, immutable) — a refused settlement never leaves a completed stage;
 *   3. apply the stage completion — idempotent — and read it back, re-applying a bounded number of times;
 *   4. remove the record only once the stage is verifiably complete.
 *
 * What differs per kind is NOT here: whether an attempt is a legitimate completion is decided by the caller
 * before it asks for a win (write time) and again by recovery (`journeyMatchOutcome.recoverPendingJourneyCompletions`)
 * against the stored attempt. This module never decides that a win is deserved; it only sequences the writes.
 */

export interface JourneyMatchOutcomeResult {
  /** The attempt moved to a terminal state on this call. */
  recorded: boolean;
  /** The stage is verifiably complete as a result of this call. */
  completedNode: boolean;
  /** The win is recorded but the stage could not be verified complete; recovery will finish it. */
  completionPending?: true;
  /** When nothing was recorded, why — so a refused result is never mistaken for a recorded one. */
  refused?: JourneyAttemptSettlementRefusal | 'unknown_attempt_or_stage' | 'invalid_completion';
}

/** How many times, in one run, a completion that did not stick is re-applied. Not a guarantee — see below. */
export const COMPLETION_VERIFY_ATTEMPTS = 3;

/**
 * Progress is one whole-object `localStorage` value, so another tab saving at the same instant can overwrite
 * a completion this tab just wrote (read-modify-write has no compare-and-swap). We write, read back, and
 * re-apply from a fresh read a bounded number of times; `markJourneyNodeCompleted` is idempotent, so a repeat
 * can never double-award. This narrows the window but cannot close it against sustained contention — which is
 * why the caller leaves the pending-completion record in place when this returns false.
 */
export function applyCompletionVerified(nodeId: string, progress: ReturnType<typeof loadJourneyProgress>): boolean {
  const isComplete = () => {
    const node = getJourneyNodeById(nodeId);
    return node != null && getJourneyNodeStatus(node, loadJourneyProgress()) === 'completed';
  };
  markJourneyNodeCompleted(nodeId, progress);
  for (let retry = 0; retry < COMPLETION_VERIFY_ATTEMPTS; retry += 1) {
    if (isComplete()) return true;
    markJourneyNodeCompleted(nodeId, loadJourneyProgress());
  }
  return isComplete();
}

export function settleAndApplyJourneyAttempt(input: {
  attemptId: string;
  nodeId: string;
  /** The attempt must be of this kind: a lesson attempt ID can never be settled through the match path, etc. */
  expectedKind: JourneyAttemptKind;
  won: boolean;
  settleDetail?: JourneyAttemptDetail;
}): JourneyMatchOutcomeResult {
  const existing = findJourneyAttempt(input.attemptId);
  // An attempt is bound to one stage and one kind; an outcome for a different one is a caller bug, never a completion.
  if (!existing || existing.nodeId !== input.nodeId || existing.kind !== input.expectedKind) {
    return { recorded: false, completedNode: false, refused: 'unknown_attempt_or_stage' };
  }

  // Step 1 — before the win is settled. Only a win this page can actually settle, on a stage that is
  // completable right now (replays and locked stages owe nothing), registers an obligation.
  const node = getJourneyNodeById(input.nodeId);
  const willSettle = existing.outcome === 'in_progress' && isJourneyAttemptOwnedByThisPage(existing);
  const owed = input.won && willSettle && node != null && canMarkJourneyNodeComplete(node, loadJourneyProgress())
    && registerPendingCompletion(input.attemptId, input.nodeId);

  // Step 2 — settle. Terminal: never rewritten.
  const { changed, reason, attempt: current } = settleJourneyAttempt(
    input.attemptId,
    input.won ? 'won' : 'lost',
    input.settleDetail,
  );
  if (!changed) {
    if (owed) removePendingCompletion(input.attemptId); // we registered it, but the settlement did not happen
    // A result the store refused is surfaced, not swallowed. A duplicate completion callback (the attempt is
    // already won/lost) is harmless and quiet; a refused WIN on an attempt another page reclaimed as stale
    // while this one was frozen, or one owned elsewhere, is the case worth seeing.
    const duplicate = reason === 'already_terminal' && current?.outcome !== 'abandoned';
    if (input.won && !duplicate) {
      console.warn(`[journey] win for ${input.nodeId} was not recorded (${reason ?? 'unknown'}).`);
    }
    return { recorded: false, completedNode: false, refused: reason };
  }
  if (!input.won) return { recorded: true, completedNode: false };

  // Step 3 — apply and verify. Replays of an already-completed stage, and (defensively) locked stages, record
  // the attempt but change no progress.
  const progress = loadJourneyProgress();
  if (!node || !canMarkJourneyNodeComplete(node, progress)) {
    if (owed) removePendingCompletion(input.attemptId); // completed meanwhile (e.g. by another tab): nothing owed
    return { recorded: true, completedNode: false };
  }
  if (applyCompletionVerified(input.nodeId, progress)) {
    removePendingCompletion(input.attemptId); // Step 4 — only now
    return { recorded: true, completedNode: true };
  }
  console.warn(
    `[journey] stage ${input.nodeId} completion could not be verified after ${COMPLETION_VERIFY_ATTEMPTS} retries; `
    + `the win is recorded and the completion will be retried on the next Journey load.`,
  );
  return { recorded: true, completedNode: false, completionPending: true };
}
