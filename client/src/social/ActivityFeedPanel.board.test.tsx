// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from './socialApi';

const fetchActivityFeed = vi.fn();
const fetchGlobalActivityFeed = vi.fn();
vi.mock('./socialApi', async (importActual) => ({
  ...(await importActual<typeof import('./socialApi')>()),
  fetchActivityFeed: () => fetchActivityFeed(),
  fetchGlobalActivityFeed: () => fetchGlobalActivityFeed(),
}));

const { default: ActivityFeedPanel } = await import('./ActivityFeedPanel');

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'f1',
    user_id: 'u1',
    username: 'marcus_r',
    type: 'win',
    metadata: { score: 30, opponent_score: 24, mode: 'multiplayer' },
    created_at: new Date(Date.now() - 14 * 60_000).toISOString(),
    ...overrides,
  };
}

const user = { id: 'me', email: 'oliver@example.com' } as never;

describe('ActivityFeedPanel — board table', () => {
  beforeEach(() => {
    fetchActivityFeed.mockReset();
    fetchGlobalActivityFeed.mockReset();
    fetchGlobalActivityFeed.mockResolvedValue({ feed: [], error: null });
  });

  it('renders the five-column board table with a signed score margin', async () => {
    fetchGlobalActivityFeed.mockResolvedValue({ feed: [item()], error: null });
    render(
      <ActivityFeedPanel user={user} filter="all" onViewProfile={vi.fn()} />,
    );

    const table = await screen.findByRole('region', { name: /activity feed/i });
    expect(table).toHaveClass('rh-sb-table');
    expect(table.querySelector('.rh-sb-thead')).not.toBeNull();
    await waitFor(() => expect(screen.getByText('30–24')).toBeInTheDocument());
    expect(screen.getByText('+6')).toHaveClass('rh-sb-score__margin');
  });

  it('marks the signed-in player’s own row', async () => {
    fetchGlobalActivityFeed.mockResolvedValue({
      feed: [
        item({ username: 'oliver', user_id: 'me' }),
        item({ id: 'f2', username: 'tessa_ng', user_id: 'other' }),
      ],
      error: null,
    });
    render(
      <ActivityFeedPanel
        user={user}
        filter="all"
        selfUserId="me"
        onViewProfile={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('oliver')).toBeInTheDocument());
    const selfRow = screen.getByText('oliver').closest('.rh-sb-row');
    expect(selfRow).toHaveClass('rh-sb-row--self');
    expect(screen.getByText('tessa_ng').closest('.rh-sb-row')).not.toHaveClass('rh-sb-row--self');
    expect(screen.getByText('You')).toHaveClass('rh-sb-you');
  });

  it('shows the empty state inside the board frame when the feed is empty', async () => {
    fetchGlobalActivityFeed.mockResolvedValue({ feed: [], error: null });
    render(<ActivityFeedPanel user={user} filter="all" onViewProfile={vi.fn()} />);
    expect(await screen.findByText(/Community results will appear here/i)).toBeInTheDocument();
  });

  it('shows global activity while signed out and uses the personal endpoint for Friends', async () => {
    fetchGlobalActivityFeed.mockResolvedValue({ feed: [item()], error: null });
    fetchActivityFeed.mockResolvedValue({
      feed: [item({ id: 'friend-post', username: 'tessa_ng', user_id: 'friend' })],
      error: null,
    });
    const onOpenAuth = vi.fn();
    const { rerender } = render(
      <ActivityFeedPanel user={null} filter="all" onViewProfile={vi.fn()} onOpenAuth={onOpenAuth} />,
    );
    expect(await screen.findByText('marcus_r')).toBeInTheDocument();
    expect(fetchActivityFeed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Sign in to view profiles'));
    expect(onOpenAuth).toHaveBeenCalledOnce();

    rerender(
      <ActivityFeedPanel
        user={user}
        filter="friends"
        friendUsernames={new Set(['tessa_ng'])}
        onViewProfile={vi.fn()}
      />,
    );
    expect(await screen.findByText('tessa_ng')).toBeInTheDocument();
    expect(fetchActivityFeed).toHaveBeenCalled();
  });
});
