import { describe, expect, it, vi } from 'vitest';
import { generateSingleDailyFritzGameHand, getDailyFritzDrawWinner } from '../dailyFritz';
import { driveDailyFritzAttempt, parseDailyFritzLifecycleStart } from './dailyFritzLifecycleDriver';

describe('Daily Fritz lifecycle driver', () => {
  it('records and completes a terminal verified attempt with replay checks', async () => {
    const start = parseDailyFritzLifecycleStart({
      attempt_id: 'attempt-1',
      verified_match_id: 'attempt-1',
      run_date: '2026-08-08',
      challenge_id: 'daily-fritz:2026-08-08',
      current_game_number: 1,
      current_hand_index: 0,
      current_game_scores: { you: 59, fritz: 59 },
      fritz_tier: 'master',
      fritz_policy_version: 2,
      deal_size: 7,
      winning_score: 60,
      first_hand: generateSingleDailyFritzGameHand('2026-08-08', 1, 0, 7),
      draw_winner: getDailyFritzDrawWinner('2026-08-08', 1),
    });
    let recordCount = 0;
    let completeCount = 0;
    const request = vi.fn(async ({ path }: { path: string }) => {
      if (path.endsWith('/record-game')) {
        recordCount += 1;
        return { ok: true, replayed: recordCount > 1, set_result: { setWinner: 'player' } };
      }
      completeCount += 1;
      return { ok: true, replayed: completeCount > 1 };
    });
    const result = await driveDailyFritzAttempt({ start, startBody: {}, request });
    expect(result).toMatchObject({ attemptId: 'attempt-1', gamesPlayed: 1, handsPlayed: 1 });
    expect(request).toHaveBeenCalledTimes(4);
  });
});
