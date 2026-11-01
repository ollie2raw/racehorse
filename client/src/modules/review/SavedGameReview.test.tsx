// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadSavedGameResult } from './savedGames';
import type { RebuiltGame, SavedGameRecord } from './rebuildGameFromRecord';

const { loadSavedGame, useReview } = vi.hoisted(() => ({ loadSavedGame: vi.fn(), useReview: vi.fn() }));
vi.mock('./savedGames', () => ({ loadSavedGame }));
vi.mock('./usePostGamePivotalReview', () => ({ usePostGamePivotalReview: useReview }));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'player@example.com' }, accessToken: 'token-1' }),
}));
vi.mock('../../analyzer/GameReviewer', () => ({
  default: ({ open, onClose, title }: { open: boolean; onClose: () => void; title: string }) =>
    open ? <div role="dialog" aria-label="reviewer">{title}<button onClick={onClose}>Close reviewer</button></div> : null,
}));

import SavedGameReview, { savedGameFailureCopy } from './SavedGameReview';

const record: SavedGameRecord = {
  sourceMatchId: 'game-1',
  mode: 'pvf',
  fritzTier: 'master',
  dealSize: 7,
  winningScore: 60,
  matchStarter: 'you',
  dealSeed: 'seed',
  result: { you: 61, opponent: 40, winner: 'you' },
  moves: [],
  verification: 'replay_verified',
  playedAt: null,
};
const game = { moveLog: [{ moveNumber: 1 }], snapshots: [], finalState: { gameOver: true }, recorder: { tag: 'recorder' } } as unknown as RebuiltGame;

const ok = (): LoadSavedGameResult => ({ ok: true, record, game });

function hookResult(overrides: Record<string, unknown> = {}) {
  return {
    analyzerOpen: false,
    currentAnalysis: null,
    postGameAnalysis: null,
    accuracyModelPending: true,
    reviewUnavailable: false,
    decisionLedger: null,
    retryReview: vi.fn(),
    reviewRetryState: 'idle',
    openReviewGameFromPrompt: vi.fn(),
    closeAnalyzer: vi.fn(),
    reviewWorkerBatch: {},
    decisionIdByMoveNumber: new Map(),
    coachingFactsStore: {},
    snapshotsByDecisionId: new Map(),
    enablePositionalExplanations: false,
    reviewerScopeHandNumber: null,
    reviewerInitialMoveIndex: 1,
    ...overrides,
  };
}

const analysis = { analyzedAt: 1, analyzedMoves: [], timeline: [], hands: [], accuracy: 80, grade: 'B' };

beforeEach(() => { useReview.mockReturnValue(hookResult()); });
afterEach(() => vi.clearAllMocks());

