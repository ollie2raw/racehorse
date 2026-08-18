export type DailyFritzNextHandFailureDecision =
  | { kind: 'rebuild'; delayMs: number; reason: string }
  | { kind: 'unverified_fallback'; attempts: number; delayMs: number; reason: string }
  | { kind: 'continue'; message: string; reason: string };

/**
 * Failed verification attempts before the run continues without a receipt.
 *
 * Must stay >= the server's DAILY_FRITZ_UNVERIFIED_FALLBACK_MIN_ATTEMPTS
 * (server/src/http/routes/dailyFritzVerificationGlue.ts), which rejects the
 * fallback below that count.
 */
export const DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS = 5;

const REBUILD_CODES = new Set([
  'incomplete_transcript',
  'wrong_actor',
  'stale_revision',
  'missing_fritz_state_digest',
  'fritz_state_mismatch',
  'fritz_action_mismatch',
]);

const CONTINUE_COPY =
  'Still confirming this hand — your result is saved and we’re retrying automatically.';

/**
 * After a local Hand Over, never discard the checkpoint or force a full reload.
 * Rebuild race-prone transcripts, then keep Continue so the player is not trapped.
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
  // Rebuilding did not help and the player is otherwise trapped on Hand Over.
  // Continue the run unranked rather than ending it here.
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
