import { getJourneyNodeById } from './journeyChapters';
import { findJourneyAttempt } from './journeyAttempts';
import type { JourneyMatchOutcomeResult } from './journeyCompletionCore';
import { listPendingCompletions } from './journeyPendingCompletions';
import { getJourneyNodeStatus, loadJourneyProgress } from './journeyStorage';

/**
 * What a player may be told when a lesson run finishes. This is derived from what is actually STORED, not from the
 * fact that the lesson says "passed":
 *
 *   confirmed        this run's completion was written AND the stage reads back as completed.
 *   already_credited the stage is completed in stored progress, but not by this call (a replay, a duplicate callback,
 *                    or a recovery that finished the job). Success, and nothing was undone.
 *   pending          this run's win is settled and a durable pending-completion obligation exists for exactly this
 *                    attempt and node, but the stage does not read back as completed yet. The existing recovery will
 *                    finish it on a later Journey load. Uncertain, NOT rejected.
 *   rejected         the run was not credited and nothing is owed: the completion contract refused it (or the stage is
 *                    not open). Definitive for this run; the player can replay to try again.
 *   unverified       the outcome could not be determined: the caller supplied no status, a malformed one, or threw.
 *                    FAIL-CLOSED: this is what any missing or unrecognisable status becomes, and it never shows
 *                    success. It is NOT a pending obligation (none is claimed); the player is asked to check, and a
 *                    check re-reads storage through the real classifier.
 *
 * Client-side status, not proof: it reports what this browser's storage says. The durable obligation and its
 * validation live in `journeyCompletionCore` / `journeyStageCompletion` / `journeyCompletionRecovery`; nothing here
 * writes, retries or clears anything.
 */
export type JourneyLessonCompletionStatus =
  | { kind: 'confirmed' }
  | { kind: 'already_credited' }
  | { kind: 'pending' }
  | { kind: 'rejected'; reason: 'not_credited' | 'stage_not_open' }
  | { kind: 'unverified' };

const REJECTION_REASONS: ReadonlySet<unknown> = new Set(['not_credited', 'stage_not_open']);

/**
 * The ONLY way a status from a caller reaches the UI. Anything that is not exactly a recognised status — undefined,
 * null, a string, an unknown kind, a rejection without a known reason — becomes `unverified`, never a success.
 */
export function normalizeJourneyLessonCompletionStatus(value: unknown): JourneyLessonCompletionStatus {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const { kind, reason } = value as { kind?: unknown; reason?: unknown };
    if (kind === 'confirmed' || kind === 'already_credited' || kind === 'pending' || kind === 'unverified') return { kind };
    if (kind === 'rejected' && REJECTION_REASONS.has(reason)) return { kind: 'rejected', reason: reason as 'not_credited' | 'stage_not_open' };
  }
  return { kind: 'unverified' };
}

export function isJourneyLessonCompletionCredited(status: JourneyLessonCompletionStatus): boolean {
  return status.kind === 'confirmed' || status.kind === 'already_credited';
}

export function classifyJourneyLessonCompletion(input: {
  attemptId: string | null | undefined;
  nodeId: string;
  /** What `recordJourneyLessonCompletion` returned for this run; null when re-checking later. */
  result: JourneyMatchOutcomeResult | null;
}): JourneyLessonCompletionStatus {
  const node = getJourneyNodeById(input.nodeId);
  const credited = node != null && getJourneyNodeStatus(node, loadJourneyProgress()) === 'completed';
  if (credited) return input.result?.recorded && input.result.completedNode ? { kind: 'confirmed' } : { kind: 'already_credited' };

  const attempt = input.attemptId ? findJourneyAttempt(input.attemptId) : null;
  const owed = input.attemptId != null && attempt?.outcome === 'won'
    && listPendingCompletions().some(({ record }) => record != null && record.attemptId === input.attemptId && record.nodeId === input.nodeId);
  if (owed) return { kind: 'pending' };

  // recorded but not credited and nothing owed: the stage was not completable (locked) — as opposed to a refusal
  return { kind: 'rejected', reason: input.result?.recorded ? 'stage_not_open' : 'not_credited' };
}
