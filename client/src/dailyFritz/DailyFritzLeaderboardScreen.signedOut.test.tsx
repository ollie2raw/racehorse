// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { loading: false };
vi.mock('../auth/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../components', () => ({ GlobalNav: () => null }));
vi.mock('../friends/friendsApi', () => ({ fetchFriends: async () => ({ friends: [], incoming: [], outgoing: [] }) }));

const fetchDailyFritzLeaderboard = vi.fn();
vi.mock('./api', async (importActual) => ({
  ...(await importActual<typeof import('./api')>()),
  fetchDailyFritzLeaderboard: (date: string) => fetchDailyFritzLeaderboard(date),
  getTodayDailyFritz: async () => null,
}));

const { default: DailyFritzLeaderboardScreen } = await import('./DailyFritzLeaderboardScreen');

const user = { id: 'u-1', email: 'me@example.com' } as never;
const row = {
  rank: 1,
  username: 'domino_king',
  won: true,
  finalScore: 60,
  opponentScore: 40,
  pointDiff: 20,
  movesUsed: 30,
  completedAt: new Date().toISOString(),
};

function renderScreen(props: { user: unknown; onOpenAuth?: () => void }) {
  return render(
    <DailyFritzLeaderboardScreen user={props.user as never} runDate="2026-10-12" onBack={vi.fn()} onOpenAuth={props.onOpenAuth} />,
  );
}

describe('Daily Fritz leaderboard — auth states', () => {
  beforeEach(() => {
    authState.loading = false;
    fetchDailyFritzLeaderboard.mockReset();
  });

  it('signed out: asks the player to sign in, does not call the API, shows no failure', async () => {
    const onOpenAuth = vi.fn();
    renderScreen({ user: null, onOpenAuth });

    expect(screen.getByText('Sign in to view the Daily Fritz leaderboard.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Couldn.t load the leaderboard/)).toBeNull();
    expect(fetchDailyFritzLeaderboard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });

  it('while the session is still restoring: shows loading, not the sign-in prompt', () => {
    authState.loading = true;
    renderScreen({ user: null, onOpenAuth: vi.fn() });

    expect(screen.getByText('Loading leaderboard…')).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to view/)).toBeNull();
  });

  it('signed in: loads and renders the leaderboard', async () => {
    fetchDailyFritzLeaderboard.mockResolvedValue([row]);
    renderScreen({ user });

    await waitFor(() => expect(screen.getAllByText('domino_king').length).toBeGreaterThan(0));
    expect(fetchDailyFritzLeaderboard).toHaveBeenCalledWith('2026-10-12');
    expect(screen.queryByText(/Sign in to view/)).toBeNull();
  });

  it('signed in, real server/network failure: still shows the failure state', async () => {
    fetchDailyFritzLeaderboard.mockRejectedValue(new Error('Network error'));
    renderScreen({ user });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn.t load the leaderboard/);
    expect(screen.queryByText(/Sign in to view/)).toBeNull();
  });
});
