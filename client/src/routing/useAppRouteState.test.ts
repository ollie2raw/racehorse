/**
 * Regression tests for useAppRouteState.
 *
 * appMode / setAppMode are now owned by App.tsx and passed in as props.
 * The hook controls: appModeRef sync, mode guard side-effects, routeReady,
 * mpSubView, learnHowToPlayOpen, selectedLearnLessonId, profileTarget,
 * profileOriginMode, tournament bootstrap, popstate, and URL sync.
 */

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AppMode } from '../appRouteTypes';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../appRouteTypes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../appRouteTypes')>();
  return { ...actual };
});

vi.mock('./appRoutePath', () => ({
  resolveAppRoute: vi.fn((pathname: string) => {
    if (pathname === '/multiplayer/private') return { mode: 'multiplayer', multiplayerView: 'private' };
    if (pathname === '/learn/how-to-play') return { mode: 'learn', learnHowToPlay: true };
    if (pathname === '/players/alice') return { mode: 'profile', profileUsername: 'alice' };
    if (pathname.startsWith('/tournament/')) {
      const id = pathname.split('/')[2];
      const isResult = pathname.endsWith('/result');
      return { mode: 'tournament', tournamentId: id, tournamentView: isResult ? 'result' : 'bracket' };
    }
    return { mode: 'home' };
  }),
  buildAppPath: vi.fn((state: { mode: string; multiplayerView: string; profileUsername: string | null; learnHowToPlay: boolean; tournamentId: string | null; tournamentView: string }) => {
    if (state.mode === 'profile' && state.profileUsername) return `/players/${state.profileUsername}`;
    if (state.mode === 'tournament' && state.tournamentId) return `/tournament/${state.tournamentId}`;
    if (state.mode === 'multiplayer') return state.multiplayerView === 'private' ? '/multiplayer/private' : '/multiplayer';
    if (state.mode === 'learn' && state.learnHowToPlay) return '/learn/how-to-play';
    return `/${state.mode === 'home' ? '' : state.mode}`;
  }),
}));

const { useAppRouteState } = await import('./useAppRouteState');
const { resolveAppRoute, buildAppPath } = await import('./appRoutePath');

// ── Helpers ───────────────────────────────────────────────────────────────────

type Params = Parameters<typeof useAppRouteState>[0];

function makeSetters() {
  return {
    setActiveTournamentId: vi.fn<(id: string | null) => void>(),
    setTournamentSubView: vi.fn<(view: 'hub' | 'bracket' | 'result') => void>(),
  };
}

function defaultParams(overrides: Partial<Params> = {}): Params {
  return {
    appMode: 'home' as AppMode,
    setAppMode: vi.fn(),
    activeTournamentId: null,
    tournamentSubView: 'hub',
    setActiveTournamentId: vi.fn(),
    setTournamentSubView: vi.fn(),
    ...overrides,
  };
}

function setPathname(pathname: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname },
    writable: true,
    configurable: true,
  });
}

function firePopstate() {
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// ── 1. Initial state from passed-in appMode ───────────────────────────────────

describe('useAppRouteState — initial state', () => {
  beforeEach(() => {
    vi.mocked(resolveAppRoute).mockClear();
    setPathname('/');
  });

  it('reflects appMode from props', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'multiplayer' }),
    });
    expect(result.current.appMode).toBe('multiplayer');
  });

  it('initializes mpSubView from resolved pathname', () => {
    setPathname('/multiplayer/private');
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.mpSubView).toBe('private');
  });

  it('initializes learnHowToPlayOpen from route', () => {
    setPathname('/learn/how-to-play');
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'learn' }),
    });
    expect(result.current.learnHowToPlayOpen).toBe(true);
  });

  it('initializes profileTarget from route', () => {
    setPathname('/players/alice');
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'profile' }),
    });
    expect(result.current.profileTarget).toBe('alice');
  });

  it('routeReady is true when no tournamentId in initial route', () => {
    setPathname('/');
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.routeReady).toBe(true);
  });

  it('routeReady becomes true after tournament bootstrap fires', () => {
    setPathname('/tournament/tour-abc');
    const { setActiveTournamentId, setTournamentSubView } = makeSetters();
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'tournament', setActiveTournamentId, setTournamentSubView }),
    });
    expect(result.current.routeReady).toBe(true);
    expect(setActiveTournamentId).toHaveBeenCalledWith('tour-abc');
  });

  it('selectedLearnLessonId starts null', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.selectedLearnLessonId).toBeNull();
  });

  it('profileOriginMode starts null', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.profileOriginMode).toBeNull();
  });
});

