// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { useDailyFritzCompletion } from './useDailyFritzCompletion.ts';
import type { DailyFritzMatchSession } from './dailyFritzMatchSession.ts';

function buildSession(): DailyFritzMatchSession {
  const match = createBotMatch(60, 7);
  match.gameOver = true;
  match.handNumber = 8;
  match.winnerId = 'you';
  match.players.you.score = 64;
  match.players.bot.score = 51;
  match.officialJournal = { handNumber: 8, actions: [] };
  return {
    cursor: { gameNumber: 2, handIndex: 7, revision: 12 },
    match,
  };
}

describe('useDailyFritzCompletion', () => {
  it('does not re-fire game completion on moveLog or journal identity churn after a failed submit', async () => {
    const onDailyFritzGameComplete = vi.fn().mockRejectedValue(new Error('409 conflict'));
    const baseSession = buildSession();

    const { rerender } = renderHook((props: {
      moveLog: Array<{ moveNumber: number }>;
      session: DailyFritzMatchSession;
    }) => useDailyFritzCompletion({
      enabled: true,
      dailyFritzPackage: {
        attempt_id: 'attempt-1',
        current_game_number: 2,
        winning_score: 60,
      } as never,
      session: props.session,
      moveLog: props.moveLog as never,
      movesUsed: 48,
      userId: 'user-1',
      isGuidedMode: false,
      isAuthoringMode: false,
      onDailyFritzGameComplete,
      setResultLoading: vi.fn(),
      setResultError: vi.fn(),
      resultLoading: false,
      resultError: null,
    }), {
      initialProps: {
        moveLog: [{ moveNumber: 1 }],
        session: baseSession,
      },
    });

    await waitFor(() => expect(onDailyFritzGameComplete).toHaveBeenCalledTimes(1));

    const rerenderedSession = {
      ...baseSession,
      match: {
        ...baseSession.match,
        officialJournal: { handNumber: 8, actions: [] },
      },
    };

    rerender({
      moveLog: [{ moveNumber: 1 }, { moveNumber: 2 }],
      session: rerenderedSession,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDailyFritzGameComplete).toHaveBeenCalledTimes(1);
  });
});
