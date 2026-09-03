import { createHash } from 'crypto';
import { getDailyFritzPublishedSetScore } from '../../dailyFritzSkunk';
import {
  DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  getDailyFritzVerificationStatus,
  hasCompleteDailyFritzGameAuthority,
  readAuthorityLedger,
} from './dailyFritzVerificationPolicy';
import {
  getDailyFritzSetPointDiff,
  normalizeDailyFritzSetResult,
  type DailyFritzAttemptRecord,
} from '../stores/dailyFritzStore';

export type DailyFritzAttemptFinalization = {
  /** Set outcome as normalized from `attempt.result` — always has a `setWinner`. */
  setResult: NonNullable<ReturnType<typeof normalizeDailyFritzSetResult>>;
  /** Verified iff no hand was `rejected` and every game has a complete authority record. */
  isVerified: boolean;
  /** `'verified'` or `'legacy_unverified'` — mirrors `verification_status` written onto `attempt.result`. */
  completionVerificationStatus: 'verified' | 'legacy_unverified';
  /** sha256 over the attempt id + ordered hand transcript digests. */
  serverReceipt: string;
};

/**
 * Shared finalization for a Daily Fritz attempt whose set is complete. Mutates
 * `attempt` in place — sets `status='completed'`, `completedAt`, `completionHash`,
 * the score/outcome fields, and rebuilds `attempt.result` with the authority
 * ledger + `verification_status` — exactly as `/api/daily-fritz/complete` did
 * inline. The caller persists (`upsertDailyFritzAttempt` or
 * `commitDailyFritzAttemptCommand`) and journals `attempt_completed`.
 *
 * Returns `null` when the set is not complete (`normalizeDailyFritzSetResult`
 * has no `setWinner`) — the attempt is genuinely mid-play and must not be
 * finalized.
 *
 * Verification is observational only: a `rejected` run finalizes as
 * `legacy_unverified` (off the leaderboard) but still finalizes. This function
 * never promotes a `rejected` run.
 */
export function applyDailyFritzAttemptFinalization(
  attempt: DailyFritzAttemptRecord,
  runDate: string,
): DailyFritzAttemptFinalization | null {
  const setResult = normalizeDailyFritzSetResult(attempt.result);
  if (!setResult?.setWinner) return null;

  const ledger = readAuthorityLedger(attempt.result);
  // A run that advanced any hand without a receipt stays unranked, even if
  // every other game produced a complete authority record.
  const isVerified = getDailyFritzVerificationStatus(attempt.result) !== 'rejected'
    && hasCompleteDailyFritzGameAuthority(attempt.result, setResult);
  const completionVerificationStatus: 'verified' | 'legacy_unverified' = isVerified
    ? 'verified'
    : 'legacy_unverified';

  const { finalScore, opponentScore } = getDailyFritzPublishedSetScore(setResult);
  const won = setResult.setWinner === 'player';
  const movesUsed = ledger.hands.reduce((sum, hand) => sum + hand.actionCount, 0);
  const handsPlayed = ledger.hands.length;
  const pointDiff = getDailyFritzSetPointDiff(setResult) ?? 0;
  const serverReceipt = createHash('sha256')
    .update(`${attempt.id}:${ledger.hands.map((hand) => hand.transcriptDigest).join(':')}`)
    .digest('hex');

  attempt.status = 'completed';
  attempt.completedAt = new Date().toISOString();
  attempt.completionHash = serverReceipt;
  attempt.finalScore = Math.round(finalScore);
  attempt.opponentScore = Math.round(opponentScore);
  attempt.pointDiff = Math.round(pointDiff);
  attempt.won = won;
  attempt.movesUsed = Math.round(movesUsed);
  attempt.handsPlayed = Math.round(handsPlayed);
  attempt.result = {
    ...setResult,
    authority: ledger,
    verification_status: completionVerificationStatus,
    verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
    run_date: runDate,
    final_score: attempt.finalScore,
    opponent_score: attempt.opponentScore,
    point_diff: attempt.pointDiff,
    won,
    moves_used: attempt.movesUsed,
    hands_played: attempt.handsPlayed,
  };

  return { setResult, isVerified, completionVerificationStatus, serverReceipt };
}
