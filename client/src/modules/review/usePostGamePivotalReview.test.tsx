// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { createBotMatch, type BotMatchState } from '../match/runtime/botEngine.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/reviewContracts';
import { REVIEW_FIXTURE_CORPUS } from '../../../../packages/game-core/src/reviewFixtureCorpus';
import type { ReviewSnapshotRecorder } from './ReviewSnapshotRecorder.ts';
import type { ReviewBatchState } from './useReviewWorkerBatch.ts';
import { logger } from '../../utils/logger.ts';
import { LEGACY_ANALYSIS_DISCLOSURE } from '../../analyzer/moveAnalyzer.ts';
import { usePostGamePivotalReview, type UsePostGamePivotalReviewParams } from './usePostGamePivotalReview.ts';

const analyzeMoveLogDeferred = vi.fn();
vi.mock('../../analyzer/moveAnalyzer.ts', async () => {
  // deriveReviewEvidence/LEGACY_ANALYSIS_DISCLOSURE use the real
  // implementation -- the evidence-derivation tests below assert on its
  // actual behavior, not a stub. Only analyzeMoveLogDeferred is faked, same
  // as before.
  const actual = await vi.importActual<typeof import('../../analyzer/moveAnalyzer.ts')>(
    '../../analyzer/moveAnalyzer.ts',
  );
  return {
    ...actual,
    analyzeMoveLogDeferred: (...args: unknown[]) => analyzeMoveLogDeferred(...args),
  };
});
vi.mock('../../training/pivotalReview/pivotalTurnSelector.ts', () => ({
  selectPivotalTurnsFromAnalysis: vi.fn(() => null),
}));
const saveReviewSnapshots = vi.fn();
vi.mock('./reviewSnapshotStorage.ts', () => ({
  saveReviewSnapshots: (...args: unknown[]) => saveReviewSnapshots(...args),
}));
const postGameReviewWriteMock = vi.fn();
vi.mock('./postGameReviewWrite.ts', () => ({
  postGameReviewWrite: (...args: unknown[]) => postGameReviewWriteMock(...args),
}));
const enqueueServerReviewCompletionMock = vi.fn();
const pollServerReviewCompletionMock = vi.fn();
vi.mock('./reviewCompletionClient.ts', () => ({
  enqueueServerReviewCompletion: (...args: unknown[]) => enqueueServerReviewCompletionMock(...args),
  pollServerReviewCompletion: (...args: unknown[]) => pollServerReviewCompletionMock(...args),
}));
vi.mock('../../lib/gameServerUrl.ts', () => ({ resolveGameServerUrl: () => 'https://server.test' }));

// Real Worker construction isn't available in jsdom -- mocked the same way
// analyzeMoveLogDeferred already is, so the accuracyModel wiring tests below
// can control resultsByDecisionId/done deterministically instead of racing
// a real worker.
const useReviewWorkerBatchMock = vi.fn<(...args: unknown[]) => ReviewBatchState & { cancel: () => void }>();
vi.mock('./useReviewWorkerBatch.ts', () => ({
  useReviewWorkerBatch: (...args: unknown[]) => useReviewWorkerBatchMock(...args),
}));

const NOT_DONE_BATCH: ReviewBatchState & { cancel: () => void } = {
  resultsByDecisionId: new Map(),
  errorsByDecisionId: new Map(),
  pendingDecisionIds: new Set(),
  done: false,
  cancel: vi.fn(),
};

