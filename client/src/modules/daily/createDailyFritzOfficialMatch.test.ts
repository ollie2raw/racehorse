// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import {
  createDailyFritzOfficialMatch,
  shouldRunDailyFritzPreGameDraw,
} from './createDailyFritzOfficialMatch.ts';

function dailyPackage(
  overrides: Partial<DailyFritzStartResponse> = {},
): DailyFritzStartResponse {
  return {
    ok: true,
    attempt_id: 'attempt-1',
    verified_match_id: 'match-1',
    run_date: '2026-07-25',
    challenge_id: 'daily-fritz:2026-07-25',
    rules_version: 1,
    seed_version: 1,
    run_fingerprint: 'run-fingerprint',
    verification_protocol_version: 2,
    game_rules_version: 1,
    fritz_policy_version: 2,
    verifier_version: 2,
    time_zone: 'America/Los_Angeles',
    verification_status: 'in_progress',
    current_hand_index: 0,
    current_game_scores: { you: 0, fritz: 0 },
    current_game_number: 1,
    needs_completion: false,
    set_result: null,
    fritz_tier: 'elite',
    deal_size: 7,
    winning_score: 60,
    first_hand: {
      player_tiles: [{ low: 1, high: 1 }],
      fritz_tiles: [{ low: 2, high: 2 }],
      boneyard: [{ low: 3, high: 3 }],
      locked: [{ low: 4, high: 4 }],
    },
    draw_winner: 'you',
    draw_player_tile: { low: 6, high: 6 },
    draw_fritz_tile: { low: 5, high: 5 },
    ...overrides,
  };
}

describe('createDailyFritzOfficialMatch', () => {
  it('uses the server hand index, alternating starter, and verified scores on recovery', () => {
    const match = createDailyFritzOfficialMatch(dailyPackage({
      current_hand_index: 1,
      current_game_scores: { you: 25, fritz: 30 },
    }), 60);

    expect(match.handNumber).toBe(2);
    expect(match.currentPlayer).toBe('bot');
    expect(match.players.you.score).toBe(25);
    expect(match.players.bot.score).toBe(30);
  });

  it('only presents the pregame draw before the first hand', () => {
    expect(shouldRunDailyFritzPreGameDraw(dailyPackage())).toBe(true);
    expect(shouldRunDailyFritzPreGameDraw(dailyPackage({ current_hand_index: 1 }))).toBe(false);
  });
});
