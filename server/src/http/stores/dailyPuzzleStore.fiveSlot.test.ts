import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyPuzzleAttemptRow } from '../../dailyPuzzle';

const { supabaseFetch } = vi.hoisted(() => ({
  supabaseFetch: vi.fn(),
}));

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch,
}));

import { persistDailyPuzzleAttempt } from './dailyPuzzleStore';

const completedAttemptRow: DailyPuzzleAttemptRow = {
  id: 'attempt-five-slots',
  puzzle_date: '2026-08-06',
  user_id: 'user-five-slots',
  username: 'Player',
  status: 'completed',
  set_version: 2,
  current_slot_index: 5,
  puzzles_completed: 5,
  total_score: 1500,
  master_chain_score: 300,
  completed_at: '2026-08-06T12:05:00.000Z',
  started_at: '2026-08-06T12:00:00.000Z',
  updated_at: '2026-08-06T12:05:00.000Z',
  review_unlocked: true,
  result: {},
};

describe('Daily Puzzle five-slot attempt persistence', () => {
  beforeEach(() => {
    supabaseFetch.mockReset();
  });

  it('persists and reads back a completed five-puzzle attempt', async () => {
    supabaseFetch
      .mockResolvedValueOnce([completedAttemptRow])
      .mockResolvedValueOnce([]);

    const saved = await persistDailyPuzzleAttempt({
      id: completedAttemptRow.id,
      puzzleDate: completedAttemptRow.puzzle_date,
      userId: completedAttemptRow.user_id,
      username: completedAttemptRow.username,
      status: 'completed',
      setVersion: completedAttemptRow.set_version,
      currentSlotIndex: 5,
      puzzlesCompleted: 5,
      totalScore: 1500,
      masterChainScore: 300,
      completedAt: completedAttemptRow.completed_at,
      startedAt: completedAttemptRow.started_at,
      updatedAt: completedAttemptRow.updated_at,
      reviewUnlocked: true,
      practiceMode: 'review',
      result: { slots: [] },
    });

    expect(supabaseFetch).toHaveBeenNthCalledWith(
      1,
      '/rest/v1/daily_puzzle_attempts?on_conflict=id',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    const request = supabaseFetch.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual([
      expect.objectContaining({
        id: 'attempt-five-slots',
        current_slot_index: 5,
        puzzles_completed: 5,
        status: 'completed',
        review_unlocked: true,
      }),
    ]);
    expect(saved).toMatchObject({
      id: 'attempt-five-slots',
      currentSlotIndex: 5,
      puzzlesCompleted: 5,
      status: 'completed',
      reviewUnlocked: true,
    });
  });
});
