import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzStartResponse } from '../../daily/dailyFritzContracts.ts';
import { createBotMatch, type BotMatchState } from '../runtime/botEngine.ts';
import type { UseGuidedLessonBootResult } from '../../guided/index.ts';
import { useBotMatchRefs } from './useBotMatchRefs.ts';
import type { UseBotMatchBootstrapResult } from './useBotMatchBootstrap.ts';
import { useMatchPresentation } from './useMatchPresentation.ts';

function withScore(
  match: BotMatchState,
  player: 'you' | 'bot',
  score: number,
): BotMatchState {
  return {
    ...match,
    players: {
      ...match.players,
      [player]: {
        ...match.players[player],
        score,
      },
    },
  };
}

function dailyPackage(attemptId: string): DailyFritzStartResponse {
  return {
    attempt_id: attemptId,
  } as DailyFritzStartResponse;
}

describe('useMatchPresentation Daily Fritz score cues', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('cues committed scores near tile landing and keeps newer events timer-safe', () => {
    const initial = createBotMatch(60, 7);
    const { result, rerender } = renderHook(
      ({ match }: { match: BotMatchState }) => {
        const refs = useBotMatchRefs();
        return useMatchPresentation({
          bootstrap: {
            match,
            mode: 'daily-fritz',
            opponentLabel: 'Fritz',
            isDailyFritzMode: true,
            dailyFritzPackage: dailyPackage('attempt-1'),
            preGameDrawActive: false,
          } as UseBotMatchBootstrapResult,
          refs,
          guidedBoot: { lessonLayoutMode: false } as UseGuidedLessonBootResult,
          chrome: { isFullscreen: false, isMuted: true },
          invalidateLocalRuns: vi.fn(),
        });
      },
      { initialProps: { match: initial } },
    );

    rerender({ match: withScore(initial, 'you', 5) });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current.scoreToast).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.scoreToast).toMatchObject({
      eventId: 1,
      kind: 'score',
      tone: 'you',
      points: 5,
      visible: true,
    });

    const secondScore = withScore(initial, 'you', 10);
    rerender({ match: secondScore });
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.scoreToast).toMatchObject({
      eventId: 2,
      points: 5,
      visible: true,
    });

    // The first score's original hide deadline must not dismiss the second.
    act(() => vi.advanceTimersByTime(651));
    expect(result.current.scoreToast).toMatchObject({
      eventId: 2,
      visible: true,
    });
  });

  it('does not announce a restored score when the attempt identity changes', () => {
    const initial = createBotMatch(60, 7);
    const restored = withScore(initial, 'bot', 15);
    const { result, rerender } = renderHook(
      ({ match, attemptId }: { match: BotMatchState; attemptId: string }) => {
        const refs = useBotMatchRefs();
        return useMatchPresentation({
          bootstrap: {
            match,
            mode: 'daily-fritz',
            opponentLabel: 'Fritz',
            isDailyFritzMode: true,
            dailyFritzPackage: dailyPackage(attemptId),
            preGameDrawActive: false,
          } as UseBotMatchBootstrapResult,
          refs,
          guidedBoot: { lessonLayoutMode: false } as UseGuidedLessonBootResult,
          chrome: { isFullscreen: false, isMuted: true },
          invalidateLocalRuns: vi.fn(),
        });
      },
      { initialProps: { match: initial, attemptId: 'attempt-1' } },
    );

    rerender({ match: restored, attemptId: 'attempt-2' });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.scoreToast).toBeNull();
  });
});