// ── 2. Mode guard effects ─────────────────────────────────────────────────────

describe('useAppRouteState — learnHowToPlayOpen clears when leaving learn', () => {
  beforeEach(() => setPathname('/'));

  it('clears learnHowToPlayOpen when appMode prop changes away from learn', () => {
    const { result, rerender } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'learn' }),
    });

    act(() => { result.current.setLearnHowToPlayOpen(true); });
    expect(result.current.learnHowToPlayOpen).toBe(true);

    rerender(defaultParams({ appMode: 'home' }));
    expect(result.current.learnHowToPlayOpen).toBe(false);
  });

  it('keeps learnHowToPlayOpen true when staying on learn', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'learn' }),
    });

    act(() => { result.current.setLearnHowToPlayOpen(true); });
    expect(result.current.learnHowToPlayOpen).toBe(true);
  });
});

// ── 3. appModeRef / mpSubViewRef sync ────────────────────────────────────────

describe('useAppRouteState — ref sync', () => {
  beforeEach(() => setPathname('/'));

  it('appModeRef tracks appMode prop', () => {
    const { result, rerender } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'home' }),
    });

    expect(result.current.appModeRef.current).toBe('home');

    rerender(defaultParams({ appMode: 'stats' }));
    expect(result.current.appModeRef.current).toBe('stats');
  });

  it('mpSubViewRef tracks mpSubView', () => {
    setPathname('/multiplayer/private');
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });

    expect(result.current.mpSubViewRef.current).toBe('private');

    act(() => { result.current.setMpSubView('quick'); });
    expect(result.current.mpSubViewRef.current).toBe('quick');
  });
});

// ── 4. Tournament bootstrap (one-shot) ────────────────────────────────────────

describe('useAppRouteState — tournament bootstrap', () => {
  it('calls setActiveTournamentId and setTournamentSubView when initial route has tournamentId', () => {
    setPathname('/tournament/tour-xyz');
    const { setActiveTournamentId, setTournamentSubView } = makeSetters();

    renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ setActiveTournamentId, setTournamentSubView }),
    });

    expect(setActiveTournamentId).toHaveBeenCalledWith('tour-xyz');
    expect(setTournamentSubView).toHaveBeenCalledWith('bracket');
  });

  it('does not call setActiveTournamentId when no tournamentId in initial route', () => {
    setPathname('/');
    const { setActiveTournamentId, setTournamentSubView } = makeSetters();

    renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ setActiveTournamentId, setTournamentSubView }),
    });

    expect(setActiveTournamentId).not.toHaveBeenCalled();
    expect(setTournamentSubView).not.toHaveBeenCalled();
  });

  it('only applies the bootstrap once (one-shot ref guard)', () => {
    setPathname('/tournament/tour-abc');
    const { setActiveTournamentId, setTournamentSubView } = makeSetters();

    const { rerender } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ setActiveTournamentId, setTournamentSubView }),
    });

    const secondSetters = makeSetters();
    rerender(defaultParams({
      setActiveTournamentId: secondSetters.setActiveTournamentId,
      setTournamentSubView: secondSetters.setTournamentSubView,
    }));

    expect(secondSetters.setActiveTournamentId).not.toHaveBeenCalled();
  });
});

// ── 5. popstate handler ───────────────────────────────────────────────────────

