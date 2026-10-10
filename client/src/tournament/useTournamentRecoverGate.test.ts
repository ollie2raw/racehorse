// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchBracket: vi.fn(),
  fetchMy: vi.fn(),
  fetchUpcoming: vi.fn(),
  onRecover: null as null | (() => void),
}));

vi.mock('./tournamentApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tournamentApi')>()),
  fetchBracket: (...a: unknown[]) => mocks.fetchBracket(...a),
  fetchMy: (...a: unknown[]) => mocks.fetchMy(...a),
  fetchUpcoming: (...a: unknown[]) => mocks.fetchUpcoming(...a),
}));
// Capture the visibility-recovery callback so the test can fire it.
vi.mock('./recoverySignals', () => ({
  bindTournamentRecoverySignals: (input: { onRecover: () => void }) => {
    mocks.onRecover = input.onRecover;
    return () => undefined;
  },
}));

import { useTournament } from './useTournament';

const MY = { registrations: [], tournaments: [], activeAssignedMatch: null, features: { tournaments: true, fritzCup: false } };

afterEach(() => {
  vi.clearAllMocks();
  mocks.onRecover = null;
});

describe('useTournament recover() and the tournaments switch', () => {
  it('never asks the server for /my on recovery while tournaments are off', async () => {
    renderHook(() => useTournament({ userId: 'u1', enabled: false }));
    await waitFor(() => expect(mocks.onRecover).not.toBeNull());

    await act(async () => {
      mocks.onRecover?.();
    });

    expect(mocks.fetchMy).not.toHaveBeenCalled();
    expect(mocks.fetchUpcoming).not.toHaveBeenCalled();
  });

  it('still refreshes /my on recovery while tournaments are on', async () => {
    mocks.fetchMy.mockResolvedValue(MY);
    mocks.fetchUpcoming.mockResolvedValue({ tournaments: [], features: MY.features });
    renderHook(() => useTournament({ userId: 'u1', enabled: true }));
    await waitFor(() => expect(mocks.onRecover).not.toBeNull());
    await waitFor(() => expect(mocks.fetchMy).toHaveBeenCalled());
    mocks.fetchMy.mockClear();

    await act(async () => {
      mocks.onRecover?.();
    });

    await waitFor(() => expect(mocks.fetchMy).toHaveBeenCalledTimes(1));
  });
});
