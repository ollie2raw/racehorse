// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotMatchState } from '../match/runtime/botEngine.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import { logger } from '../../utils/logger.ts';
import { usePostGamePivotalReview } from './usePostGamePivotalReview.ts';

const analyzeMoveLogDeferred = vi.fn();
vi.mock('../../analyzer/moveAnalyzer.ts', () => ({
  analyzeMoveLogDeferred: (...args: unknown[]) => analyzeMoveLogDeferred(...args),
}));
vi.mock('../../training/pivotalReview/pivotalTurnSelector.ts', () => ({
  selectPivotalTurnsFromAnalysis: vi.fn(() => null),
}));

const gameOverMatch = (): BotMatchState => ({ ...createBotMatch(), gameOver: true });
const moveLog: MoveEntry[] = [{ player: 'you' } as MoveEntry];

const render = () =>
  renderHook(() =>
    usePostGamePivotalReview({
      match: gameOverMatch(),
      moveLog,
      botPostGameReviewEligible: true,
      fritzTier: 'standard',
      winningScore: 60,
      showPostGameOverlays: true,
    }),
  );

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  analyzeMoveLogDeferred.mockReset();
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('usePostGamePivotalReview — deferred analysis failure (F19)', () => {
  it('logs a warn with the error and still clears the pending flag when the analyzer rejects', async () => {
    analyzeMoveLogDeferred.mockRejectedValueOnce(new Error('analyzer chunk 500'));

    const { result } = render();
    expect(result.current.postGameAnalysisPending).toBe(true);

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));

    expect(result.current.postGameAnalysis).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [context, message, extra] = warnSpy.mock.calls[0]!;
    expect(context).toBe('usePostGamePivotalReview');
    expect(message).toMatch(/review-your-game prompt will not appear/i);
    expect(extra).toEqual({ error: 'analyzer chunk 500' });
  });

  it('does not warn and populates the analysis on the happy path', async () => {
    const analysis = { fake: true } as never;
    analyzeMoveLogDeferred.mockResolvedValueOnce(analysis);

    const { result } = render();

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));

    expect(result.current.postGameAnalysis).toBe(analysis);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
