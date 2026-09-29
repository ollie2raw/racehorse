// Regression: PuzzleRushScreen opened the leaderboard without telling it who
// the viewer is, so the player's own row was never matched — no "YOU" badge,
// no "Your position", and the Share Result button (gated on that row) never
// rendered.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PuzzleRushScreen } from './PuzzleRushScreen';

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-oliver' }, profile: { username: 'oliver' }, loading: false }),
}));

vi.mock('../components/GlobalNav', () => ({ GlobalNav: () => null }));
vi.mock('../components', () => ({ GlobalNav: () => null }));

vi.mock('./api', () => ({
  fetchPuzzleRushToday: vi.fn().mockResolvedValue({
    ok: true,
    runDate: '2026-09-28',
    personalBest: 2163,
    streakDays: 1,
    playedToday: true,
    officialRunComplete: true,
  }),
  fetchPuzzleRushLeaderboard: vi.fn().mockResolvedValue({
    ok: true,
    runDate: '2026-09-28',
    daily: [
      {
        rank: 1,
        userId: 'u-oliver',
        username: 'Oliver',
        totalScore: 59,
        puzzlesSolved: 3,
        runId: 'r1',
        achievedAt: '2026-09-28T21:00:00Z',
      },
    ],
    leaderboard: [],
    personalBest: null,
  }),
  startPuzzleRush: vi.fn(),
  reportPuzzleRushPuzzle: vi.fn(),
  completePuzzleRush: vi.fn(),
}));

describe('PuzzleRushScreen → leaderboard', () => {
  it('recognises the signed-in player and offers Share Result for today’s run', async () => {
    render(<PuzzleRushScreen onBack={() => {}} onNavigate={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /view leaderboard/i }));

    expect(await screen.findByRole('button', { name: /share result/i })).toBeInTheDocument();
    expect(screen.getByText('YOU')).toBeInTheDocument();
  });
});
