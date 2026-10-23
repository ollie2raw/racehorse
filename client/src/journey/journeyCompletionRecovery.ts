import { getJourneyNodeById } from './journeyChapters';
import { findJourneyAttempt } from './journeyAttempts';
import { applyCompletionVerified } from './journeyCompletionCore';
import { isLegitimateStageCompletion } from './journeyStageCompletion';
import { listPendingCompletions, removePendingCompletionByKey } from './journeyPendingCompletions';
import { canMarkJourneyNodeComplete, getJourneyNodeStatus, loadJourneyProgress } from './journeyStorage';

export interface JourneyCompletionRecovery {
  /** Stages this run marked complete. */
  applied: number;
  /** Records removed without granting anything: stage already complete, or the record was not valid. */
  cleared: number;
  /** Records left for a later run (attempt still in flight, stage not unlocked yet, or the write did not stick). */
  pending: number;
}

/**
 * Finishes the win → progress link for obligations a crash, reload or lost race left behind. Runs when the
 * Journey trail loads (`useJourneyProgress`), before progress is read for display.
 *
 * A record is honored only if ALL of these hold; otherwise it grants nothing:
 *   - it parses, and belongs to the current storage namespace (records are namespace-keyed);
 *   - the attempt it names is stored, is a `match` attempt for the SAME node, and is `won` (a loss, an
 *     abandonment, a missing attempt or a mismatched node invalidates it — and the record is removed);
 *   - the node is a match or boss stage, and the attempt's recorded stage title is still that node's title
 *     (so a reused or renamed ID cannot be credited), and — for Chapter One — it was recorded under the
 *     current layout version;
 *   - the stage is unlocked right now (a win never skips ahead).
 * A `won` attempt with no record never completes anything.
 *
 * Idempotent: repeated runs find the stage complete (or no record) and change nothing.
 */
export function recoverPendingJourneyCompletions(): JourneyCompletionRecovery {
  const result: JourneyCompletionRecovery = { applied: 0, cleared: 0, pending: 0 };
  for (const { key, record } of listPendingCompletions()) {
    if (!record) {
      removePendingCompletionByKey(key); // malformed
      result.cleared += 1;
      continue;
    }
    const attempt = findJourneyAttempt(record.attemptId);
    if (!attempt) {
      removePendingCompletionByKey(key); // the attempt it referred to is gone
      result.cleared += 1;
      continue;
    }
    if (attempt.outcome === 'in_progress') {
      result.pending += 1; // the settlement may be mid-flight in another tab; decide on a later run
      continue;
    }
    const node = getJourneyNodeById(record.nodeId);
    const legitimate =
      attempt.attemptId === record.attemptId
      && attempt.nodeId === record.nodeId
      && node != null
      && isLegitimateStageCompletion(attempt, node);
    if (!legitimate || !node) {
      removePendingCompletionByKey(key);
      result.cleared += 1;
      continue;
    }

    const progress = loadJourneyProgress();
    const status = getJourneyNodeStatus(node, progress);
    if (status === 'completed') {
      removePendingCompletionByKey(key); // already done (we or another tab finished it): nothing owed
      result.cleared += 1;
    } else if (!canMarkJourneyNodeComplete(node, progress)) {
      result.pending += 1; // not unlocked (yet): a win never skips ahead
    } else if (applyCompletionVerified(record.nodeId, progress)) {
      removePendingCompletionByKey(key);
      result.applied += 1;
    } else {
      result.pending += 1; // contention again: the record stays, a later load retries
    }
  }
  return result;
}
