/**
 * A hand that advanced without a verification receipt (`unverified_hands`, status `rejected`) must stay
 * unrewarded after the run is finalized or any later game is recorded. The streak predicate
 * (`isDailyFritzAttemptStreakEligible`) trusts `unverified_hands` as "the durable fact"; a result rebuild that drops it
 * silently turns a tampered/rejected run into a streak-eligible completion.
 */
import { describe, expect, it } from 'vitest';
import {
  isDailyFritzAttemptLeaderboardEligible,
  isDailyFritzAttemptStreakEligible,
  type DailyFritzAttemptRecord,
} from '../stores/dailyFritzStore';
import { applyDailyFritzAttemptFinalization } from './dailyFritzAttemptFinalize';
import { buildRecordedDailyFritzAttemptResult } from './dailyFritzVerificationPolicy';

const RUN_DATE = '2026-08-19';

function rejectedSetResult(): Record<string, unknown> {
  return {
    version: 2,
    format: 'best_of_3',
    playerGamesWon: 2,
    fritzGamesWon: 0,
    totalPointDiff: 34,
    setWinner: 'player',
    instantSkunk: true,
    skunkGameNumber: 1,
    verification_status: 'rejected',
    verification_protocol_version: 2,
    unverified_hands: [{ game_number: 1, hand_index: 6, verifier_code: 'fritz_state_mismatch' }],
    games: [{
      gameNumber: 1,
      seed: `daily-fritz-${RUN_DATE}:game:1`,
      playerScore: 61,
      fritzScore: 27,
      playerWon: true,
      pointDiff: 34,
      movesUsed: 53,
      handsPlayed: 7,
      skunk: true,
      skunkBy: 'player',
      completedAt: '2026-08-19T22:10:24.923Z',
    }],
    authority: { version: 1, hands: [], games: [] },
  };
}

function rejectedAttempt(): DailyFritzAttemptRecord {
  return { id: 'attempt-rejected', runDate: RUN_DATE, userId: 'user-rejected', status: 'started', result: rejectedSetResult() } as unknown as DailyFritzAttemptRecord;
}

describe('a rejected run stays unrewarded', () => {
  it('finalizing a rejected run keeps its rejection evidence: not leaderboard- nor streak-eligible', () => {
    const attempt = rejectedAttempt();
    const finalization = applyDailyFritzAttemptFinalization(attempt, RUN_DATE);
    expect(finalization?.isVerified).toBe(false);
    expect(attempt.status).toBe('completed');
    expect(isDailyFritzAttemptLeaderboardEligible(attempt)).toBe(false);
    expect(attempt.result?.unverified_hands).toEqual([{ game_number: 1, hand_index: 6, verifier_code: 'fritz_state_mismatch' }]);
    expect(isDailyFritzAttemptStreakEligible(attempt)).toBe(false);
  });

  it('recording a later game WITHOUT a transcript cannot erase the rejection of an earlier hand', () => {
    const next = buildRecordedDailyFritzAttemptResult({
      previousResult: rejectedSetResult(),
      setResult: { version: 2, format: 'best_of_3', games: [] },
      hasTranscript: false,
    });
    expect(next.unverified_hands).toEqual([{ game_number: 1, hand_index: 6, verifier_code: 'fritz_state_mismatch' }]);
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: next })).toBe(false);
  });
});
