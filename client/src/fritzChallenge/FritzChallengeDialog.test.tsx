import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFritzChallenge,
  getFritzChallenge,
  joinFritzChallenge,
  type FritzChallengeView,
} from './api';
import { FritzChallengeDialog } from './FritzChallengeDialog';
import { fetchFriendsWithPresence } from '../social/socialApi';

vi.mock('./api', () => ({
  createFritzChallenge: vi.fn(),
  getFritzChallenge: vi.fn(),
  joinFritzChallenge: vi.fn(),
}));

vi.mock('../social/socialApi', () => ({
  fetchFriendsWithPresence: vi.fn(async () => ({
    error: null,
    friends: [{ userId: 'friend-1', username: 'friend', presence_status: 'online', current_mode: null }],
  })),
}));

const challenge: FritzChallengeView = {
  id: '11111111-1111-4111-8111-111111111111',
  share_code: 'ABCDEFGH',
  challenge_id: 'fritz-challenge:test',
  fingerprint: 'fingerprint',
  status: 'open',
  format: 'best_of_3',
  fritz_tier: 'elite',
  deal_size: 7,
  winning_score: 60,
  has_opponent: false,
  invite_sent: true,
  recipient_accepted: false,
  viewer_role: 'creator',
  created_at: '2026-07-26T12:00:00.000Z',
  expires_at: '2026-08-02T12:00:00.000Z',
};

describe('FritzChallengeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a challenge from the selected Play vs Fritz settings', async () => {
    const onCreated = vi.fn();
    vi.mocked(createFritzChallenge).mockResolvedValue({
      ok: true,
      challenge,
      share_path: '/fritz/challenge/ABCDEFGH',
    });

    render(
      <FritzChallengeDialog
        initialCode={null}
        fritzTier="elite"
        dealSize={7}
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );

    expect(await screen.findByRole('button', { name: /@friend/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /@friend/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Challenge' }));

    await waitFor(() => {
      expect(createFritzChallenge).toHaveBeenCalledWith({
        fritzTier: 'elite',
        dealSize: 7,
        recipientUserId: 'friend-1',
      });
    });
    expect(onCreated).toHaveBeenCalledWith(challenge);
  });

  it('creates an independently addressed challenge for every selected friend', async () => {
    vi.mocked(fetchFriendsWithPresence).mockResolvedValue({
      error: null,
      friends: [
        { id: 'friend-1', userId: 'friend-1', username: 'friend', presence_status: 'online', current_mode: null },
        { id: 'friend-2', userId: 'friend-2', username: 'rival', presence_status: 'offline', current_mode: null },
      ],
    });
    vi.mocked(createFritzChallenge)
      .mockResolvedValueOnce({ ok: true, challenge, share_path: '/fritz/challenge/ABCDEFGH' })
      .mockResolvedValueOnce({
        ok: true,
        challenge: { ...challenge, id: '22222222-2222-4222-8222-222222222222', share_code: 'HGFEDCBA' },
        share_path: '/fritz/challenge/HGFEDCBA',
      });

    render(
      <FritzChallengeDialog
        initialCode={null}
        fritzTier="elite"
        dealSize={7}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /@friend/ }));
    fireEvent.click(screen.getByRole('button', { name: /@rival/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2 friends' }));

    await waitFor(() => expect(createFritzChallenge).toHaveBeenCalledTimes(2));
    expect(createFritzChallenge).toHaveBeenNthCalledWith(1, {
      fritzTier: 'elite', dealSize: 7, recipientUserId: 'friend-1',
    });
    expect(createFritzChallenge).toHaveBeenNthCalledWith(2, {
      fritzTier: 'elite', dealSize: 7, recipientUserId: 'friend-2',
    });
    expect(await screen.findByText('2 challenges created')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Share invite' })).toHaveLength(2);
  });

  it('loads and atomically accepts an incoming open challenge', async () => {
    vi.mocked(getFritzChallenge).mockResolvedValue({
      ...challenge,
      viewer_role: 'opponent',
    });
    vi.mocked(joinFritzChallenge).mockResolvedValue({
      ...challenge,
      viewer_role: 'opponent',
      has_opponent: true,
      status: 'active',
      recipient_accepted: true,
    });

    render(
      <FritzChallengeDialog
        initialCode="ABCDEFGH"
        fritzTier="standard"
        dealSize={14}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('ABCDEFGH')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept Challenge' }));

    await waitFor(() => {
      expect(joinFritzChallenge).toHaveBeenCalledWith('ABCDEFGH');
    });
    expect(await screen.findByText('Challenge accepted.')).toBeInTheDocument();
  });

  it('shows a recoverable server error instead of an empty-friends state', async () => {
    vi.mocked(fetchFriendsWithPresence).mockResolvedValue({
      friends: [],
      error: 'Failed to fetch',
    });

    render(
      <FritzChallengeDialog
        initialCode={null}
        fritzTier="standard"
        dealSize={7}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('Couldn’t reach the game server. Check your connection and try again.')).toBeInTheDocument();
    expect(screen.queryByText('Add an accepted friend before creating a verified challenge.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
