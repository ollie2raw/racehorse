// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotMatchState } from '../match/runtime/botEngine.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/reviewContracts';
import type { ReviewSnapshotRecorder } from './ReviewSnapshotRecorder.ts';
import { logger } from '../../utils/logger.ts';
import { usePostGamePivotalReview, type UsePostGamePivotalReviewParams } from './usePostGamePivotalReview.ts';

const analyzeMoveLogDeferred = vi.fn();
vi.mock('../../analyzer/moveAnalyzer.ts', () => ({
  analyzeMoveLogDeferred: (...args: unknown[]) => analyzeMoveLogDeferred(...args),
}));
vi.mock('../../training/pivotalReview/pivotalTurnSelector.ts', () => ({
  selectPivotalTurnsFromAnalysis: vi.fn(() => null),
}));
const saveReviewSnapshots = vi.fn();
vi.mock('./reviewSnapshotStorage.ts', () => ({
  saveReviewSnapshots: (...args: unknown[]) => saveReviewSnapshots(...args),
}));

const gameOverMatch = (): BotMatchState => ({ ...createBotMatch(), gameOver: true });
const moveLog: MoveEntry[] = [{ player: 'you' } as MoveEntry];

const defaultParams: UsePostGamePivotalReviewParams = {
  match: gameOverMatch(),
  moveLog,
  botPostGameReviewEligible: true,
  fritzTier: 'standard',
  winningScore: 60,
  showPostGameOverlays: true,
  reviewCaptureEnabled: true,
};

const render = (overrides: Partial<UsePostGamePivotalReviewParams> = {}) =>
  renderHook(() => usePostGamePivotalReview({ ...defaultParams, ...overrides }));

function makeRecorderWithSnapshots(snapshots: ReviewPositionSnapshotV2[]): ReviewSnapshotRecorder {
  return { getSnapshots: () => snapshots } as unknown as ReviewSnapshotRecorder;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  analyzeMoveLogDeferred.mockReset();
  saveReviewSnapshots.mockReset();
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

describe('usePostGamePivotalReview — A6 persistence gate (found during Phase-A live verification)', () => {
  it('persists captured snapshots at game-over even when the review UI is not eligible (non-admin), as long as capture was enabled for this session', async () => {
    const snapshots = [{ identifiers: { decisionId: 'fake-1' } }] as unknown as ReviewPositionSnapshotV2[];
    const recorder = makeRecorderWithSnapshots(snapshots);

    render({
      botPostGameReviewEligible: false,
      reviewCaptureEnabled: true,
      reviewSnapshotRecorder: recorder,
    });

    await waitFor(() => expect(saveReviewSnapshots).toHaveBeenCalledWith(snapshots));
  });

  it('does not persist when capture was not enabled for this session (e.g. Daily Fritz, Ghost, Journey trial)', async () => {
    const snapshots = [{ identifiers: { decisionId: 'fake-1' } }] as unknown as ReviewPositionSnapshotV2[];
    const recorder = makeRecorderWithSnapshots(snapshots);

    const { result } = render({
      botPostGameReviewEligible: false,
      reviewCaptureEnabled: false,
      reviewSnapshotRecorder: recorder,
    });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(saveReviewSnapshots).not.toHaveBeenCalled();
  });

  it('still persists when the review UI is eligible (admin) — the persistence gate is additive, not a replacement', async () => {
    const snapshots = [{ identifiers: { decisionId: 'fake-1' } }] as unknown as ReviewPositionSnapshotV2[];
    const recorder = makeRecorderWithSnapshots(snapshots);

    render({
      botPostGameReviewEligible: true,
      reviewCaptureEnabled: true,
      reviewSnapshotRecorder: recorder,
    });

    await waitFor(() => expect(saveReviewSnapshots).toHaveBeenCalledWith(snapshots));
  });

  it('does not persist when there is no recorder (no capture happened)', async () => {
    const { result } = render({
      botPostGameReviewEligible: false,
      reviewCaptureEnabled: true,
      reviewSnapshotRecorder: undefined,
    });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(saveReviewSnapshots).not.toHaveBeenCalled();
  });

  it('does not touch the existing botPostGameReviewEligible-gated analysis behavior', async () => {
    const analysis = { fake: true } as never;
    analyzeMoveLogDeferred.mockResolvedValueOnce(analysis);

    const { result } = render({ botPostGameReviewEligible: false, reviewCaptureEnabled: true });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.postGameAnalysis).toBeNull();
    expect(analyzeMoveLogDeferred).not.toHaveBeenCalled();
  });
});