describe('SavedGameReview: opening a saved game', () => {
  it('says it is loading while the game is fetched', () => {
    loadSavedGame.mockReturnValue(new Promise(() => {}));
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Loading your game');
  });

  it('explains a game that was never saved, with no retry that cannot help', async () => {
    loadSavedGame.mockResolvedValue({ ok: false, reason: 'not_found' });
    render(<SavedGameReview sourceMatchId="nope" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('may not have been saved');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers a retry when the server could not be reached, and loads on the second try', async () => {
    loadSavedGame.mockResolvedValueOnce({ ok: false, reason: 'unreachable' });
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
    loadSavedGame.mockResolvedValue(ok());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(useReview).toHaveBeenCalled());
    expect(loadSavedGame).toHaveBeenCalledTimes(2);
  });

  it.each(['no_deal_seed', 'not_replayable', 'incomplete_game', 'result_mismatch'] as const)(
    'says plainly that a game that does not replay (%s) cannot be reviewed, never a raw code',
    async (reason) => {
      loadSavedGame.mockResolvedValue({ ok: false, reason, detail: 'engine said: Illegal move [3|4] on left' });
      render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('do not replay cleanly');
      expect(alert.closest('[role="dialog"]')).not.toHaveTextContent(/Illegal move|_/);
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    },
  );

  it('can always be closed', async () => {
    const onClose = vi.fn();
    loadSavedGame.mockResolvedValue({ ok: false, reason: 'not_found' });
    render(<SavedGameReview sourceMatchId="x" onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SavedGameReview: running the review on the rebuilt game', () => {
  it('hands the rebuilt game to the same review hook the live match uses, starting at once', async () => {
    loadSavedGame.mockResolvedValue(ok());
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    await waitFor(() => expect(useReview).toHaveBeenCalled());
    expect(useReview.mock.calls[0]?.[0]).toMatchObject({
      match: game.finalState,
      moveLog: game.moveLog,
      reviewSnapshotRecorder: game.recorder,
      sourceMatchId: 'game-1',
      fritzTier: 'master',
      winningScore: 60,
      botPostGameReviewEligible: true,
      showPostGameOverlays: true,
      reviewCaptureEnabled: true,
      reviewStartDelayMs: 0,
      accessToken: 'token-1',
    });
  });

  it('falls back to a valid tier for a record with an unknown one', async () => {
    loadSavedGame.mockResolvedValue({ ok: true, record: { ...record, fritzTier: 'mystery' }, game });
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    await waitFor(() => expect(useReview).toHaveBeenCalled());
    expect(useReview.mock.calls[0]?.[0]).toMatchObject({ fritzTier: 'elite' });
  });

  it('says it is preparing until the analysis exists', async () => {
    loadSavedGame.mockResolvedValue(ok());
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Preparing your game…')).toBeTruthy();
  });

  it('shows the summary with the result, and opens the full review from it', async () => {
    const openReviewGameFromPrompt = vi.fn();
    useReview.mockReturnValue(hookResult({ postGameAnalysis: analysis, openReviewGameFromPrompt }));
    loadSavedGame.mockResolvedValue(ok());
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Victory')).toBeTruthy();
    expect(screen.getByText('61-40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review Game' }));
    expect(openReviewGameFromPrompt).toHaveBeenCalledTimes(1);
  });

  it('shows a defeat as a defeat', async () => {
    useReview.mockReturnValue(hookResult({ postGameAnalysis: analysis }));
    loadSavedGame.mockResolvedValue({ ok: true, record: { ...record, result: { you: 30, opponent: 60, winner: 'opponent' } }, game });
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    expect(await screen.findByText('Defeat')).toBeTruthy();
  });

  it('offers Analyze again when the server gave up, wired to the hook', async () => {
    const retryReview = vi.fn();
    useReview.mockReturnValue(hookResult({ postGameAnalysis: analysis, reviewUnavailable: true, retryReview }));
    loadSavedGame.mockResolvedValue(ok());
    render(<SavedGameReview sourceMatchId="game-1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Analyze again' }));
    expect(retryReview).toHaveBeenCalledTimes(1);
  });

  it('skipping the summary closes everything', async () => {
    const onClose = vi.fn();
    useReview.mockReturnValue(hookResult({ postGameAnalysis: analysis }));
    loadSavedGame.mockResolvedValue(ok());
    render(<SavedGameReview sourceMatchId="game-1" onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the full reviewer once opened, and closing it closes the whole flow', async () => {
    const closeAnalyzer = vi.fn();
    const onClose = vi.fn();
    useReview.mockReturnValue(hookResult({ postGameAnalysis: analysis, analyzerOpen: true, currentAnalysis: analysis, closeAnalyzer }));
    loadSavedGame.mockResolvedValue(ok());
    render(<SavedGameReview sourceMatchId="game-1" onClose={onClose} />);
    expect(await screen.findByRole('dialog', { name: 'reviewer' })).toHaveTextContent('Game Review');
    fireEvent.click(screen.getByRole('button', { name: 'Close reviewer' }));
    expect(closeAnalyzer).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('savedGameFailureCopy', () => {
  it('only treats an unreachable server as retryable', () => {
    expect(savedGameFailureCopy({ ok: false, reason: 'unreachable' }).retryable).toBe(true);
    expect(savedGameFailureCopy({ ok: false, reason: 'not_found' }).retryable).toBe(false);
    expect(savedGameFailureCopy({ ok: false, reason: 'not_replayable', detail: 'x' }).retryable).toBe(false);
  });
});
