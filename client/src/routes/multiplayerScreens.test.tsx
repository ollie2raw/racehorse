// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real screens are heavy and not what is under test: when they are fetched is.
vi.mock('../multiplayer/PrivateMatchLobbyScreen', () => ({ default: () => null }));
vi.mock('../match/LiveMatchScreen', () => ({ LiveMatchScreen: () => null }));
vi.mock('../matchmaking/MatchFoundOverlay', () => ({ MatchFoundOverlay: () => null }));

const { usePrefetchNestedMultiplayerScreens, PrivateMatchLobbyScreen, LiveMatchScreen, MatchFoundOverlay } = await import('./multiplayerScreens');

const all = () => [PrivateMatchLobbyScreen, LiveMatchScreen, MatchFoundOverlay];
const setConnection = (connection: object | undefined) => Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', (run: () => void) => window.setTimeout(run, 0));
  vi.stubGlobal('cancelIdleCallback', (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  setConnection(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePrefetchNestedMultiplayerScreens', () => {
  it('fetches nothing until the page is idle, and nothing on Save-Data', async () => {
    setConnection({ saveData: true });
    const { unmount } = renderHook(() => usePrefetchNestedMultiplayerScreens());
    await vi.advanceTimersByTimeAsync(10);
    expect(all().some((screen) => screen.isLoaded())).toBe(false);
    unmount();
  });

  it('loads the Private tab, the match and the match-found overlay once idle', async () => {
    const { unmount } = renderHook(() => usePrefetchNestedMultiplayerScreens());
    expect(all().some((screen) => screen.isLoaded())).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(all().map((screen) => screen.preload()));
    expect(all().every((screen) => screen.isLoaded())).toBe(true);
    unmount();
  });
});
