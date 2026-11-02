// @vitest-environment jsdom
/**
 * The Daily Fritz counterpart of SavedGameReview.pipeline.test.tsx (docs/daily-fritz-review-design.md, DF-4): a REAL Daily Fritz game, derived by the server's
 * own code (fixtures/dailyFritzSavedGame.json) -> parsed and rebuilt with the real engine and recorder -> the real review hook -> the real analyzer and accuracy
 * model -> the summary prompt -> the finished review saved. Only the network is stubbed. If a Daily Fritz game did not satisfy the review pipeline, this is where
 * it would show.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { isForcedDecision } from '@racehorse/game-core/review';
import { completeReviewEvaluations, evaluateReviewPosition } from '@racehorse/review-engine';
import { parseSavedDailyFritzGame, rebuildMultiplayerGameFromRecord } from './rebuildMultiplayerGameFromRecord';
import dfFixture from './fixtures/dailyFritzSavedGame.json';

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

const BUDGET = { maxNodes: 20_000, maxHiddenStateSamples: 6, maxPlyDepth: 2, seed: 'daily-fritz-pipeline', maxWallClockMs: 60_000 } as const;
const ID = dfFixture.sourceMatchId;

beforeEach(() => {
  const saved = parseSavedDailyFritzGame(structuredClone(dfFixture));
  if (!saved) throw new Error('the fixture did not parse');
  const rebuilt = rebuildMultiplayerGameFromRecord(saved);
  if (!rebuilt.ok) throw new Error(rebuilt.detail);
  loadSavedGame.mockResolvedValue({ ok: true, record: saved, game: rebuilt.game });

  // The server's job, stood in for by the real engine over exactly the snapshots the client sent (see the Play vs Fritz pipeline test).
  enqueue.mockImplementation(async (request: { snapshots: Parameters<typeof evaluateReviewPosition>[0][] }) => {
    const live = new Map(request.snapshots.map((snapshot) => [snapshot.identifiers.decisionId, evaluateReviewPosition(snapshot, BUDGET, 0.02, () => 0)]));
    const done = completeReviewEvaluations({ snapshots: request.snapshots, liveResultsByDecisionId: live, startTier: 2, maxTier: 4 });
    expect(done.complete).toBe(true);
    const evaluations = new Map<string, ReviewEvaluationV1>(done.resultsByDecisionId);
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

describe('a saved Daily Fritz game, reviewed through the real pipeline', () => {
  it('sends the server only the player\'s decisions under the game\'s own id, labels it Daily Fritz, and saves the finished review', async () => {
    render(<SavedGameReview sourceMatchId={ID} onClose={vi.fn()} />);

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    const request = enqueue.mock.calls[0]![0] as {
      sourceMatchId: string;
      snapshots: Array<{ identifiers: { decisionId: string; actorId: string } }>;
      expectedDecisionIds: string[];
      captureFailures: unknown[];
    };
    expect(request.sourceMatchId).toBe(ID);
    expect(request.snapshots.length).toBeGreaterThan(8);
    expect(request.snapshots.every((s) => s.identifiers.actorId === 'you')).toBe(true);
    expect(request.snapshots.every((s) => s.identifiers.decisionId.startsWith(`${ID}:you:`))).toBe(true);
    expect([...request.expectedDecisionIds].sort()).toEqual(request.snapshots.map((s) => s.identifiers.decisionId).sort());
    expect(request.captureFailures).toEqual([]);

    // Every tile the player played is a decision. (There are more decisions than recorded actions: a recorded DRAW stands for each forced draw it ran.)
    const youPlays = dfFixture.record.hands.flatMap((h) => h.actions).filter((a) => a.seat === 'you' && a.type === 'MOVE').length;
    expect(request.snapshots.length).toBeGreaterThanOrEqual(youPlays);

    // The summary says what kind of game it was, against whom, and how it ended; once complete the accuracy is a real percentage.
    expect(await screen.findByText(dfFixture.result.winner === 'you' ? 'Victory' : 'Defeat', undefined, { timeout: 120_000 })).toBeTruthy();
    expect(screen.getByText('Daily Fritz')).toBeTruthy();
    await waitFor(() => {
      const accuracy = screen.getByText('Accuracy').closest('.dfd__stat');
      expect(accuracy?.textContent).toMatch(/\d+(\.\d)?%/);
    }, { timeout: 120_000 });

    // The finished review is saved under the game's own id, so the next open is instant.
    await waitFor(() => expect(writeReview).toHaveBeenCalledTimes(1), { timeout: 120_000 });
    const [body] = writeReview.mock.calls[0]! as [{ sourceMatchId: string; evaluations: unknown[]; replayArtifact: unknown }];
    expect(body.sourceMatchId).toBe(ID);
    expect(body.evaluations).toHaveLength(request.snapshots.length);
    expect(body.replayArtifact).toBeTruthy();
  }, 240_000);
});