describe('useAppRouteState — popstate handler', () => {
  beforeEach(() => {
    setPathname('/');
    vi.mocked(resolveAppRoute).mockClear();
  });

  it('calls setAppMode when popstate fires', () => {
    const setAppMode = vi.fn();
    renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ setAppMode }),
    });

    setPathname('/stats');
    act(() => { firePopstate(); });

    // resolveAppRoute('/stats') → home in our mock (not mapped)
    expect(setAppMode).toHaveBeenCalled();
  });

  it('calls setAppMode with multiplayer and updates mpSubView on popstate to multiplayer/private', () => {
    const setAppMode = vi.fn();
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ setAppMode }),
    });

    setPathname('/multiplayer/private');
    act(() => { firePopstate(); });

    expect(setAppMode).toHaveBeenCalledWith('multiplayer');
    expect(result.current.mpSubView).toBe('private');
  });

  it('updates profileTarget and clears profileOriginMode on popstate to profile', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });

    act(() => { result.current.setProfileOriginMode('home'); });

    setPathname('/players/alice');
    act(() => { firePopstate(); });

    expect(result.current.profileTarget).toBe('alice');
    expect(result.current.profileOriginMode).toBeNull();
  });

  it('calls setActiveTournamentId on popstate to tournament route', () => {
    const { setActiveTournamentId, setTournamentSubView } = makeSetters();
    setPathname('/');

    renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ setActiveTournamentId, setTournamentSubView }),
    });

    setPathname('/tournament/tour-pop');
    act(() => { firePopstate(); });

    expect(setActiveTournamentId).toHaveBeenCalledWith('tour-pop');
    expect(setTournamentSubView).toHaveBeenCalledWith('bracket');
  });

  it('clears selectedLearnLessonId on popstate', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });

    act(() => { result.current.setSelectedLearnLessonId('lesson-1'); });
    expect(result.current.selectedLearnLessonId).toBe('lesson-1');

    setPathname('/learn/how-to-play');
    act(() => { firePopstate(); });

    expect(result.current.selectedLearnLessonId).toBeNull();
  });

  it('cleans up popstate listener on unmount', () => {
    setPathname('/');
    const setAppMode = vi.fn();
    const { unmount } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ setAppMode }),
    });

    unmount();
    setAppMode.mockClear();

    setPathname('/multiplayer/private');
    act(() => { firePopstate(); });

    expect(setAppMode).not.toHaveBeenCalled();
  });
});

// ── 6. URL sync (pushState) ───────────────────────────────────────────────────

describe('useAppRouteState — URL sync', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setPathname('/');
    vi.mocked(buildAppPath).mockClear();
    pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  });

  afterEach(() => {
    pushStateSpy.mockRestore();
  });

  it('calls pushState when appMode prop changes and routeReady is true', () => {
    const { rerender } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'home' }),
    });

    rerender(defaultParams({ appMode: 'stats' }));

    expect(pushStateSpy).toHaveBeenCalled();
  });

  it('setRouteReady(false) suppresses pushState until re-enabled', () => {
    const { result, rerender } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams({ appMode: 'home' }),
    });

    act(() => { result.current.setRouteReady(false); });
    pushStateSpy.mockClear();

    rerender(defaultParams({ appMode: 'stats' }));
    expect(pushStateSpy).not.toHaveBeenCalled();

    act(() => { result.current.setRouteReady(true); });
    expect(pushStateSpy).toHaveBeenCalled();
  });

  it('skips pushState when browserNavigationRef is set (avoids double-push on popstate)', () => {
    setPathname('/');
    renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });

    setPathname('/stats');
    act(() => { firePopstate(); });

    expect(pushStateSpy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ── 7. Setter surface ────────────────────────────────────────────────────────

describe('useAppRouteState — setter surface', () => {
  beforeEach(() => setPathname('/'));

  it('exposes all expected setters', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });

    expect(typeof result.current.setAppMode).toBe('function');
    expect(typeof result.current.setMpSubView).toBe('function');
    expect(typeof result.current.setLearnHowToPlayOpen).toBe('function');
    expect(typeof result.current.setSelectedLearnLessonId).toBe('function');
    expect(typeof result.current.setProfileTarget).toBe('function');
    expect(typeof result.current.setProfileOriginMode).toBe('function');
    expect(typeof result.current.setRouteReady).toBe('function');
  });

  it('setters update state reactively', () => {
    const { result } = renderHook((p: Params) => useAppRouteState(p), {
      initialProps: defaultParams(),
    });

    act(() => { result.current.setMpSubView('private'); });
    expect(result.current.mpSubView).toBe('private');

    act(() => { result.current.setProfileTarget('bob'); });
    expect(result.current.profileTarget).toBe('bob');

    act(() => { result.current.setProfileOriginMode('stats'); });
    expect(result.current.profileOriginMode).toBe('stats');

    act(() => { result.current.setSelectedLearnLessonId('lesson-7'); });
    expect(result.current.selectedLearnLessonId).toBe('lesson-7');
  });
});
