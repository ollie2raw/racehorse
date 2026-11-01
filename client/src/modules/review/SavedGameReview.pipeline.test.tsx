// @vitest-environment jsdom
/**
 * End to end, with only the network stubbed: a saved game record -> rebuilt with the real engine and recorder -> the real
 * review hook (the same one the live match runs) -> the real analyzer and accuracy model -> the summary prompt -> the
 * finished review saved. If the rebuilt inputs did not satisfy the review pipeline, this is where it would show.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { isForcedDecision } from '@racehorse/game-core/review';
import { completeReviewEvaluations, evaluateReviewPosition } from '@racehorse/review-engine';
import { playSeededGame } from '../../../../packages/review-engine/src/__tests__/support/seededSelfPlay';
import { rebuildGameFromRecord, type SavedGameRecord } from './rebuildGameFromRecord';

const { enqueue, poll, writeReview, loadSavedGame } = vi.hoisted(() => ({
  enqueue: vi.fn(), poll: vi.fn(), writeReview: vi.fn(), loadSavedGame: vi.fn(),
}));
vi.mock('./reviewCompletionClient.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reviewCompletionClient.ts')>()),
  enqueueServerReviewCompletion: enqueue,
  pollServerReviewCompletion: poll,
}));
vi.mock('./postGameReviewWrite.ts', () => ({ postGameReviewWrite: writeReview }));
vi.mock('./reviewFunnelClient.ts', () => ({ sendReviewFunnelEvent: vi.fn() }));
vi.mock('./reviewSnapshotStorage.ts', () => ({ saveReviewSnapshots: vi.fn() }));
vi.mock('../../lib/gameServerUrl.ts', () => ({ resolveGameServerUrl: () => 'https://server.test' }));
vi.mock('./savedGames', () => ({ loadSavedGame }));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'player@example.com' }, accessToken: 'token-1' }),
}));
vi.mock('../../analyzer/GameReviewer', () => ({
  default: ({ open, analysis }: { open: boolean; analysis: { analyzedMoves: unknown[] } }) =>
    open ? <div role="dialog" aria-label="reviewer">{analysis.analyzedMoves.length} moves reviewed</div> : null,
}));

import SavedGameReview from './SavedGameReview';

/** The escalation takes seconds, and both tests send the same game: do it once. */
const completed = new Map<string, Map<string, ReviewEvaluationV1>>();

const BUDGET = { maxNodes: 20_000, maxHiddenStateSamples: 6, maxPlyDepth: 2, seed: 'saved-game-pipeline', maxWallClockMs: 60_000 } as const;

function savedRecord(): SavedGameRecord {
  const played = playSeededGame({ seed: 'pipeline-a', dealSize: 7, winningScore: 25, matchStarter: 'you' });
  return {
    sourceMatchId: 'src-pipeline-a',
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 25,
    matchStarter: 'you',
    dealSeed: 'pipeline-a',
    result: { you: played.playerScore, opponent: played.opponentScore, winner: played.playerScore > played.opponentScore ? 'you' : 'opponent' },
    moves: played.moves,
    verification: 'replay_verified',
    playedAt: null,
  };
}

beforeEach(() => {
  const record = savedRecord();
  const rebuilt = rebuildGameFromRecord(record);
  if (!rebuilt.ok) throw new Error(rebuilt.detail);
  loadSavedGame.mockResolvedValue({ ok: true, record, game: rebuilt.game });

  // The server's job, stood in for by the real engine over exactly the snapshots the client sent: a first pass, then the
  // same tier escalation the server runs until every decision is scored or forced. Without escalation the evaluations
  // are heuristic estimates, which the pipeline correctly refuses to present as a finished, graded review.
  enqueue.mockImplementation(async (request: { snapshots: Parameters<typeof evaluateReviewPosition>[0][] }) => {
    const key = request.snapshots.map((snapshot) => snapshot.identifiers.decisionId).join('|');
    let evaluations = completed.get(key);
    if (!evaluations) {
      const live = new Map(request.snapshots.map((snapshot) => [snapshot.identifiers.decisionId, evaluateReviewPosition(snapshot, BUDGET, 0.02, () => 0)]));
      const done = completeReviewEvaluations({ snapshots: request.snapshots, liveResultsByDecisionId: live, startTier: 2, maxTier: 4 });
      expect(done.complete).toBe(true);
      evaluations = new Map<string, ReviewEvaluationV1>(done.resultsByDecisionId);
      completed.set(key, evaluations);
    }
    poll.mockResolvedValue({
      complete: true,
      status: 'complete',
      unavailable: false,
      progress: { total: evaluations.size, forced: 0, scored: evaluations.size, remaining: 0 },
      evaluations: [...evaluations.values()],
      decisions: [...evaluations.entries()].map(([decisionId, evaluation]) => ({
        decisionId,
        lifecycle: isForcedDecision(evaluation.candidates) ? 'FORCED' : 'SCORED',
        positionHash: decisionId,
      })),
    });
    return { jobId: 'job-1', status: 'pending', progress: { total: evaluations.size, forced: 0, scored: 0, remaining: evaluations.size } };
  });
});
afterEach(() => vi.clearAllMocks());

describe('a saved game, reviewed through the real pipeline', () => {
  it('sends the server exactly the player decisions the rebuild produced, and saves the finished review', async () => {
    const onClose = vi.fn();
    render(<SavedGameReview sourceMatchId="src-pipeline-a" onClose={onClose} />);

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const request = enqueue.mock.calls[0]![0] as {
      sourceMatchId: string;
      snapshots: Array<{ identifiers: { decisionId: string; actorId: string } }>;
      expectedDecisionIds: string[];
      captureFailures: unknown[];
    };
    expect(request.sourceMatchId).toBe('src-pipeline-a');
    expect(request.snapshots.length).toBeGreaterThan(5);
    expect(request.snapshots.every((s) => s.identifiers.actorId === 'you')).toBe(true);
    expect(request.snapshots.every((s) => s.identifiers.decisionId.startsWith('src-pipeline-a:you:'))).toBe(true);
    // Same decisions (the hook orders them by turn sequence, so compare as sets).
    expect([...request.expectedDecisionIds].sort()).toEqual(request.snapshots.map((s) => s.identifiers.decisionId).sort());
    expect(request.captureFailures).toEqual([]);

    // The finished review is saved, so the next open from History is instant.
    await waitFor(() => expect(writeReview).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    const [body] = writeReview.mock.calls[0]! as [{ mode: string; sourceMatchId: string; evaluations: unknown[]; replayArtifact: unknown }];
    expect(body).toMatchObject({ mode: 'pvf', sourceMatchId: 'src-pipeline-a' });
    expect(body.evaluations).toHaveLength(request.snapshots.length);
    expect(body.replayArtifact).toBeTruthy();
  }, 60_000);

  it('shows the summary with the final accuracy, then opens the full review', async () => {
    render(<SavedGameReview sourceMatchId="src-pipeline-a" onClose={vi.fn()} />);
    const record = savedRecord();
    expect(await screen.findByText(record.result.winner === 'you' ? 'Victory' : 'Defeat', undefined, { timeout: 15_000 })).toBeTruthy();
    // Once the job is complete the accuracy is a real percentage, never "Analyzing" or "Unavailable".
    await waitFor(() => {
      const accuracy = screen.getByText('Accuracy').closest('.dfd__stat');
      expect(accuracy?.textContent).toMatch(/\d+(\.\d)?%/);
    }, { timeout: 30_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Review Game' }));
    expect(await screen.findByRole('dialog', { name: 'reviewer' })).toHaveTextContent(/\d+ moves reviewed/);
  }, 60_000);
});
