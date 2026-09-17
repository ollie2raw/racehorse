export type DailyFritzNextHandFailureDecision =
  | { kind: 'rebuild'; delayMs: number; reason: string }
  | { kind: 'unverified_fallback'; attempts: number; delayMs: number; reason: string }
  | { kind: 'retry'; delayMs: number; reason: string }
  | {
      kind: 'stale_cursor_unrecoverable';
      reason: string;
      /** How many hands ahead the server's own cursor is of what this client kept sending. Always > 1 -- see the bail condition below. */
      staleByHands: number;
      /** The server's current_hand_index, read from the failed response itself (no second round-trip). */
      serverCurrentHandIndex: number;
    };

/**
 * Transport failures only. Verification no longer blocks advancement on a
 * modern server, but keep a short retry ladder for timeouts and 5xx responses.
 */
export const DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS = 2;

/**
 * 2026-09 retry-storm fix. `unverified_fallback` used to loop forever on the
 * assumption that it "always advances" -- true for a genuine verification
 * failure, false for a stale cursor: the server's own idempotent-replay
 * check (dailyFritzNextHandRoute.ts) only forgives a client that is EXACTLY
 * one hand behind (attempt.currentHandIndex === completedHandIndex + 1).
 * Anything staler than that 409s every time, unconditionally, no matter how
 * many times the same completedHandIndex is resubmitted -- so a client that
 * is genuinely 2+ hands stale can retry forever without ever succeeding.
 *
 * This is the number of `unverified_fallback` attempts allowed against an
 * observed stale-by->1 cursor before bailing to `stale_cursor_unrecoverable`
 * instead of resubmitting again. Chosen with margin above the 1-behind
 * replay case (which never needs this path at all -- it resolves on a
 * normal retry) so a transient race that narrows to exactly 1 still gets
 * every chance to self-heal; small enough to bail fast once it's clear the
 * staleness isn't narrowing.
 */
export const DAILY_FRITZ_STALE_CURSOR_ATTEMPTS_BEFORE_BAIL = 3;

const REBUILD_CODES = new Set([
  'incomplete_transcript',
  'wrong_actor',
  'stale_revision',
  'missing_fritz_state_digest',
  'fritz_state_mismatch',
  'fritz_action_mismatch',
]);

/**
 * After a local Hand Over, never discard the checkpoint or force a full reload.
 * Rebuild race-prone transcripts, then keep retrying so the player is not trapped.
 */
export function resolveDailyFritzCompletedHandNextHandFailure(input: {
  verifierCode: string | null;
  status: number | null;
  failureAttempt: number;
  /**
   * The server's `current_hand_index`, read off the SAME failed response
   * (no second round-trip) -- present only for the plain "hand is no
   * longer current" 409 (dailyFritzNextHandRoute.ts's stale-cursor branch,
   * which carries no verifierCode). `null`/omitted for every other error
   * shape, and existing callers that don't pass it keep their prior
   * behavior exactly (the stale-cursor bail below is unreachable without
   * it).
   */
  serverCurrentHandIndex?: number | null;
  /** The completedHandIndex THIS failed request sent. Required to compute staleness; ignored when serverCurrentHandIndex is absent. */
  clientCompletedHandIndex?: number;
}): DailyFritzNextHandFailureDecision {
  const code = input.verifierCode;
  const rebuildLimit = code === 'wrong_actor' ? 2 : 4;
  if (code && REBUILD_CODES.has(code) && input.failureAttempt <= rebuildLimit) {
    return { kind: 'rebuild', delayMs: 150, reason: `rebuild-${code}` };
  }
  const label = code ?? (input.status != null ? `http-${input.status}` : 'next-hand-rejected');

  // Stale-cursor detection: only for the plain conflict (no verifierCode --
  // a rebuildable code has its own ladder above, and a genuine verification
  // failure is a different problem this path must not touch) where the
  // server's own cursor is MORE than one hand ahead. Exactly one ahead is
  // the server's idempotent-replay window and already resolves on a normal
  // retry; do not treat it as staleness.
  const staleByHands =
    code === null
    && typeof input.serverCurrentHandIndex === 'number'
    && typeof input.clientCompletedHandIndex === 'number'
      ? input.serverCurrentHandIndex - input.clientCompletedHandIndex
      : null;
  const bailAttempt = DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS + DAILY_FRITZ_STALE_CURSOR_ATTEMPTS_BEFORE_BAIL;

  if (staleByHands !== null && staleByHands > 1 && input.failureAttempt >= bailAttempt) {
    return {
      kind: 'stale_cursor_unrecoverable',
      reason: `${label}-stale-by-${staleByHands}`,
      staleByHands,
      serverCurrentHandIndex: input.serverCurrentHandIndex as number,
    };
  }

  // Legacy servers may still reject verification. Fall back to score-only advance.
  if (input.failureAttempt >= DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS) {
    return {
      kind: 'unverified_fallback',
      attempts: input.failureAttempt,
      delayMs: 300,
      reason: `unverified-fallback-${label}`,
    };
  }

  // First failure: retry silently. This used to return a 'continue' decision
  // carrying the copy "the next deal is loading automatically" — but it
  // scheduled no retry, so nothing was loading and the player had to press
  // Retry. Schedule the retry the copy always promised, and show nothing: a
  // late verification receipt is not the player's problem. For a genuine
  // (non-stale-cursor) failure the ladder still has no fixed ceiling here --
  // unverified_fallback keeps advancing a real verification failure
  // unranked rather than stranding the player -- but a stale cursor is
  // caught above this point and bailed out with a real bound instead.
  return { kind: 'retry', delayMs: 300, reason: label };
}
