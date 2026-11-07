// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import { BotPostGameCard, type BotPostGameCardProps } from './BotPostGameCard';

afterEach(cleanup);

const analysis: GameAnalysis = {
  accuracy: 77.3,
  grade: 'B',
  analyzedAt: 0,
  analyzedMoves: [],
  timeline: [],
  hands: [],
  oracleMode: 'tier',
  tierPlayed: 'standard',
  oracleLabel: 'Fritz',
  worstHandNumber: null,
  consequenceByMoveNumber: {},
};

function card(overrides: Partial<BotPostGameCardProps> = {}) {
  const props: BotPostGameCardProps = {
    showPlayVsFritzResultOverlay: true,
    winnerId: 'bot',
    opponentLabel: 'Fritz',
    youScore: 47,
    botScore: 66,
    isJourneyTrial: false,
    hasConfirmedFritzRatingUpdate: false,
    fritzNewGlickoRating: null,
    fritzGlickoDelta: null,
    ghostResult: null,
    onNavigate: null,
    botPostGameReviewEligible: true,
    postGameAnalysisPending: false,
    postGameAnalysis: analysis,
    accuracyModelPending: true,
    onRematch: vi.fn(),
    onChangeSetup: vi.fn(),
    exitJourneyTrial: vi.fn(),
    onReviewGame: vi.fn(),
    ...overrides,
  };
  render(<BotPostGameCard {...props} />);
  return props;
}

describe('Play vs Fritz end card', () => {
  it('is one card that states the score once and drops the stat grid, standings and margin', () => {
    card();
    const dialog = screen.getByRole('dialog', { name: 'Play vs Fritz result' });
    expect(within(dialog).getByRole('heading', { name: 'Defeat' })).toBeTruthy();
    expect(within(dialog).getByText('Fritz won, 66–47.')).toBeTruthy();
    expect(within(dialog).queryByText('Margin')).toBeNull();
    expect(within(dialog).queryByText('Final score')).toBeNull();
    expect(dialog.querySelector('.dfd__stats')).toBeNull();
    expect(dialog.querySelector('.dfd__standings')).toBeNull();
  });

  it('makes Review game the primary action and opens the review from it', () => {
    const props = card();
    const review = screen.getByRole('button', { name: 'Review game' });
    expect(review.className).toContain('dfd__btn--primary');
    expect((screen.getByRole('button', { name: 'Rematch' })).className).not.toContain('dfd__btn--primary');
    review.click();
    expect(props.onReviewGame).toHaveBeenCalledTimes(1);
  });

  it('opens while the analysis runs, and says what it is doing instead of a headline stat', () => {
    card({
      decisionLedger: { scoredCount: 0, estimateCount: 0, forcedCount: 0, unavailableCount: 0, pendingCount: 50, totalDecisions: 50, entries: [] },
    });
    expect((screen.getByRole('button', { name: 'Review game' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Analyzing 0 of 50 moves')).toBeTruthy();
    expect(screen.queryByText('Analyzing game…')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Analysis progress' }).getAttribute('aria-valuenow')).toBe('0');
  });

  it('cannot open a review that has no position record yet', () => {
    card({ postGameAnalysis: null, postGameAnalysisPending: true });
    expect((screen.getByRole('button', { name: 'Review game' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Preparing your review…')).toBeTruthy();
  });

  it('shows a rating line only for a confirmed update, never a pending or missing one', () => {
    card({ hasConfirmedFritzRatingUpdate: false, fritzNewGlickoRating: 2244, fritzGlickoDelta: -12 });
    expect(screen.queryByText(/Rating/)).toBeNull();
    expect(screen.queryByText(/syncing/i)).toBeNull();
    cleanup();
    card({ hasConfirmedFritzRatingUpdate: true, fritzNewGlickoRating: 2232, fritzGlickoDelta: -12 });
    expect(screen.getByText(/Rating .*2232/)).toBeTruthy();
  });

  it('has no review for a game that is not eligible, and Rematch becomes the primary action', () => {
    card({ botPostGameReviewEligible: false });
    expect(screen.queryByRole('button', { name: 'Review game' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rematch' }).className).toContain('dfd__btn--primary');
  });

  it('does not show a review in a Journey trial', () => {
    card({ isJourneyTrial: true, winnerId: 'you' });
    expect(screen.queryByRole('region', { name: 'Game review' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue Trail' })).toBeTruthy();
  });

  it('keeps Change setup and Home as quiet exits', () => {
    const props = card({ onNavigate: vi.fn(), onHome: vi.fn() });
    screen.getByRole('button', { name: 'Change setup' }).click();
    expect(props.onChangeSetup).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Home' }).click();
    expect(props.onHome).toHaveBeenCalledTimes(1);
  });

  it('carries the stage-aware states: Queued, then a stalled review with Try again', () => {
    const ledger = { scoredCount: 0, estimateCount: 0, forcedCount: 0, unavailableCount: 0, pendingCount: 50, totalDecisions: 50, entries: [] };
    card({ decisionLedger: ledger, reviewWait: { stage: 'queued', stalled: false, sweepErrorCode: null }, onRetryReview: vi.fn() });
    expect(screen.getByText(/^Queued/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Review game' }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    const stalled = card({ decisionLedger: ledger, reviewWait: { stage: 'queued', stalled: true, sweepErrorCode: null }, onRetryReview: vi.fn() });
    expect(screen.getAllByText(/taking longer than expected/i).length).toBeGreaterThan(0);
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(stalled.onRetryReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Review game' }).className).toContain('dfd__btn--primary');
  });
});
