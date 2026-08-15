import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFritzChallenge,
  joinFritzChallenge,
  type FritzChallengeView,
} from './api';
import FritzChallengeRoom from './FritzChallengeRoom';

vi.mock('./api', () => ({
  getFritzChallenge: vi.fn(),
  joinFritzChallenge: vi.fn(),
}));

vi.mock('../components', () => ({
  GlobalNav: () => <nav aria-label="Global navigation" />,
}));

const challenge: FritzChallengeView = {
  id: '11111111-1111-4111-8111-111111111111',
  share_code: 'ABCDEFGH',
  challenge_id: 'fritz-challenge:test',
  fingerprint: 'fingerprint',
  status: 'open',
  format: 'best_of_3',
  fritz_tier: 'master',
  deal_size: 7,
  winning_score: 60,
  has_opponent: false,
  invite_sent: true,
  recipient_accepted: false,
  viewer_role: 'creator',
  created_at: '2026-07-26T12:00:00.000Z',
  expires_at: '2026-08-02T12:00:00.000Z',
};

describe('FritzChallengeRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a created challenge in a persistent room with locked match details', async () => {
    vi.mocked(getFritzChallenge).mockResolvedValue(challenge);

    render(
      <FritzChallengeRoom
        code="ABCDEFGH"
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Shared best of three.' }))
      .toBeInTheDocument();
    expect(screen.getByText('ABCDEFGH')).toBeInTheDocument();
    expect(screen.getByText('Invite sent')).toBeInTheDocument();
    expect(screen.getByText('No live lobby required')).toBeInTheDocument();
    expect(screen.getAllByText(/GAME [123]/)).toHaveLength(3);
    expect(screen.getByText('Master')).toBeInTheDocument();
    expect(screen.getAllByText('First to 60')).toHaveLength(2);
  });

  it('accepts an open invite in place and updates the participant state', async () => {
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
      <FritzChallengeRoom
        code="ABCDEFGH"
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Accept Challenge' }));

    await waitFor(() => {
      expect(joinFritzChallenge).toHaveBeenCalledWith('ABCDEFGH');
    });
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('Your friend accepted the challenge.')).toBeInTheDocument();
  });

  it('renders the durable verified set result after returning to the room', async () => {
    vi.mocked(getFritzChallenge).mockResolvedValue({
      ...challenge,
      status: 'completed',
      recipient_accepted: true,
      viewer_role: 'creator',
      attempt: {
        id: 'attempt-1',
        status: 'completed',
        current_game_number: 2,
        current_hand_index: 3,
        revision: 8,
        final_score: 60,
        opponent_score: 48,
        won: true,
        set_result: {
          setWinner: 'player',
          playerGamesWon: 2,
          fritzGamesWon: 0,
          games: [
            { gameNumber: 1, playerWon: true, playerScore: 60, fritzScore: 48, pointDiff: 12 },
            { gameNumber: 2, playerWon: true, playerScore: 60, fritzScore: 42, pointDiff: 18 },
          ],
        },
      },
    });

    render(<FritzChallengeRoom code="ABCDEFGH" onBack={vi.fn()} />);

    expect(await screen.findByText('Verified set complete.')).toBeInTheDocument();
    expect(screen.getAllByText('You won')).toHaveLength(2);
    expect(screen.getByText('60–48')).toBeInTheDocument();
    expect(screen.getByText(/cannot be replayed/)).toBeInTheDocument();
  });
});
