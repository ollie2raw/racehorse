// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FriendsScreen from './FriendsScreen';

const {
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  invalidateFriendsCache,
  fetchFriendsWithPresence,
  fetchPublicProfile,
  fetchUserActivity,
} = vi.hoisted(() => ({
  fetchFriends: vi.fn(),
  removeFriend: vi.fn(),
  sendFriendRequest: vi.fn(),
  acceptFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(),
  invalidateFriendsCache: vi.fn(),
  fetchFriendsWithPresence: vi.fn(),
  fetchPublicProfile: vi.fn(),
  fetchUserActivity: vi.fn(),
}));

vi.mock('./friendsApi', () => ({
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  invalidateFriendsCache,
}));

vi.mock('../social/socialApi', () => ({
  fetchFriendsWithPresence,
  fetchPublicProfile,
  fetchUserActivity,
}));

const user = { id: 'viewer-1', email: 'viewer@example.com' } as User;

const props = {
  open: true,
  user,
  socket: null,
  joinedRoom: null,
  currentUsername: 'viewer',
  onClose: vi.fn(),
  showToast: vi.fn(),
  onCopyInviteLink: vi.fn(),
  onCreatePrivateRoom: vi.fn(),
  onViewProfile: vi.fn(),
  onSpectate: vi.fn(),
};

function friend(over: Partial<{ id: string; userId: string; username: string; online: boolean }> = {}) {
  return { id: 'f1', userId: 'u1', username: 'maya', online: false, ...over };
}

describe('FriendsScreen — friend row interactive structure (S1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFriends.mockResolvedValue({
      error: null,
      friends: [friend({ id: 'f1', userId: 'u1', username: 'maya' }), friend({ id: 'f2', userId: 'u2', username: 'alex' })],
      incoming: [],
      outgoing: [],
    });
    fetchFriendsWithPresence.mockResolvedValue({ error: null, friends: [] });
    fetchPublicProfile.mockResolvedValue({ error: null, profile: null });
    fetchUserActivity.mockResolvedValue({ error: null, feed: [] });
    removeFriend.mockResolvedValue({ error: null });
  });

  it('renders no <button> nested inside another <button>, and no DOM-nesting warning', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<FriendsScreen {...props} />);
    await screen.findByText('@maya');

    for (const btn of container.querySelectorAll('button')) {
      expect(btn.querySelector('button')).toBeNull();
      expect(btn.parentElement?.closest('button') ?? null).toBeNull();
    }

    const nestingWarnings = consoleError.mock.calls
      .map((call) => call.join(' '))
      .filter((msg) => /cannot (?:be a descendant of|contain a nested)/i.test(msg));
    expect(nestingWarnings).toEqual([]);
    consoleError.mockRestore();
  });

  it('makes the row a non-button container with a dedicated select button', async () => {
    const { container } = render(<FriendsScreen {...props} />);
    await screen.findByText('@maya');

    const row = container.querySelector('.friends-page-row--selectable');
    expect(row).toBeTruthy();
    expect(row?.tagName).toBe('DIV');
    expect(row?.querySelector('button.friends-page-row__select')).toBeTruthy();
  });

  it('selects a friend from the row select button but not from the action buttons', async () => {
    const { container } = render(<FriendsScreen {...props} />);
    await screen.findByText('@maya');
    const row = container.querySelectorAll('.friends-page-row--selectable')[0] as HTMLElement;

    fireEvent.click(within(row).getByRole('button', { name: /Remove/ }));
    expect(fetchPublicProfile).not.toHaveBeenCalled();

    fireEvent.click(row.querySelector('.friends-page-row__select') as HTMLElement);
    await waitFor(() => expect(fetchPublicProfile).toHaveBeenCalledWith('maya'));
  });

  it('keeps the select control keyboard-operable', async () => {
    const { container } = render(<FriendsScreen {...props} />);
    await screen.findByText('@maya');
    const select = container.querySelector('.friends-page-row__select') as HTMLButtonElement;

    select.focus();
    expect(document.activeElement).toBe(select);
    fireEvent.click(select); // Enter/Space on a focused <button> dispatches a click
    await waitFor(() => expect(fetchPublicProfile).toHaveBeenCalledWith('maya'));
  });
});
