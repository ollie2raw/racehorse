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
vi.mock('./recoverySignals', () => ({
  bindTournamentRecoverySignals: (input: { onRecover: () => void }) => {
    mocks.onRecover = input.onRecover;
    return () => undefined;
  },
}));

import { useTournament } from './useTournament';

const MY = { registrations: [], tournaments: [], activeAssignedMatch: null, features: { tournaments: true, fritzCup: false } };
const view = (matchStatus: string) => ({ tournament: { id: 't1' }, matches: [{ id: 'm1', status: matchStatus }], registrations: [] });

afterEach(() => {
  vi.clearAllMocks();
  mocks.onRecover = null;
});

describe('useTournament recovery and the open bracket', () => {
  it('refetches the bracket on screen when the tab returns, not just /my', async () => {
    mocks.fetchMy.mockResolvedValue(MY);
    mocks.fetchUpcoming.mockResolvedValue({ tournaments: [], features: MY.features });
    mocks.fetchBracket.mockResolvedValueOnce(view('ready'));

    const { result } = renderHook(() => useTournament({ userId: 'u1', enabled: true }));
    await waitFor(() => expect(mocks.onRecover).not.toBeNull());
    await act(async () => { await result.current.openBracket('t1'); });
    await waitFor(() => expect(result.current.activeBracket?.tournament.id).toBe('t1'));
    expect(mocks.fetchBracket).toHaveBeenCalledTimes(1);

    // The phone slept through the round advance; the server now says completed.
    mocks.fetchBracket.mockResolvedValueOnce(view('completed'));
    await act(async () => { mocks.onRecover?.(); });

    await waitFor(() => expect(mocks.fetchBracket).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((result.current.activeBracket?.matches[0] as { status: string }).status).toBe('completed'));
  });

  it('does not fetch any bracket on recovery when none is open', async () => {
    mocks.fetchMy.mockResolvedValue(MY);
    mocks.fetchUpcoming.mockResolvedValue({ tournaments: [], features: MY.features });

    renderHook(() => useTournament({ userId: 'u1', enabled: true }));
    await waitFor(() => expect(mocks.onRecover).not.toBeNull());
    await waitFor(() => expect(mocks.fetchMy).toHaveBeenCalled());

    await act(async () => { mocks.onRecover?.(); });

    expect(mocks.fetchBracket).not.toHaveBeenCalled();
  });
});