const EXACT: ReviewEvaluationV1['evidence'] = { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' };
const HEURISTIC: ReviewEvaluationV1['evidence'] = { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' };

function scorableEvaluation(id: string, moveLoss: number, evidence = EXACT): ReviewEvaluationV1 {
  const best = { action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'left' }, value: { expectedPointDifferential: moveLoss, winProbability: null }, immediatePoints: 0, principalVariation: [] } as const;
  const played = { action: { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' }, value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints: 0, principalVariation: [] } as const;
  return {
    evaluationVersion: 1,
    snapshotId: id,
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence,
    played,
    best,
    candidates: [played, best],
    loss: { expectedPointDifferential: moveLoss, winProbability: null },
    search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

const gameOverMatch = (): BotMatchState => ({ ...createBotMatch(), gameOver: true });
const moveLog: MoveEntry[] = [{ player: 'you' } as MoveEntry];

const defaultParams: UsePostGamePivotalReviewParams = {
  match: gameOverMatch(),
  moveLog,
  botPostGameReviewEligible: true,
  reviewPersistenceEnabled: false,
  fritzTier: 'standard',
  winningScore: 60,
  showPostGameOverlays: true,
  reviewCaptureEnabled: true,
  sourceMatchId: 'match-uuid-1',
};

const render = (overrides: Partial<UsePostGamePivotalReviewParams> = {}) =>
  renderHook(() => usePostGamePivotalReview({ ...defaultParams, ...overrides }));

function makeRecorderWithSnapshots(snapshots: ReviewPositionSnapshotV2[]): ReviewSnapshotRecorder {
  return { getSnapshots: () => snapshots } as unknown as ReviewSnapshotRecorder;
}

function reviewSnapshotForDecision(decisionId: string): ReviewPositionSnapshotV2 {
  return {
    identifiers: { decisionId, actorId: 'you', actionNumber: Number(decisionId.split('-').at(-1)) || 1 },
    preAction: { actorHand: [], opponentTileCount: 0 },
    integrity: { authorityPreStateDigest: `pre-${decisionId}`, authorityPostStateDigest: `post-${decisionId}` },
  } as unknown as ReviewPositionSnapshotV2;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  analyzeMoveLogDeferred.mockReset();
  saveReviewSnapshots.mockReset();
  useReviewWorkerBatchMock.mockReset();
  useReviewWorkerBatchMock.mockReturnValue(NOT_DONE_BATCH);
  postGameReviewWriteMock.mockReset();
  enqueueServerReviewCompletionMock.mockReset();
  pollServerReviewCompletionMock.mockReset();
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

describe('usePostGamePivotalReview — durable Play vs Fritz authority', () => {
  it('enqueues authenticated player snapshots and does not dispatch the browser completion worker', async () => {
    const snapshot = {
      identifiers: { decisionId: 'fresh-you-1', actorId: 'you' },
      actualAction: { kind: 'pass' },
      integrity: { authorityPostStateDigest: 'digest-post-1' },
    } as unknown as ReviewPositionSnapshotV2;
    const recorder = {
      getSnapshots: () => [snapshot],
      getCaptureFailures: () => [],
    } as unknown as ReviewSnapshotRecorder;
    analyzeMoveLogDeferred.mockResolvedValueOnce({ analyzedMoves: [] } as never);
    enqueueServerReviewCompletionMock.mockResolvedValueOnce({
      jobId: 'durable-job-1',
      status: 'pending',
      progress: { total: 1, forced: 0, scored: 0, remaining: 1 },
    });
    pollServerReviewCompletionMock.mockResolvedValue(null);

    const { unmount } = render({
      reviewPersistenceEnabled: true,
      accessToken: 'session-token',
      reviewSnapshotRecorder: recorder,
    });

    await waitFor(() => expect(enqueueServerReviewCompletionMock).toHaveBeenCalledTimes(1));
    const request = enqueueServerReviewCompletionMock.mock.calls[0]![0] as {
      authHeader: string;
      snapshots: readonly ReviewPositionSnapshotV2[];
      expectedDecisionIds: readonly string[];
    };
    expect(request.authHeader).toBe('Bearer session-token');
    expect(request.snapshots.map((item) => item.identifiers.decisionId)).toEqual(['fresh-you-1']);
    expect(request.expectedDecisionIds).toEqual(['fresh-you-1']);
    expect(useReviewWorkerBatchMock.mock.calls.at(-1)?.[0]).toEqual([]);
    unmount();
  });

  it('retries durable job creation after a temporary HTTP failure without enabling local completion', async () => {
    const recorder = makeRecorderWithSnapshots([reviewSnapshotForDecision('retryable-job-decision')]);
    analyzeMoveLogDeferred.mockResolvedValueOnce({ analyzedMoves: [] } as never);
    enqueueServerReviewCompletionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        jobId: 'durable-retry-job', status: 'pending',
        progress: { total: 1, forced: 0, scored: 0, remaining: 1 },
      });
    pollServerReviewCompletionMock.mockResolvedValue(null);

    vi.useFakeTimers();
    const { result, unmount } = render({
      reviewPersistenceEnabled: true,
      accessToken: 'session-token',
      reviewSnapshotRecorder: recorder,
    });
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(enqueueServerReviewCompletionMock).toHaveBeenCalledTimes(1);
      expect(useReviewWorkerBatchMock.mock.calls.at(-1)?.[0]).toEqual([]);
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(enqueueServerReviewCompletionMock).toHaveBeenCalledTimes(2);
      expect(useReviewWorkerBatchMock.mock.calls.at(-1)?.[0]).toEqual([]);
      expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('feeds partial durable checkpoints to Game Review and keeps final accuracy gated', async () => {
    const snapshots = [reviewSnapshotForDecision('fresh-1'), reviewSnapshotForDecision('fresh-2')];
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce({ analyzedMoves: [], hands: [] } as never);
    enqueueServerReviewCompletionMock.mockResolvedValueOnce({
      jobId: 'durable-progress-job', status: 'pending',
      progress: { total: 2, forced: 0, scored: 0, remaining: 2 },
    });
    const partialEvaluation = {
      ...scorableEvaluation('fresh-1', 1, EXACT),
      evaluationProvenance: { phase: 'completion', lifecycle: 'SCORED', positionHash: 'position-1' },
    } as ReviewEvaluationV1;
    pollServerReviewCompletionMock.mockResolvedValueOnce({
      complete: false,
      status: 'pending',
      progress: { total: 2, forced: 0, scored: 1, remaining: 1 },
      decisions: [
        { decisionId: 'fresh-1', lifecycle: 'SCORED', positionHash: 'position-1' },
        { decisionId: 'fresh-2', lifecycle: 'PENDING', positionHash: 'position-2' },
      ],
      evaluations: [partialEvaluation],
    });

    const { result } = render({
      reviewPersistenceEnabled: true,
      accessToken: 'session-token',
      reviewSnapshotRecorder: recorder,
    });

    await waitFor(() => expect(result.current.reviewWorkerBatch.resultsByDecisionId.size).toBe(1));
    expect(result.current.reviewWorkerBatch.pendingDecisionIds.has('fresh-2')).toBe(true);
    expect(result.current.reviewWorkerBatch.done).toBe(false);
    expect(result.current.accuracyModelPending).toBe(true);
    expect(useReviewWorkerBatchMock.mock.calls.at(-1)?.[0]).toEqual([]);
    expect(postGameReviewWriteMock).not.toHaveBeenCalled();
    act(() => result.current.openReviewGameFromPrompt());
    await waitFor(() => expect(result.current.analyzerOpen).toBe(true));
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

  it('keeps local analysis available when persistence is outside the server cohort', async () => {
    const analysis = { fake: true } as never;
    analyzeMoveLogDeferred.mockResolvedValueOnce(analysis);

    const { result } = render({
      botPostGameReviewEligible: true,
      reviewPersistenceEnabled: false,
      reviewCaptureEnabled: true,
    });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.postGameAnalysis).toBe(analysis);
    expect(analyzeMoveLogDeferred).toHaveBeenCalledTimes(1);
    expect(postGameReviewWriteMock).not.toHaveBeenCalled();
  });
});

describe('usePostGamePivotalReview — accuracyModel wiring (C4 UI follow-up)', () => {
  const baseAnalysis = { fake: true, accuracy: 42, grade: 'B' } as never;

  it('no captured snapshots -- accuracyModelPending is false and accuracyModel stays undefined (legacy display, no infinite loading)', async () => {
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);

    const { result } = render();

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.accuracyModelPending).toBe(false);
    expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
  });

  it('snapshots present but the worker batch has not finished -- accuracyModelPending is true, accuracyModel stays undefined until done', async () => {
    const snapshots = [reviewSnapshotForDecision('scorable-0')];
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    useReviewWorkerBatchMock.mockReturnValue(NOT_DONE_BATCH);

    const { result } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.accuracyModelPending).toBe(true);
    expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
  });

  it('reviewWorkerBatch.done flips true but the dynamic import has not resolved yet -- accuracyModelPending must still be true (regression: it must NOT derive from `done` alone, or the legacy number flashes before the swap)', async () => {
    const snapshots = [reviewSnapshotForDecision('scorable-0')];
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    useReviewWorkerBatchMock.mockReturnValue(NOT_DONE_BATCH);

    const { result, rerender } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.accuracyModelPending).toBe(true);

    // Flip the batch to done. The hook's effect will synchronously call
    // setAccuracyModelPending(true) (a no-op, already true) and kick off
    // `import('../../analyzer/gameAccuracyModel.ts').then(...)` -- a real
    // dynamic import, which resolves on a LATER microtask than this
    // synchronous render. `rerender()` itself is synchronous (not
    // awaited), so nothing has had a chance to reach that microtask yet
    // when the assertions below run.
    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
    resultsByDecisionId.set('scorable-0', scorableEvaluation('scorable-0', 1, EXACT));
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });
    rerender();

    // The exact bug this test guards against: done is now true, but the
    // dynamic import's .then() has not fired -- accuracyModel must still
    // be undefined AND accuracyModelPending must still be true right here,
    // not just "eventually consistent" after a waitFor.
    expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
    expect(result.current.accuracyModelPending).toBe(true);

    // It does resolve shortly after -- confirms this isn't stuck forever.
    await waitFor(() => expect(result.current.accuracyModelPending).toBe(false));
    expect(result.current.postGameAnalysis?.accuracyModel).toBeDefined();
  });

  it('worker batch done with all exact/search results -- accuracyModel resolves as complete', async () => {
    const snapshots = Array.from({ length: 20 }, (_, i) => reviewSnapshotForDecision(`scorable-${i}`));
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
    for (let i = 0; i < 20; i += 1) resultsByDecisionId.set(`scorable-${i}`, scorableEvaluation(`scorable-${i}`, 1, EXACT));
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });

    const { result } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    await waitFor(() => expect(result.current.postGameAnalysis?.accuracyModel).toBeDefined());
    const accuracyModel = result.current.postGameAnalysis?.accuracyModel;
    expect(accuracyModel?.accuracy).not.toBeNull();
    expect(accuracyModel?.status).toBe('complete');
    expect(result.current.postGameAnalysis?.accuracy).toBe(42);
    expect(result.current.postGameAnalysis?.grade).toBe('B');
    expect(result.current.postGameAnalysis?.evidence).toEqual({
      source: 'oracle',
      confidence: 'high',
      displayLabel: 'Review Engine analysis',
      reason: 'oracle-coverage-full',
    });
  });

  it('worker batch with residual heuristics and stub snapshots stays Analyzing (finalization gate)', async () => {
    const snapshots = Array.from({ length: 60 }, (_, i) => reviewSnapshotForDecision(`scorable-${i}`));
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
    for (let i = 0; i < 60; i += 1) resultsByDecisionId.set(`scorable-${i}`, scorableEvaluation(`scorable-${i}`, 1, EXACT));
    for (let i = 0; i < 40; i += 1) resultsByDecisionId.set(`heuristic-${i}`, scorableEvaluation(`heuristic-${i}`, 1, HEURISTIC));
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });

    const { result } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    // Finalization gate: incomplete escalation must not publish accuracyModel.
    await waitFor(() => expect(result.current.accuracyModelPending).toBe(true));
    expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
  });

  it('worker batch below coverage floor with residual heuristics stays Analyzing (finalization gate)', async () => {
    const snapshots = Array.from({ length: 20 }, (_, i) => reviewSnapshotForDecision(`scorable-${i}`));
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
    resultsByDecisionId.set('scorable-0', scorableEvaluation('scorable-0', 1, EXACT));
    for (let i = 0; i < 20; i += 1) resultsByDecisionId.set(`heuristic-${i}`, scorableEvaluation(`heuristic-${i}`, 1, HEURISTIC));
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });

    const { result } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    await waitFor(() => expect(result.current.accuracyModelPending).toBe(true));
    expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
  });
});

