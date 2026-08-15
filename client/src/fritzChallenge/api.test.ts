import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPost } from '../api/client';
import { recordFritzChallengeGame } from './api';

vi.mock('../api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

const post = vi.mocked(apiPost);

const transcript = {
  protocolVersion: 2,
  challengeId: 'fritz-challenge:test',
  attemptId: 'attempt-1',
  gameNumber: 1,
  handIndex: 0,
  actions: [],
} as never;

describe('Fritz Challenge command recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes authority and replays record-game after a stale revision', async () => {
    post
      .mockResolvedValueOnce({
        data: null,
        error: 'Challenge game advanced on another session.',
        errorCode: 'stale_revision',
        status: 409,
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          attempt: {
            id: 'attempt-1',
            status: 'started',
            current_game_number: 1,
            current_hand_index: 0,
            revision: 4,
          },
          challenge: {},
          challenge_id: 'fritz-challenge:test',
          fingerprint: 'fingerprint',
          verification_protocol_version: 2,
          game_rules_version: 1,
          fritz_policy_version: 2,
          verifier_version: 1,
          current_game_number: 1,
          current_hand_index: 0,
          current_game_scores: { you: 60, fritz: 55 },
          fritz_tier: 'master',
          deal_size: 7,
          winning_score: 60,
          first_hand: {
            player_tiles: [],
            fritz_tiles: [],
            boneyard: [],
            locked: [],
          },
          draw_winner: 'you',
          draw_player_tile: { low: 1, high: 1 },
          draw_fritz_tile: { low: 2, high: 2 },
          challenge_code: 'ABCDEFGH',
          run_date: '2026-08-06',
          verified_match_id: 'attempt-1',
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { ok: true, next_game_number: null, set_result: { games: [] } },
        error: null,
        status: 200,
      });

    const result = await recordFritzChallengeGame({
      code: 'ABCDEFGH',
      attemptId: 'attempt-1',
      gameNumber: 1,
      finalScore: 60,
      opponentScore: 55,
      transcript,
    });

    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[1]?.[0]).toBe('/api/fritz-challenges/ABCDEFGH/start');
    expect(post.mock.calls[2]?.[0]).toBe('/api/fritz-challenges/ABCDEFGH/record-game');
  });

  it('turns an inactive record into a terminal run result', async () => {
    post.mockResolvedValueOnce({
      data: null,
      error: 'Challenge game is no longer current.',
      errorCode: 'attempt_inactive',
      status: 409,
    });

    await expect(recordFritzChallengeGame({
      code: 'ABCDEFGH',
      attemptId: 'attempt-1',
      gameNumber: 1,
      finalScore: 60,
      opponentScore: 55,
      transcript,
    })).rejects.toMatchObject({
      name: 'DailyFritzEndOfRunError',
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
