// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchBracket: vi.fn(), fetchMe: vi.fn(), fetchUpcoming: vi.fn(), fetchMyRegistrations: vi.fn() }));

vi.mock('./tournamentApi', () => ({
  fetchBracket: (...a: unknown[]) => mocks.fetchBracket(...a),
  fetchMe: (...a: unknown[]) => mocks.fetchMe(...a),
  fetchUpcoming: (...a: unknown[]) => mocks.fetchUpcoming(...a),
  fetchMyRegistrations: (...a: unknown[]) => mocks.fetchMyRegistrations(...a),
}));
vi.mock('./recoverySignals', () => ({ bindTournamentRecoverySignals: () => () => undefined }));

import { useTournament } from './useTournament';

afterEach(() => vi.clearAllMocks());

describe('useTournament bracket error handling (P1-2)', () => {
  it('openBracket resolves — never rejects — and records the error tagged to the id', async () => {
    mocks.fetchMe.mockResolvedValue({ registrations: [], activeAssignedMatch: null, currentTournamentPhase: null, activeTournamentId: null, assignedMatch: null, countdown: null });
    mocks.fetchUpcoming.mockResolvedValue([]);
    mocks.fetchMyRegistrations.mockResolvedValue([]);
    mocks.fetchBracket.mockRejectedValue(new Error('invalid_tournament_id'));

    const { result } = renderHook(() => useTournament({ userId: 'u1' }));

    await act(async () => {
      await expect(result.current.openBracket('bad-id')).resolves.toBeUndefined();
    });

    await waitFor(() => {
      expect(result.current.bracketError).toEqual({ tournamentId: 'bad-id', code: 'invalid_tournament_id' });
    });
    expect(result.current.activeBracket).toBeNull();
  });
});
