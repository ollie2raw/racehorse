// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from './socialApi';

const fetchActivityFeed = vi.fn();
vi.mock('./socialApi', async (importActual) => ({
  ...(await importActual<typeof import('./socialApi')>()),
  fetchActivityFeed: () => fetchActivityFeed(),
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
  beforeEach(() => fetchActivityFeed.mockReset());

  it('renders the five-column board table with a signed score margin', async () => {
    fetchActivityFeed.mockResolvedValue({ feed: [item()], error: null });
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
    fetchActivityFeed.mockResolvedValue({
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
    fetchActivityFeed.mockResolvedValue({ feed: [], error: null });
    render(<ActivityFeedPanel user={user} filter="all" onViewProfile={vi.fn()} />);
    expect(await screen.findByText(/Play a match or follow rivals/i)).toBeInTheDocument();
  });
});
