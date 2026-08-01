import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiPostMock, apiGetMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
  apiGetMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  apiPost: apiPostMock,
  apiGet: apiGetMock,
}));

import { nextDailyFritzHand } from './api';

describe('Daily Fritz API fault injection', () => {
  afterEach(() => {
    vi.useRealTimers();
    apiPostMock.mockReset();
    apiGetMock.mockReset();
  });

  it('turns a hung next-hand request into a bounded timeout failure', async () => {
    vi.useFakeTimers();
    apiPostMock.mockImplementation((_path: string, _body: unknown, options?: { signal?: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    ));

    const pending = nextDailyFritzHand({
      attemptId: 'attempt-1',
      verifiedMatchId: 'match-1',
      runDate: '2026-07-31',
      gameNumber: 1,
      completedHandIndex: 2,
      transcript: null,
      completedHandScores: { you: 20, fritz: 15 },
      timeoutMs: 25,
    });
    const timeoutAssertion = expect(pending).rejects.toThrow(/timed out loading the next Daily Fritz hand/i);

    await vi.advanceTimersByTimeAsync(1001);
    await timeoutAssertion;
  });

  it('sends a fresh correlation id for each replay attempt', async () => {
    apiPostMock.mockResolvedValue({
      data: {
        ok: true,
        current_hand_index: 3,
        current_game_scores: { you: 20, fritz: 15 },
        hand: { player_tiles: [], fritz_tiles: [], boneyard: [], locked: [] },
        draw_winner: 'you',
        draw_player_tile: { low: 6, high: 6 },
        draw_fritz_tile: { low: 5, high: 5 },
      },
      error: null,
      status: 200,
    });

    const input = {
      attemptId: 'attempt-1',
      verifiedMatchId: 'match-1',
      runDate: '2026-07-31',
      gameNumber: 1 as const,
      completedHandIndex: 2,
      transcript: null,
      completedHandScores: { you: 20, fritz: 15 },
    };
    await nextDailyFritzHand(input);
    await nextDailyFritzHand(input);

    const firstHeaders = apiPostMock.mock.calls[0]?.[2]?.headers;
    const secondHeaders = apiPostMock.mock.calls[1]?.[2]?.headers;
    expect(firstHeaders['x-racehorse-request-id']).toBeTruthy();
    expect(secondHeaders['x-racehorse-request-id']).toBeTruthy();
    expect(firstHeaders['x-racehorse-request-id']).not.toBe(secondHeaders['x-racehorse-request-id']);
  });
});
