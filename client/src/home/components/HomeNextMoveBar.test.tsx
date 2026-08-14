// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HomePrimaryAction } from '../homeTypes';
import { HomeNextMoveBar } from './HomeNextMoveBar';

const actions: HomePrimaryAction[] = [
  { type: 'continue_tournament', title: 'Tournament Match', reason: 'Quarterfinal ready.', cta: 'Enter Match', route: 'tournament', priority: 90, expiresAt: null, tournamentId: 't1', matchId: 'm1' },
  { type: 'continue_daily_fritz', title: 'Continue Daily Fritz', reason: 'Game 2 is waiting.', cta: 'Continue', route: 'dailyFritz', priority: 70, expiresAt: null },
  { type: 'continue_daily_puzzle', title: 'Continue Daily Puzzle', reason: 'Puzzle 2 is ready.', cta: 'Continue', route: 'daily', priority: 60, expiresAt: null },
  { type: 'continue_lesson', title: 'Continue Learning', reason: 'Lesson 5 is waiting.', cta: 'Continue', route: 'journey', priority: 40, expiresAt: null, chapterId: 'chapter-5' },
  { type: 'play_daily_fritz', title: "Today's Race", reason: 'The series is ready.', cta: 'Play', route: 'dailyFritz', priority: 30, expiresAt: null },
  { type: 'play_daily_puzzle', title: 'Daily Puzzle', reason: "Today's puzzle is ready.", cta: 'Play', route: 'daily', priority: 20, expiresAt: null },
  { type: 'challenge_online_rival', title: 'Challenge Maya', reason: 'Maya is online.', cta: 'Open Friends', route: 'friends', priority: 10, expiresAt: null, rivalId: 'maya' },
  { type: 'play_recommended_mode', title: 'Ready to play?', reason: 'Jump into Play vs Fritz.', cta: 'Play', route: 'singlePlayerHub', priority: 0, expiresAt: null },
];

describe('HomeNextMoveBar', () => {
  it.each(actions)('renders the compact $type action', (action) => {
    render(<HomeNextMoveBar action={action} />);
    expect(screen.getByRole('heading', { name: action.title })).toBeInTheDocument();
    expect(screen.getByText(action.reason)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders nothing without an action and uses a compact loading skeleton', () => {
    const { container, rerender } = render(<HomeNextMoveBar action={null} />);
    expect(container.firstChild).toBeNull();
    rerender(<HomeNextMoveBar action={null} loading />);
    expect(screen.getByRole('region', { name: 'Loading your next move' })).toHaveAttribute('aria-busy', 'true');
  });

  it('delegates the CTA without routing logic', () => {
    const action = actions[3];
    const onAction = vi.fn();
    render(<HomeNextMoveBar action={action} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: `${action.cta}: ${action.title}` }));
    expect(onAction).toHaveBeenCalledWith(action);
  });

  it('keeps long copy inside a mobile-ready compact root', () => {
    const action = { ...actions[1], title: 'Continue a very long personalized Daily Fritz recommendation', reason: 'This supporting reason wraps naturally without requiring a second action.' };
    const { container } = render(<HomeNextMoveBar action={action} />);
    expect(container.firstElementChild).toHaveClass('home-next-move');
    expect(screen.getByRole('heading', { name: action.title })).toBeInTheDocument();
  });
});
