// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatsIdentityHero } from './StatsIdentityHero';

type Competitive = Parameters<typeof StatsIdentityHero>[0]['competitive'];

const competitive = (over: Partial<Competitive> = {}): Competitive =>
  ({
    rating: 2230,
    peakRating: 2318,
    globalRank: 47,
    provisional: false,
    rankedGames: 211,
    wins: 128,
    losses: 83,
    winRate: 61.2,
    currentStreak: 4,
    bestStreak: 9,
    recentForm: ['win', 'win', 'loss', 'win', 'win'],
    recentMatches: [],
    ...over,
  }) as Competitive;

describe('StatsIdentityHero', () => {
  it('leads with the rating, and names the rank and peak beside it', () => {
    // The rating counts up from zero; let the animation land before asserting.
    vi.useFakeTimers();
    render(<StatsIdentityHero username="oliver" competitive={competitive()} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();

    expect(screen.getByText('2,230')).toBeTruthy();
    expect(screen.getByText('#47')).toBeTruthy();
    expect(screen.getByText('2,318')).toBeTruthy();
  });

  it('draws one square per recent result, newest last', () => {
    render(<StatsIdentityHero username="oliver" competitive={competitive()} />);

    const squares = screen.getAllByTestId('stats-form-square');
    expect(squares).toHaveLength(5);
    expect(squares.map((s) => s.getAttribute('data-result'))).toEqual([
      'win',
      'win',
      'loss',
      'win',
      'win',
    ]);
    expect(screen.getByText('4W – 1L last 5')).toBeTruthy();
  });

  it('omits the form strip entirely for a player with no recent games', () => {
    // Rather than an empty rail with a "0W – 0L" caption under it.
    render(<StatsIdentityHero username="oliver" competitive={competitive({ recentForm: [] })} />);

    expect(screen.queryAllByTestId('stats-form-square')).toHaveLength(0);
    expect(screen.queryByText(/last \d/)).toBeNull();
  });

  it('marks a provisional rating, because the number means less than it looks', () => {
    render(<StatsIdentityHero username="oliver" competitive={competitive({ provisional: true })} />);
    expect(screen.getByText(/provisional/i)).toBeTruthy();
  });

  it('says nothing about provisional once the rating has settled', () => {
    render(<StatsIdentityHero username="oliver" competitive={competitive()} />);
    expect(screen.queryByText(/provisional/i)).toBeNull();
  });

  it('shows a placeholder rather than a fake rating for an unrated player', () => {
    render(
      <StatsIdentityHero
        username="oliver"
        competitive={competitive({ rating: null, globalRank: null, peakRating: null })}
      />,
    );

    // Rating, rank and peak are each a dash rather than an invented number.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/^#\d/)).toBeNull();
  });
});
