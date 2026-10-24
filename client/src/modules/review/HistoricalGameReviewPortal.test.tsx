// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HistoricalGameReviewPortal } from './HistoricalGameReviewPortal';
const { fetchRecent, load } = vi.hoisted(() => ({ fetchRecent: vi.fn(), load: vi.fn() }));
vi.mock('./historicalGameReviewApi', () => ({ fetchRecentGameReviews: fetchRecent, loadHistoricalGameReview: load }));
vi.mock('../../analyzer/GameReviewer', () => ({ default: ({ open, analysis, onClose }: { open: boolean; analysis: { analyzedAt: number }; onClose: () => void }) => open ? <div role="dialog">Review {analysis.analyzedAt}<button onClick={onClose}>Close review</button></div> : null }));
afterEach(() => { window.history.replaceState(null, '', '/'); vi.clearAllMocks(); });
const hydration = { analysis: { analyzedAt: 42 }, reviewWorkerBatch: {}, decisionIdByMoveNumber: new Map(), hasReplayArtifact: true, historicalCoachingByDecisionId: new Map() };
it('opens the exact saved review from history and restores it on reload/direct entry', async () => {
  window.history.replaceState(null, '', '/rating-history');
  fetchRecent.mockResolvedValue([{ id: 'saved-review', mode: 'pvf', createdAt: '2026-10-13', hasReplayArtifact: true }]);
  load.mockResolvedValue(hydration);
  const first = render(<HistoricalGameReviewPortal enabled />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review Game' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Review 42');
  expect(window.location.search).toBe('?review=saved-review');
  first.unmount();
  render(<HistoricalGameReviewPortal enabled />);
  expect(await screen.findByRole('dialog')).toHaveTextContent('Review 42');
  expect(load).toHaveBeenLastCalledWith('saved-review');
  fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
  expect(window.location.search).toBe('');
});
it('surfaces failed history loading instead of a false empty history', async () => {
  fetchRecent.mockRejectedValue(new Error('unavailable'));
  render(<HistoricalGameReviewPortal enabled />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load saved reviews'));
  expect(screen.queryByText('No saved reviews yet.')).toBeNull();
  fetchRecent.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No saved reviews yet.')).toBeTruthy();
});
