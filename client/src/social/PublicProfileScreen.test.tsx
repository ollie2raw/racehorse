import { fireEvent, render, screen } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlayerIdentityModel } from '../identity/playerIdentityNormalization';
import type { PlayerIdentityModel } from '../identity/playerIdentityTypes';
import PublicProfileScreen from './PublicProfileScreen';

const { identityState, sendFriendRequest } = vi.hoisted(() => ({
  identityState: { current: null as { model: PlayerIdentityModel; loading: boolean; error: string | null } | null },
  sendFriendRequest: vi.fn(),
}));

vi.mock('../identity/usePlayerIdentityModel', () => ({ usePlayerIdentityModel: () => identityState.current }));
vi.mock('../friends/friendsApi', () => ({ sendFriendRequest }));

function model(overrides: Partial<PlayerIdentityModel> = {}): PlayerIdentityModel {
  const base = createEmptyPlayerIdentityModel(100);
  return {
    ...base,
    subject: { ...base.subject, userId: 'maya-1', username: 'Maya', presence: 'online', friendshipStatus: 'none' },
    competitive: { ...base.competitive, rating: 1420, peakRating: 1480, globalRank: 27, provisional: false, wins: 8, losses: 3, rankedGames: 11, winRate: 72.7, bestStreak: 5, recentForm: ['win', 'loss', 'win'], recentMatches: [{ opponentUsername: 'Alex', result: 'win', score: 100, opponentScore: 80, mode: 'online', playedAt: '2026-07-10T12:00:00Z' }] },
    fritz: { ...base.fritz, totalWins: 4, totalLosses: 2, winRate: 66.7, bestScore: 95 },
    puzzle: { ...base.puzzle, completions: 8, currentStreak: 4, bestScore: 92, perfectDays: 2 },
    milestones: [{ type: 'rating_peak', value: 1480, achieved: false }, { type: 'best_streak', value: 5, achieved: true }],
    sourceStatus: { ...base.sourceStatus, public_profile: 'ready' },
    ...overrides,
  };
}

const user = { id: 'viewer-1' } as User;
const props = { username: 'Maya', user, onClose: vi.fn(), showToast: vi.fn(), onChallenge: vi.fn(), onSpectate: vi.fn() };

describe('PublicProfileScreen identity presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityState.current = { model: model(), loading: false, error: null };
    sendFriendRequest.mockResolvedValue({ error: null });
  });

  it('renders factual public identity and mode summaries without private Journey or Ghost data', () => {
    render(<PublicProfileScreen {...props} />);
    expect(screen.getByRole('heading', { name: 'Maya', level: 1 })).toBeTruthy();
    expect(screen.getByText('RATING')).toBeTruthy();
    expect(screen.getByText('Fritz')).toBeTruthy();
    expect(screen.getByText('Daily Puzzle')).toBeTruthy();
    expect(screen.queryByText('Journey')).toBeNull();
    expect(screen.queryByText('Ghost')).toBeNull();
    expect(screen.getByText('Peak Rating')).toBeTruthy();
  });

  it('supports in-game spectating and does not turn ambiguous friendship into pending', () => {
    identityState.current = { model: model({ subject: { ...model().subject, presence: 'playing', currentMode: 'room-7', friendshipStatus: 'unknown' } }), loading: false, error: null };
    render(<PublicProfileScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Spectate' }));
    expect(props.onSpectate).toHaveBeenCalledWith('room-7');
    expect(screen.queryByText('Request Pending')).toBeNull();
  });

  it('delegates add-friend and challenge actions for a public player', async () => {
    render(<PublicProfileScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Challenge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Friend' }));
    expect(props.onChallenge).toHaveBeenCalledWith('Maya');
    expect(sendFriendRequest).toHaveBeenCalledWith('viewer-1', 'Maya');
  });

  it('omits viewer relationship for the current player and renders null values safely', () => {
    const self = model({ subject: { ...model().subject, isCurrentUser: true, friendshipStatus: 'self' }, competitive: { ...model().competitive, rating: null, globalRank: null, recentForm: [], recentMatches: [] }, milestones: [] });
    identityState.current = { model: self, loading: false, error: null };
    render(<PublicProfileScreen {...props} />);
    expect(screen.queryByText(/Your record vs/)).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Add Friend' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Challenge' })).toBeNull();
  });

  it('keeps the public identity visible when a secondary source fails', () => {
    identityState.current = { model: model({ sourceStatus: { ...model().sourceStatus, public_profile: 'ready', personal_insights: 'error' } }), loading: false, error: 'Personal stats unavailable.' };
    render(<PublicProfileScreen {...props} />);
    expect(screen.getByRole('heading', { name: 'Maya', level: 1 })).toBeTruthy();
    expect(screen.getByText('Fritz')).toBeTruthy();
  });

  it('places factual highlights between the header and competitive section without duplicate records', () => {
    const base = model();
    identityState.current = { model: { ...base, identitySignals: { all: [{ id: 'competitive:at-peak', type: 'competitive_at_peak', domain: 'competitive', strength: 'signature', priority: 100, label: 'At your peak rating', evidence: '1420 current and peak rating', value: 1420, sampleSize: 11, visibility: 'public', details: { kind: 'rating', current: 1420, peak: 1420 } }], publicSignals: [], selfSignals: [], featured: [{ id: 'competitive:at-peak', type: 'competitive_at_peak', domain: 'competitive', strength: 'signature', priority: 100, label: 'At your peak rating', evidence: '1420 current and peak rating', value: 1420, sampleSize: 11, visibility: 'public', details: { kind: 'rating', current: 1420, peak: 1420 } }] } }, loading: false, error: null };
    render(<PublicProfileScreen {...props} />);
    expect(screen.getByRole('heading', { name: 'Player highlights', level: 2 })).toBeTruthy();
    expect(screen.queryByText('Peak Rating')).toBeNull();
  });

  it('provides a final-shape loading region', () => {
    identityState.current = { model: model(), loading: true, error: null };
    render(<PublicProfileScreen {...props} />);
    expect(screen.getByLabelText('Loading player profile')).toBeTruthy();
    expect(screen.queryByRole('main')).toBeNull();
  });
});
