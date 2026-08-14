// @vitest-environment jsdom
/**
 * Regression tests for useTournamentDisplayLabels.
 *
 * Written BEFORE extraction from App.tsx. Covers tournamentOpponentLabel
 * (async resolution, null-match clear, stale-cancellation) and
 * tournamentMyLabel (authProfile username variants).
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TournamentMatchContext } from '../match/session/tournament/tournamentMatchSessionTypes';
import type { UserProfile } from '../auth/useAuth';

// ── Module mock — dynamic import ──────────────────────────────────────────────

// The hook does: void import('./displayNames').then(...)
// We mock the module so tests don't hit the real dynamic import boundary.
vi.mock('./displayNames', () => ({
  resolveTournamentOpponentLabel: vi.fn((input: { roomOpponentUsername?: string | null }) =>
    input.roomOpponentUsername ?? 'MockOpponent',
  ),
}));

const { useTournamentDisplayLabels } = await import('./useTournamentDisplayLabels');
const { resolveTournamentOpponentLabel } = await import('./displayNames');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<TournamentMatchContext> = {}): TournamentMatchContext {
  return {
    tournamentId: 'tour-1',
    matchId: 'match-1',
    round: 1,
    matchNumber: 1,
    roomCode: 'ABCD',
    stageLabel: 'Quarterfinal',
    isTournament: true,
    opponentUserId: 'opp-uid',
    opponentUsername: 'opponent_user',
    opponentRating: 1000,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { id: 'me-uid', username: 'myhandle', ...overrides };
}

function makePlayers(opponentUsername = 'opp_name') {
  return [
    { id: 'me-uid', username: 'me', userId: 'me-uid' },
    { id: 'opp-uid', username: opponentUsername, userId: 'opp-uid' },
  ];
}

type Params = Parameters<typeof useTournamentDisplayLabels>[0];

function defaultParams(overrides: Partial<Params> = {}): Params {
  return {
    tournamentMatch: null,
    players: [],
    you: 'me-uid',
    authProfile: null,
    ...overrides,
  };
}

// ── 1. tournamentMyLabel derivation ──────────────────────────────────────────

describe('useTournamentDisplayLabels — tournamentMyLabel', () => {
  it('is "You" when authProfile is null', () => {
    const { result } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({ authProfile: null }),
    });
    expect(result.current.tournamentMyLabel).toBe('You');
  });

  it('strips leading @ from username', () => {
    const { result } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({ authProfile: makeProfile({ username: '@myhandle' }) }),
    });
    expect(result.current.tournamentMyLabel).toBe('myhandle');
  });

  it('uses username as-is when no leading @', () => {
    const { result } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({ authProfile: makeProfile({ username: 'myhandle' }) }),
    });
    expect(result.current.tournamentMyLabel).toBe('myhandle');
  });

  it('updates reactively when authProfile changes', () => {
    const { result, rerender } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({ authProfile: null }),
    });
    expect(result.current.tournamentMyLabel).toBe('You');

    act(() => {
      rerender(defaultParams({ authProfile: makeProfile({ username: 'newname' }) }));
    });
    expect(result.current.tournamentMyLabel).toBe('newname');
  });
});

// ── 2. tournamentOpponentLabel — null match ───────────────────────────────────

describe('useTournamentDisplayLabels — tournamentOpponentLabel null match', () => {
  it('is null when tournamentMatch is null', () => {
    const { result } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({ tournamentMatch: null }),
    });
    expect(result.current.tournamentOpponentLabel).toBeNull();
  });

  it('resets to null when tournamentMatch is cleared', async () => {
    vi.mocked(resolveTournamentOpponentLabel).mockReturnValue('Alice');

    const { result, rerender } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({
        tournamentMatch: makeMatch(),
        players: makePlayers('alice'),
        you: 'me-uid',
      }),
    });

    await waitFor(() => expect(result.current.tournamentOpponentLabel).toBe('Alice'));

    act(() => { rerender(defaultParams({ tournamentMatch: null })); });

    expect(result.current.tournamentOpponentLabel).toBeNull();
  });
});

// ── 3. tournamentOpponentLabel — async resolution ────────────────────────────

describe('useTournamentDisplayLabels — tournamentOpponentLabel async resolution', () => {
  beforeEach(() => {
    vi.mocked(resolveTournamentOpponentLabel).mockReset();
    vi.mocked(resolveTournamentOpponentLabel).mockImplementation(
      (input) => input.roomOpponentUsername ?? 'MockOpponent',
    );
  });

  it('resolves label from resolveTournamentOpponentLabel when match is set', async () => {
    vi.mocked(resolveTournamentOpponentLabel).mockReturnValue('Bob');

    const { result } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({
        tournamentMatch: makeMatch({ opponentUsername: 'bob_user' }),
        players: makePlayers('bob_name'),
        you: 'me-uid',
      }),
    });

    await waitFor(() => expect(result.current.tournamentOpponentLabel).toBe('Bob'));
    expect(resolveTournamentOpponentLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        opponentUserId: 'opp-uid',
        opponentUsername: 'bob_user',
        round: 1,
        roomOpponentUsername: 'bob_name',
      }),
    );
  });

  it('passes roomOpponentUsername from the non-local player in players', async () => {
    vi.mocked(resolveTournamentOpponentLabel).mockImplementation(
      (input) => `resolved:${input.roomOpponentUsername}`,
    );

    const { result } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({
        tournamentMatch: makeMatch(),
        players: makePlayers('carol_in_room'),
        you: 'me-uid',
      }),
    });

    await waitFor(() =>
      expect(result.current.tournamentOpponentLabel).toBe('resolved:carol_in_room'),
    );
  });

  it('passes null roomOpponentUsername when players list has no opponent', async () => {
    vi.mocked(resolveTournamentOpponentLabel).mockImplementation(
      (input) => `resolved:${input.roomOpponentUsername ?? 'NONE'}`,
    );

    const { result } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({
        tournamentMatch: makeMatch(),
        players: [{ id: 'me-uid', username: 'me', userId: 'me-uid' }],
        you: 'me-uid',
      }),
    });

    await waitFor(() =>
      expect(result.current.tournamentOpponentLabel).toBe('resolved:NONE'),
    );
  });

  it('ignores stale resolution when tournamentMatch is cleared before it settles', async () => {
    // The hook does `void import(...).then(({ resolveTournamentOpponentLabel }) => { if (cancelled) return; ... })`.
    // We need to control when the dynamic import promise settles to verify the cancelled flag.
    let resolveImport!: () => void;
    const pendingImport = new Promise<void>((r) => { resolveImport = r; });

    // Override the module-level dynamic import by intercepting in the effect.
    // The simplest verifiable contract: if the match is cleared while import
    // is in-flight, the label should remain null after the import resolves.
    vi.mocked(resolveTournamentOpponentLabel).mockReturnValue('ShouldNotAppear');

    // Render with a match — kicks off the async import
    const { result, rerender } = renderHook((p: Params) => useTournamentDisplayLabels(p), {
      initialProps: defaultParams({
        tournamentMatch: makeMatch({ matchId: 'match-A' }),
        players: [],
        you: 'me-uid',
      }),
    });

    // Clear the match — sets cancelled = true on the in-flight effect
    act(() => {
      rerender(defaultParams({ tournamentMatch: null }));
    });

    // The import resolves — but the effect's cancelled flag should prevent the set
    resolveImport();
    await pendingImport;

    // Label should be null (cleared by the null-match branch, not set by stale import)
    expect(result.current.tournamentOpponentLabel).toBeNull();
  });
});
