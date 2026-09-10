// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchFoundOverlay } from './MatchFoundOverlay';
import type { MatchFoundPayload } from './types';

const { fetchRankingProfile, fetchUserStatsByUserId } = vi.hoisted(() => ({
  fetchRankingProfile: vi.fn(),
  fetchUserStatsByUserId: vi.fn(),
}));

vi.mock('../stats/statsApi', () => ({ fetchRankingProfile, fetchUserStatsByUserId }));

const payload: MatchFoundPayload = {
  roomCode: 'ROOM1',
  opponent: { userId: 'opp-1', username: 'alex', rating: 1180, isSim: false },
  yourRating: 1240,
  countdownMs: 5000,
};

const props = { payload, onComplete: vi.fn(), yourUsername: 'maya', yourUserId: 'you-1' };

describe('MatchFoundOverlay — record accessible name (S2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never labels a record line "Record placeholder"', async () => {
    fetchRankingProfile.mockResolvedValue({ data: null });
    fetchUserStatsByUserId.mockResolvedValue({ data: null });
    render(<MatchFoundOverlay {...props} />);

    await waitFor(() => expect(fetchUserStatsByUserId).toHaveBeenCalled());
    expect(screen.queryByLabelText('Record placeholder')).toBeNull();
  });

  it('labels the unknown record as not available', async () => {
    fetchRankingProfile.mockResolvedValue({ data: null });
    fetchUserStatsByUserId.mockResolvedValue({ data: null });
    render(<MatchFoundOverlay {...props} />);

    const unknowns = await screen.findAllByLabelText('Win–loss–draw record: not available');
    expect(unknowns).toHaveLength(2); // both seats
    expect(unknowns[0].textContent).toBe('— · — · —');
  });

  it('spells out a loaded record in the accessible name', async () => {
    fetchRankingProfile.mockImplementation((id: string) =>
      Promise.resolve({ data: { currentWinStreak: id === 'you-1' ? 3 : 0 } }),
    );
    fetchUserStatsByUserId.mockImplementation((id: string) =>
      Promise.resolve({ data: id === 'you-1' ? { wins: 12, losses: 5 } : { wins: 4, losses: 9 } }),
    );
    render(<MatchFoundOverlay {...props} />);

    const you = await screen.findByLabelText('Win–loss–draw record: 12 wins, 5 losses, 0 draws');
    expect(you.textContent).toBe('12 · 5 · 0');
    expect(
      await screen.findByLabelText('Win–loss–draw record: 4 wins, 9 losses, 0 draws'),
    ).toBeTruthy();
  });
});
