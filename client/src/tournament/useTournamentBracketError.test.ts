// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchBracket: vi.fn(), fetchMy: vi.fn(), fetchUpcoming: vi.fn() }));

vi.mock('./tournamentApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tournamentApi')>()),
  fetchBracket: (...a: unknown[]) => mocks.fetchBracket(...a),
  fetchMy: (...a: unknown[]) => mocks.fetchMy(...a),
  fetchUpcoming: (...a: unknown[]) => mocks.fetchUpcoming(...a),
}));
vi.mock('./recoverySignals', () => ({ bindTournamentRecoverySignals: () => () => undefined }));

import { useTournament } from './useTournament';
import { TournamentApiError } from './tournamentApi';

afterEach(() => vi.clearAllMocks());

describe('useTournament bracket error handling (P1-2)', () => {
  it('openBracket resolves — never rejects — and records the error tagged to the id', async () => {
    mocks.fetchMy.mockResolvedValue({ registrations: [], tournaments: [], activeAssignedMatch: null, features: { tournaments: true, fritzCup: false } });
    mocks.fetchUpcoming.mockResolvedValue({ tournaments: [], features: { tournaments: true, fritzCup: false } });
    mocks.fetchBracket.mockRejectedValue(new TournamentApiError({ code: 'invalid_tournament_id' }));

    const { result } = renderHook(() => useTournament({ userId: 'u1', enabled: true }));

    await act(async () => {
      await expect(result.current.openBracket('bad-id')).resolves.toBeUndefined();
    });

    await waitFor(() => {
      expect(result.current.bracketError).toEqual({ tournamentId: 'bad-id', code: 'invalid_tournament_id' });
    });
    expect(result.current.activeBracket).toBeNull();
  });
});
