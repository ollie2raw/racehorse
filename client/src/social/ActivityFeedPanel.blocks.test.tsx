// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from './socialApi';

const fetchActivityFeed = vi.fn();
const fetchGlobalActivityFeed = vi.fn();
const fetchBlockedUserIds = vi.fn();
vi.mock('./socialApi', async (importActual) => ({
  ...(await importActual<typeof import('./socialApi')>()),
  fetchActivityFeed: () => fetchActivityFeed(),
  fetchGlobalActivityFeed: () => fetchGlobalActivityFeed(),
}));
vi.mock('../moderation/moderationApi', () => ({ fetchBlockedUserIds: () => fetchBlockedUserIds() }));

const { default: ActivityFeedPanel } = await import('./ActivityFeedPanel');

function item(id: string, user_id: string, username: string): FeedItem {
  return {
    id,
    user_id,
    username,
    type: 'win',
    metadata: { score: 30, opponent_score: 24, mode: 'multiplayer' },
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  };
}

const user = { id: 'me', email: 'me@example.com' } as never;
const feed = [item('a', 'blocked-user', 'blocked_one'), item('b', 'friendly-user', 'friendly_one')];

describe('ActivityFeedPanel — blocked players', () => {
  beforeEach(() => {
    fetchActivityFeed.mockReset();
    fetchGlobalActivityFeed.mockReset();
    fetchBlockedUserIds.mockReset();
    fetchGlobalActivityFeed.mockResolvedValue({ feed, error: null });
  });

  it('hides activity by players the viewer has blocked', async () => {
    fetchBlockedUserIds.mockResolvedValue(['blocked-user']);
    render(<ActivityFeedPanel user={user} filter="all" onViewProfile={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('friendly_one')).toBeInTheDocument());
    expect(screen.queryByText('blocked_one')).toBeNull();
  });

  it('fails closed: if the block list cannot be loaded, no global activity is shown', async () => {
    fetchBlockedUserIds.mockResolvedValue(null);
    render(<ActivityFeedPanel user={user} filter="all" onViewProfile={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());
    expect(screen.queryByText('blocked_one')).toBeNull();
    expect(screen.queryByText('friendly_one')).toBeNull();
  });

  it('signed-out viewers see the public feed without a block lookup', async () => {
    render(<ActivityFeedPanel user={null} filter="all" onViewProfile={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('blocked_one')).toBeInTheDocument());
    expect(fetchBlockedUserIds).not.toHaveBeenCalled();
  });
});
