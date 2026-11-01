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
    review: null,
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
    fetchGames.mockResolvedValue({ ok: true, games: [game({ review: { id: 'review-1', accuracy: 91.2, grade: 'A' } }), game({ sourceMatchId: 'game-2', fritzTier: 'master', result: { you: 31, opponent: 60, winner: 'opponent' } })] });
    render(<HistoricalGameReviewPortal enabled />);
    const rows = await within(archive()).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Victory 61–40');
    expect(rows[0]).toHaveTextContent('Elite');
    expect(rows[0]).toHaveTextContent('Review ready');
    expect(rows[0]).toHaveTextContent('91.2% accuracy · A');
    expect(rows[1]).toHaveTextContent('Defeat 31–60');
    expect(rows[1]).toHaveTextContent('Master');
    expect(rows[1]).toHaveTextContent('Not analyzed yet');
  });

  it('reopens a game whose review is saved instantly, from the saved review (no analysis)', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game({ review: { id: 'review-1', accuracy: null, grade: null } })] });
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

  it('says "Not analyzed yet" for a game with no reopenable review, even if a legacy review row exists for it', async () => {
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

describe('the strip on Rating History', () => {
  it('asks for a short list, and links to the Games page only when it is given a way to open it', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game()] });
    const onOpenGamesPage = vi.fn();
    const { unmount } = render(<HistoricalGameReviewPortal enabled onOpenGamesPage={onOpenGamesPage} />);
    fireEvent.click(await screen.findByRole('button', { name: 'All games →' }));
    expect(onOpenGamesPage).toHaveBeenCalledTimes(1);
    expect(fetchGames).toHaveBeenCalledWith(20);
    expect(screen.queryByRole('group', { name: 'Filter by result' })).toBeNull();
    unmount();
    render(<HistoricalGameReviewPortal enabled />);
    await within(archive()).findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: 'All games →' })).toBeNull();
  });
});

describe('the Games page', () => {
  const pageGames = () => [
    game({ sourceMatchId: 'a', fritzTier: 'rookie', review: { id: 'ra', accuracy: 90, grade: 'A' } }),
    game({ sourceMatchId: 'b', fritzTier: 'master', result: { you: 20, opponent: 60, winner: 'opponent' }, review: { id: 'rb', accuracy: 70, grade: 'C' } }),
    game({ sourceMatchId: 'c', fritzTier: 'master' }),
    game({ sourceMatchId: 'd', fritzTier: 'master', result: { you: 10, opponent: 60, winner: 'opponent' } }),
  ];

  it('asks for the whole archive and shows your games at a glance', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: pageGames() });
    render(<HistoricalGameReviewPortal enabled layout="page" />);
    const stats = await screen.findByRole('list', { name: 'Your games at a glance' }).catch(() => null) ?? await screen.findByLabelText('Your games at a glance');
    expect(fetchGames).toHaveBeenCalledWith(100);
    expect(stats).toHaveTextContent('Games4');
    expect(stats).toHaveTextContent('Win rate50%');
    expect(stats).toHaveTextContent('Reviewed2');
    expect(stats).toHaveTextContent('Avg accuracy80%');
  });

  it('filters by result and by tier, offering only tiers you have played', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: pageGames() });
    render(<HistoricalGameReviewPortal enabled layout="page" />);
    await within(archive()).findAllByRole('listitem');
    expect(within(archive()).getAllByRole('listitem')).toHaveLength(4);
    const tiers = within(screen.getByRole('group', { name: 'Filter by Fritz tier' }));
    expect(tiers.getAllByRole('button').map((b) => b.textContent)).toEqual(['All tiers', 'Rookie', 'Master']);

    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by result' })).getByRole('button', { name: 'Losses' }));
    expect(within(archive()).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(tiers.getByRole('button', { name: 'Master' }));
    expect(within(archive()).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(tiers.getByRole('button', { name: 'Rookie' }));
    expect(within(archive()).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(archive()).getByText(/No games match these filters/)).toBeTruthy();
    // The stats describe all your games, not the filtered view.
    expect(screen.getByLabelText('Your games at a glance')).toHaveTextContent('Games4');

    fireEvent.click(within(archive()).getByRole('button', { name: 'Clear filters' }));
    expect(within(archive()).getAllByRole('listitem')).toHaveLength(4);
  });

  it('marks the active filter for assistive tech', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: pageGames() });
    render(<HistoricalGameReviewPortal enabled layout="page" />);
    await within(archive()).findAllByRole('listitem');
    const result = within(screen.getByRole('group', { name: 'Filter by result' }));
    expect(result.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(result.getByRole('button', { name: 'Wins' }));
    expect(result.getByRole('button', { name: 'Wins' })).toHaveAttribute('aria-pressed', 'true');
    expect(result.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers no tier filter when you have only played one tier, and none of the controls with no games', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: [game(), game({ sourceMatchId: 'x' })] });
    const { unmount } = render(<HistoricalGameReviewPortal enabled layout="page" />);
    await within(archive()).findAllByRole('listitem');
    expect(screen.queryByRole('group', { name: 'Filter by Fritz tier' })).toBeNull();
    unmount();
    fetchGames.mockResolvedValue({ ok: true, games: [] });
    render(<HistoricalGameReviewPortal enabled layout="page" />);
    expect(await within(archive()).findByText(/No saved games yet/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter by result' })).toBeNull();
    expect(screen.queryByLabelText('Your games at a glance')).toBeNull();
  });

  it('does not show an empty "Recent reviews" box, but still lists older reviews that have no saved game', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: pageGames() });
    const { unmount } = render(<HistoricalGameReviewPortal enabled layout="page" />);
    await within(archive()).findAllByRole('listitem');
    expect(screen.queryByRole('region', { name: 'Recent game reviews' })).toBeNull();
    unmount();
    fetchReviews.mockResolvedValue([review({ id: 'old', sourceMatchId: null })]);
    render(<HistoricalGameReviewPortal enabled layout="page" />);
    expect(await screen.findByRole('region', { name: 'Recent game reviews' })).toBeTruthy();
  });

  it('opens a ready review and starts an analysis from the same list', async () => {
    fetchGames.mockResolvedValue({ ok: true, games: pageGames() });
    render(<HistoricalGameReviewPortal enabled layout="page" />);
    const rows = await within(archive()).findAllByRole('listitem');
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Review 7');
    expect(loadReview).toHaveBeenCalledWith('ra');
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    fireEvent.click(within(rows[2]!).getByRole('button', { name: 'Analyze' }));
    expect(await screen.findByLabelText('analyzing')).toHaveTextContent('Analyzing c');
  });
});

