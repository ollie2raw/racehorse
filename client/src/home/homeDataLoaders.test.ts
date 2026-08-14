// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { loadSocial } from './homeDataLoaders';

const friends = vi.hoisted(() => vi.fn());
const activity = vi.hoisted(() => vi.fn());
const rivals = vi.hoisted(() => vi.fn());

vi.mock('../social/socialApi', () => ({
  fetchFriendsWithPresence: friends,
  fetchActivityFeed: activity,
  fetchRivals: rivals,
}));

describe('Home source loader isolation and concurrency', () => {
  it('starts independent social requests before any one resolves', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const deferred = () => new Promise((resolve) => resolvers.push(resolve));
    friends.mockImplementationOnce(deferred);
    activity.mockImplementationOnce(deferred);
    rivals.mockImplementationOnce(deferred);

    const pending = loadSocial();
    expect(friends).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledTimes(1);
    expect(rivals).toHaveBeenCalledTimes(1);
    expect(resolvers).toHaveLength(3);

    resolvers[0]!({ friends: [], error: null });
    resolvers[1]!({ feed: [], error: null });
    resolvers[2]!({ rivals: [], error: null });
    await expect(pending).resolves.toEqual({ friends: [], activity: [], rivals: [] });
  });

  it('keeps a failed source as an error instead of converting it to empty data', async () => {
    friends.mockResolvedValueOnce({ friends: [], error: 'presence unavailable' });
    activity.mockResolvedValueOnce({ feed: [], error: null });
    rivals.mockResolvedValueOnce({ rivals: [], error: null });
    await expect(loadSocial()).rejects.toThrow('presence unavailable');
  });
});
