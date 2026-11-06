// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotPostGameCard, type BotPostGameCardProps } from './BotPostGameCard';

afterEach(cleanup);

function card(overrides: Partial<BotPostGameCardProps> = {}) {
  const props: BotPostGameCardProps = {
    showPlayVsFritzResultOverlay: true,
    winnerId: 'you',
    opponentLabel: 'Fritz',
    youScore: 60,
    botScore: 40,
    isJourneyTrial: false,
    hasConfirmedFritzRatingUpdate: false,
    fritzNewGlickoRating: null,
    fritzGlickoDelta: null,
    ghostResult: null,
    onNavigate: null,
    botPostGameReviewEligible: false,
    postGameAnalysisPending: false,
    postGameAnalysis: null,
    accuracyModelPending: false,
    onRematch: vi.fn(),
    onChangeSetup: vi.fn(),
    exitJourneyTrial: vi.fn(),
    onReviewGame: vi.fn(),
    ...overrides,
  };
  render(<BotPostGameCard {...props} />);
  return props;
}

describe('Play vs Fritz result card for a guest', () => {
  it('offers to keep the game, and Create account leaves the card for setup before opening sign-up', () => {
    const order: string[] = [];
    card({
      onChangeSetup: () => order.push('setup'),
      onSaveGuestGame: () => order.push('auth'),
    });
    expect(screen.getByText(/Keep this game and your history/)).toBeTruthy();
    screen.getByRole('button', { name: /Create account/ }).click();
    expect(order).toEqual(['setup', 'auth']);
  });

  it('shows nothing extra to a signed-in player', () => {
    card();
    expect(screen.queryByText(/Keep this game/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Create account/ })).toBeNull();
  });

  it('does not interrupt a Journey trial, whatever the session', () => {
    card({ isJourneyTrial: true, onSaveGuestGame: vi.fn() });
    expect(screen.queryByRole('button', { name: /Create account/ })).toBeNull();
  });

  it('leaves Rematch as the main action', () => {
    const props = card({ onSaveGuestGame: vi.fn() });
    screen.getByRole('button', { name: 'Rematch' }).click();
    expect(props.onRematch).toHaveBeenCalledTimes(1);
  });
});