describe('usePostGamePivotalReview — evidence banner reflects real oracle coverage, not a hardcoded legacy constant', () => {
  const baseAnalysis = { fake: true, accuracy: 42, grade: 'B', evidence: LEGACY_ANALYSIS_DISCLOSURE } as never;

  it('fully-covered oracle match (status: complete, zero heuristic decisions) -- no longer shows the legacy banner', async () => {
    const snapshots = Array.from({ length: 20 }, (_, i) => reviewSnapshotForDecision(`scorable-${i}`));
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
    for (let i = 0; i < 20; i += 1) resultsByDecisionId.set(`scorable-${i}`, scorableEvaluation(`scorable-${i}`, 1, EXACT));
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });

    const { result } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.postGameAnalysis?.accuracyModel).toBeDefined());
    expect(result.current.postGameAnalysis?.accuracyModel?.status).toBe('complete');
    expect(result.current.postGameAnalysis?.evidence).toEqual({
      source: 'oracle',
      confidence: 'high',
      displayLabel: 'Review Engine analysis',
      reason: 'oracle-coverage-full',
    });
    expect(result.current.postGameAnalysis?.evidence).not.toEqual(LEGACY_ANALYSIS_DISCLOSURE);
  });

  it('no oracle data at all (zero snapshots, never resolved) -- the legacy disclosure still correctly appears', async () => {
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    useReviewWorkerBatchMock.mockReturnValue(NOT_DONE_BATCH);

    const { result } = render();

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.accuracyModelPending).toBe(false);
    expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
    expect(result.current.postGameAnalysis?.evidence).toEqual(LEGACY_ANALYSIS_DISCLOSURE);
  });

  it('a true pre-oracle legacy game (no reviewSnapshotRecorder at all) -- the legacy disclosure still correctly appears', async () => {
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    useReviewWorkerBatchMock.mockReturnValue(NOT_DONE_BATCH);

    const { result } = render({ reviewSnapshotRecorder: undefined });

    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.postGameAnalysis?.accuracyModel).toBeUndefined();
    expect(result.current.postGameAnalysis?.evidence).toEqual(LEGACY_ANALYSIS_DISCLOSURE);
  });
});

