// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchBracket: vi.fn(),
  fetchMe: vi.fn(),
  fetchUpcoming: vi.fn(),
  fetchMyRegistrations: vi.fn(),
  onRecover: null as null | (() => void),
}));

vi.mock('./tournamentApi', () => ({
  fetchBracket: (...a: unknown[]) => mocks.fetchBracket(...a),
  fetchMe: (...a: unknown[]) => mocks.fetchMe(...a),
  fetchUpcoming: (...a: unknown[]) => mocks.fetchUpcoming(...a),
  fetchMyRegistrations: (...a: unknown[]) => mocks.fetchMyRegistrations(...a),
}));
// Capture the visibility-recovery callback so the test can fire it.
vi.mock('./recoverySignals', () => ({
  bindTournamentRecoverySignals: (input: { onRecover: () => void }) => {
    mocks.onRecover = input.onRecover;
    return () => undefined;
  },
}));

import { useTournament } from './useTournament';

const ME = { registrations: [], activeAssignedMatch: null, currentTournamentPhase: null, activeTournamentId: null, assignedMatch: null, countdown: null };

afterEach(() => {
  vi.clearAllMocks();
  mocks.onRecover = null;
});

describe('useTournament recover() and the tournaments switch', () => {
  it('never asks the server for /me on recovery while tournaments are off', async () => {
    renderHook(() => useTournament({ userId: 'u1', enabled: false }));
    await waitFor(() => expect(mocks.onRecover).not.toBeNull());

    await act(async () => {
      mocks.onRecover?.();
    });

    expect(mocks.fetchMe).not.toHaveBeenCalled();
    expect(mocks.fetchUpcoming).not.toHaveBeenCalled();
  });

  it('still refreshes /me on recovery while tournaments are on', async () => {
    mocks.fetchMe.mockResolvedValue(ME);
    mocks.fetchUpcoming.mockResolvedValue([]);
    renderHook(() => useTournament({ userId: 'u1', enabled: true }));
    await waitFor(() => expect(mocks.onRecover).not.toBeNull());
    mocks.fetchMe.mockClear();

    await act(async () => {
      mocks.onRecover?.();
    });

    await waitFor(() => expect(mocks.fetchMe).toHaveBeenCalledTimes(1));
  });
});
