export type DailyFritzNextHandFailureDecision =
  | { kind: 'rebuild'; delayMs: number; reason: string }
  | { kind: 'unverified_fallback'; attempts: number; delayMs: number; reason: string }
  | { kind: 'continue'; message: string; reason: string };

const CONTINUE_COPY =
  'Saving your hand — the next deal is loading automatically.';

/**
 * Transport failures only. Verification no longer blocks advancement on a
 * modern server, but keep a short retry ladder for timeouts and 5xx responses.
 */
export const DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS = 2;

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
}): DailyFritzNextHandFailureDecision {
  const code = input.verifierCode;
  const rebuildLimit = code === 'wrong_actor' ? 2 : 4;
  if (code && REBUILD_CODES.has(code) && input.failureAttempt <= rebuildLimit) {
    return { kind: 'rebuild', delayMs: 150, reason: `rebuild-${code}` };
  }
  // Legacy servers may still reject verification. Fall back to score-only advance.
  if (input.failureAttempt >= DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS) {
    return {
      kind: 'unverified_fallback',
      attempts: input.failureAttempt,
      delayMs: 300,
      reason: `unverified-fallback-${code ?? (input.status != null ? `http-${input.status}` : 'unknown')}`,
    };
  }
  return {
    kind: 'continue',
    message: CONTINUE_COPY,
    reason: code ?? (input.status != null ? `http-${input.status}` : 'next-hand-rejected'),
  };
}
