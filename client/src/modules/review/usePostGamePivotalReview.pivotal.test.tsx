// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { createBotMatch } from '../match/runtime/botEngine';
import { usePostGamePivotalReview } from './usePostGamePivotalReview';
import type { ReviewSnapshotRecorder } from './ReviewSnapshotRecorder';
import { matchFixture } from '../../training/pivotalReview/pivotalReviewTestFixtures';

const controls = vi.hoisted(() => ({ enabled: true }));
vi.mock('../match/types.ts', () => ({ get PIVOTAL_REVIEW_WIZARD_ENABLED() { return controls.enabled; } }));
const analyze = vi.fn();
vi.mock('../../analyzer/moveAnalyzer.ts', () => ({ analyzeMoveLogDeferred: (...args: unknown[]) => analyze(...args) }));
const batch = vi.fn();
vi.mock('./useReviewWorkerBatch', () => ({ useReviewWorkerBatch: () => batch() }));
vi.mock('./postGameReviewWrite.ts', () => ({ postGameReviewWrite: vi.fn() }));
vi.mock('./reviewSnapshotStorage', () => ({ saveReviewSnapshots: vi.fn() }));
vi.mock('./logReviewWorkerBatchDiagnostics', () => ({ logReviewWorkerBatchDiagnostics: vi.fn() }));

beforeEach(() => { controls.enabled = true; vi.clearAllMocks(); });

function setup() {
  const fixture = matchFixture([1, 30, 20, 10]);
  analyze.mockResolvedValue(fixture.analysis);
  const state = {
    resultsByDecisionId: fixture.evaluationsByDecisionId,
    errorsByDecisionId: new Map(), pendingDecisionIds: new Set<string>(),
    done: false, cancel: vi.fn(),
  };
  batch.mockImplementation(() => state);
  const snapshots = fixture.moveLog.map((entry) => ({
    identifiers: { actionNumber: entry.moveNumber, decisionId: `decision-${entry.moveNumber}`, actorId: 'you' },
    // Matches matchFixture's moveLog entries (action: 'place', tile [1,1],
    // position 'left') -- correlateSnapshotsToMoveLog.ts's content
    // cross-check (2026-09-19 correctness audit) requires this to agree
    // with the moveLog entry, not just the actionNumber/moveNumber counter.
    actualAction: { kind: 'play', tile: { low: 1, high: 1 }, position: 'left' },
    outcome: { authorityPostStateDigest: `digest-${entry.moveNumber}` },
  } as unknown as ReviewPositionSnapshotV2));
  const params = {
    match: { ...createBotMatch(), gameOver: true }, moveLog: fixture.moveLog,
    botPostGameReviewEligible: true, fritzTier: 'standard' as const, winningScore: 60,
    showPostGameOverlays: true, reviewCaptureEnabled: true, sourceMatchId: 'live-match',
    reviewSnapshotRecorder: { getSnapshots: () => snapshots } as unknown as ReviewSnapshotRecorder,
  };
  return { params, state };
}

describe('current-session pivotal integration', () => {
  it('waits for the complete batch, joins live evaluations, and clears selection on the next game', async () => {
    const { params, state } = setup();
    const { result, rerender } = renderHook((input) => usePostGamePivotalReview(input), { initialProps: params });
    await waitFor(() => expect(result.current.postGameAnalysisPending).toBe(false));
    expect(result.current.pivotalSelection).toBeNull();
    state.done = true;
    rerender(params);
    await waitFor(() => expect(result.current.pivotalSelection?.candidates.map((c) => c.moveNumber)).toEqual([2, 3, 4]));
    rerender({ ...params, match: { ...params.match, gameOver: false } });
    await waitFor(() => expect(result.current.pivotalSelection).toBeNull());
  });

  it('keeps the disabled wizard inert even with a completed batch', async () => {
    controls.enabled = false;
    const { params, state } = setup();
    state.done = true;
    const { result } = renderHook(() => usePostGamePivotalReview(params));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(result.current.pivotalSelection).toBeNull();
    expect(result.current.pivotalReviewOpen).toBe(false);
  });
});
