// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoricalGameReviewPortal } from './HistoricalGameReviewPortal';
import type { SavedGameSummary } from './savedGames';

const { fetchReviews, loadReview, fetchGames } = vi.hoisted(() => ({
  fetchReviews: vi.fn(),
  loadReview: vi.fn(),
  fetchGames: vi.fn(),
}));
vi.mock('./historicalGameReviewApi', () => ({ fetchRecentGameReviews: fetchReviews, loadHistoricalGameReview: loadReview }));
vi.mock('./savedGames', () => ({ fetchRecentGames: fetchGames }));
vi.mock('../../analyzer/GameReviewer', () => ({
  default: ({ open, analysis, onClose }: { open: boolean; analysis: { analyzedAt: number }; onClose: () => void }) =>
    open ? <div role="dialog">Review {analysis.analyzedAt}<button onClick={onClose}>Close review</button></div> : null,
}));
vi.mock('./SavedGameReview', () => ({
  default: ({ sourceMatchId, onClose }: { sourceMatchId: string; onClose: () => void }) => (
    <div role="dialog" aria-label="analyzing">Analyzing {sourceMatchId}<button onClick={onClose}>Close analysis</button></div>
  ),
}));

const hydration = { analysis: { analyzedAt: 7 }, reviewWorkerBatch: {}, decisionIdByMoveNumber: new Map(), hasReplayArtifact: true, historicalCoachingByDecisionId: new Map() };

function game(overrides: Partial<SavedGameSummary> = {}): SavedGameSummary {
  return {
    sourceMatchId: 'game-1',
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 60,
    result: { you: 61, opponent: 40, winner: 'you' },
    moveCount: 80,
    verification: 'replay_verified',
    playedAt: '2026-11-01T21:04:00.000Z',
    savedAt: '2026-11-01T21:04:05.000Z',
    ...overrides,
  };
}

const review = (overrides: Record<string, unknown> = {}) => ({
  id: 'review-1', gameDigest: 'd', sourceMatchId: 'game-1', mode: 'pvf', createdAt: '2026-11-01T21:10:00.000Z', hasReplayArtifact: true, ...overrides,
});

beforeEach(() => {
  fetchReviews.mockResolvedValue([]);
  fetchGames.mockResolvedValue({ ok: true, games: [] });
  loadReview.mockResolvedValue(hydration);
});
afterEach(() => { window.history.replaceState(null, '', '/'); vi.clearAllMocks(); });

const archive = () => screen.getByRole('region', { name: 'Your games' });

describe('Your games', () => {
  it('lists saved games with result, tier and whether the review is ready', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game(), game({ sourceMatchId: 'game-2', fritzTier: 'master', result: { you: 31, opponent: 60, winner: 'opponent' } })] });
    fetchReviews.mockResolvedValue([review()]);
    render(<HistoricalGameReviewPortal enabled />);
    const rows = await within(archive()).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Victory 61–40');
    expect(rows[0]).toHaveTextContent('Elite');
    expect(rows[0]).toHaveTextContent('Review ready');
    expect(rows[1]).toHaveTextContent('Defeat 31–60');
    expect(rows[1]).toHaveTextContent('Master');
    expect(rows[1]).toHaveTextContent('Not analyzed yet');
  });

  it('reopens a game whose review is saved instantly, from the saved review (no analysis)', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game()] });
    fetchReviews.mockResolvedValue([review()]);
    render(<HistoricalGameReviewPortal enabled />);
    fireEvent.click(await within(archive()).findByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Review 7');
    expect(loadReview).toHaveBeenCalledWith('review-1');
    expect(screen.queryByLabelText('analyzing')).toBeNull();
  });

  it('analyzes a game that was never analyzed from its saved record, then refreshes the list when closed', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game({ sourceMatchId: 'game-9' })] });
    render(<HistoricalGameReviewPortal enabled />);
    fireEvent.click(await within(archive()).findByRole('button', { name: 'Analyze' }));
    expect(await screen.findByLabelText('analyzing')).toHaveTextContent('Analyzing game-9');
    expect(loadReview).not.toHaveBeenCalled();
    const before = fetchGames.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Close analysis' }));
    await waitFor(() => expect(fetchGames.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByLabelText('analyzing')).toBeNull();
  });

  it('does not count a review without frozen explanations as ready', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game()] });
    fetchReviews.mockResolvedValue([review({ hasReplayArtifact: false })]);
    render(<HistoricalGameReviewPortal enabled />);
    const row = (await within(archive()).findAllByRole('listitem'))[0]!;
    expect(row).toHaveTextContent('Not analyzed yet');
    expect(within(row).getByRole('button', { name: 'Analyze' })).toBeTruthy();
  });

  it('does not list a review twice: it shows against its game, and only reviews with no saved game stay in Recent reviews', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game()] });
    fetchReviews.mockResolvedValue([review(), review({ id: 'legacy-1', sourceMatchId: null }), review({ id: 'orphan', sourceMatchId: 'gone' })]);
    render(<HistoricalGameReviewPortal enabled />);
    await within(archive()).findAllByRole('listitem');
    const strip = screen.getByRole('region', { name: 'Recent game reviews' });
    const listed = within(strip).getAllByRole('listitem');
    expect(listed).toHaveLength(2);
  });

  it('explains an empty archive instead of showing nothing', async () => {
    render(<HistoricalGameReviewPortal enabled />);
    expect(await within(archive()).findByText(/No saved games yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the games could not be loaded, and tries again', async () => {
    fetchGames.mockResolvedValueOnce({ ok: false, reason: 'unreachable' });
    render(<HistoricalGameReviewPortal enabled />);
    expect(await within(archive()).findByRole('alert')).toHaveTextContent('Could not load your games');
    expect(within(archive()).queryByText(/No saved games yet/)).toBeNull();
    fetchGames.mockResolvedValue({ ok: true, games: [game()] });
    fireEvent.click(within(archive()).getByRole('button', { name: 'Try again' }));
    expect(await within(archive()).findByText(/Victory 61–40/)).toBeTruthy();
  });

  it('shows nothing at all when review access is off', () => {
    const { container } = render(<HistoricalGameReviewPortal enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchGames).not.toHaveBeenCalled();
  });
});
