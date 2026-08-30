// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlayerIdentityModel } from '../identity/playerIdentityNormalization';
import type { PlayerIdentityModel } from '../identity/playerIdentityTypes';
import StatsScreen from './StatsScreen';

const { identityState } = vi.hoisted(() => ({ identityState: { current: null as { model: PlayerIdentityModel | null; loading: boolean; error: string | null } | null } }));
vi.mock('../identity/usePlayerIdentityModel', () => ({ usePlayerIdentityModel: () => identityState.current }));
// The page carries the site nav now rather than its own bare topbar.
vi.mock('../components/GlobalNav', () => ({ GlobalNav: () => null }));

function model(): PlayerIdentityModel {
  const base = createEmptyPlayerIdentityModel(100);
  return {
    ...base,
    subject: { ...base.subject, userId: 'user-1', username: 'Maya', isCurrentUser: true, friendshipStatus: 'self' },
    competitive: { ...base.competitive, rating: 1400, peakRating: 1450, globalRank: 10, provisional: false, rankedGames: 20, wins: 12, losses: 8, winRate: 60, currentStreak: 2, bestStreak: 5 },
    fritz: { ...base.fritz, totalWins: 8, totalLosses: 4, winRate: 66.7, averageScore: 87.5, bestScore: 100, difficultyRecords: [{ difficulty: 'rookie', wins: 4, losses: 1, games: 5 }] },
    puzzle: { ...base.puzzle, completions: 12, currentStreak: 4, bestScoreToday: 72, bestScoreEver: 95, bestScore: 95, perfectDays: 3 },
    ghost: { ...base.ghost, rating: 900, gamesPlayed: 4, wins: 2, losses: 2, winRate: 50, bestWinMargin: 14 },
    sourceStatus: { ...base.sourceStatus, personal_insights: 'ready', journey: 'ready' },
  };
}

const props = { open: true, user: { id: 'user-1', email: 'maya@example.com' } as User, profile: { username: 'Maya' } as never, onClose: vi.fn() };

describe('StatsScreen normalized presentation', () => {
  beforeEach(() => { identityState.current = { model: model(), loading: false, error: null }; });

  it('renders ranked, Fritz, Ghost, Puzzle, and score semantics from identity fields', () => {
    // Stat numbers count up from zero, so let the animation land before
    // asserting on the values that settle.
    vi.useFakeTimers();
    render(<StatsScreen {...props} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();
    // The hero leads with who this is and the rating, not a section title.
    expect(screen.getByRole('heading', { name: '@Maya', level: 1 })).toBeTruthy();
    expect(screen.getByText('1,400')).toBeTruthy();
    expect(screen.getByText('#10')).toBeTruthy();
    expect(screen.getByText('87.5')).toBeTruthy();
    expect(screen.getByText('95')).toBeTruthy();
    expect(screen.getByText('Practice under pressure')).toBeTruthy();
    // Daily Fritz has a section at last.
    expect(screen.getByText('The daily set')).toBeTruthy();
  });

  it('renders a compact empty Puzzle state without invented zero metrics', () => {
    const empty = model();
    empty.puzzle = { ...empty.puzzle, completions: 0, currentStreak: 0, bestScoreToday: null, bestScoreEver: null, bestScore: null, perfectDays: 0 };
    identityState.current = { model: empty, loading: false, error: null };
    render(<StatsScreen {...props} />);
    expect(screen.getByText('Complete a Daily Puzzle to begin building your record.')).toBeTruthy();
    expect(screen.queryByText('0 completions')).toBeNull();
  });

  it('does not expose private Stats to an unsupported public target', () => {
    render(<StatsScreen {...props} targetUserId="other-user" />);
    expect(screen.getByText('Personal Stats are available from the player’s own account.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '@Maya' })).toBeNull();
  });

  it('keeps loading state scoped to the Stats hierarchy', () => {
    identityState.current = { model: null, loading: true, error: null };
    render(<StatsScreen {...props} />);
    expect(screen.getByLabelText('Loading stats')).toBeTruthy();
    // No longer a dialog: it is a route page with the site nav above it.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  });
});
