export type DailyFritzNextHandFailureDecision =
  | { kind: 'rebuild'; delayMs: number; reason: string }
  | { kind: 'continue'; message: string; reason: string };

const REBUILD_CODES = new Set([
  'incomplete_transcript',
  'wrong_actor',
  'stale_revision',
  'missing_fritz_state_digest',
  'fritz_state_mismatch',
  'fritz_action_mismatch',
]);

const CONTINUE_COPY =
  'Couldn’t verify this hand yet. Continue to retry sending it. The result on this screen is still here.';

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
  return {
    kind: 'continue',
    message: CONTINUE_COPY,
    reason: code ?? (input.status != null ? `http-${input.status}` : 'next-hand-rejected'),
  };
}