describe('usePostGamePivotalReview — browser path cannot finalize durable artifacts', () => {
  const baseAnalysis = { fake: true, accuracy: 42, grade: 'B' } as never;

  function snapshotWithDigest(digest: string): ReviewPositionSnapshotV2 {
    const base = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    return {
      ...base,
      identifiers: { decisionId: digest, actorId: 'you', actionNumber: Number(digest.match(/\d+/)?.[0] ?? 1) },
      integrity: { ...base.integrity, authorityPreStateDigest: `pre-${digest}`, authorityPostStateDigest: digest },
    } as unknown as ReviewPositionSnapshotV2;
  }

  function buildScorableBatch(): { resultsByDecisionId: Map<string, ReviewEvaluationV1> } {
    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
    for (let i = 0; i < 60; i += 1) resultsByDecisionId.set(`scorable-${i}`, scorableEvaluation(`scorable-${i}`, 1, EXACT));
    return { resultsByDecisionId };
  }

  it('local browser completion may calculate provisional accuracy but cannot persist a final review artifact', async () => {
    const snapshots = Array.from({ length: 60 }, (_, index) => snapshotWithDigest(`scorable-${index}`));
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    const { resultsByDecisionId } = buildScorableBatch();
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });

    const { result } = render({ reviewSnapshotRecorder: recorder, sourceMatchId: 'match-uuid-1' });

    await waitFor(() => expect(result.current.postGameAnalysis?.accuracyModel).toBeDefined());
    await waitFor(() => expect(result.current.postGameAnalysis?.accuracyModel).toBeDefined());
    expect(postGameReviewWriteMock).not.toHaveBeenCalled();
  });

  it('does not attempt a local final-artifact write even when local completion resolves', async () => {
    const snapshots = Array.from({ length: 60 }, (_, index) => snapshotWithDigest(`scorable-${index}`));
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    const { resultsByDecisionId } = buildScorableBatch();
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });
    const { result } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.accuracyModelPending).toBe(false));
    await waitFor(() => expect(result.current.postGameAnalysis?.accuracyModel).toBeDefined());
    expect(postGameReviewWriteMock).not.toHaveBeenCalled();
  });

  it('E1: does not fire the write when there are zero resolved evaluations (nothing real to persist)', async () => {
    const snapshots = [snapshotWithDigest('d1')];
    const recorder = makeRecorderWithSnapshots(snapshots);
    analyzeMoveLogDeferred.mockResolvedValueOnce(baseAnalysis);
    useReviewWorkerBatchMock.mockReturnValue({
      resultsByDecisionId: new Map(),
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
      cancel: vi.fn(),
    });

    const { result } = render({ reviewSnapshotRecorder: recorder });

    await waitFor(() => expect(result.current.accuracyModelPending).toBe(false));
    expect(postGameReviewWriteMock).not.toHaveBeenCalled();
  });
});
