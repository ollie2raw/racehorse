import { useEffect } from 'react';
import { lazyScreen } from './lazyScreen';
import { connectionAllowsPrefetch, whenIdle } from './screenPrefetch';

// The screens Multiplayer opens after its entry. They are registered here, not in screenPrefetch.ts, so their import()
// thunks stay out of the main bundle: only the multiplayer controller imports this file, so it ships in the controller's chunk.
export const PrivateMatchLobbyScreen = lazyScreen(() => import('../multiplayer/PrivateMatchLobbyScreen'));
export const LiveMatchScreen = lazyScreen(() =>
  import('../match/LiveMatchScreen').then((module) => ({ default: module.LiveMatchScreen })),
);
export const MatchFoundOverlay = lazyScreen(() =>
  import('../matchmaking/MatchFoundOverlay').then((module) => ({ default: module.MatchFoundOverlay })),
);

/**
 * Warms the Private tab and the match once Multiplayer is open and the page is idle, so they open without a Suspense
 * fallback. Same Save-Data / 2g guard as every prefetch. A hook, called from the controller, so this module has the
 * controller as its only importer and stays inside the multiplayer chunk.
 */
export function usePrefetchNestedMultiplayerScreens(): void {
  useEffect(() => whenIdle(() => {
    if (!connectionAllowsPrefetch()) return;
    for (const screen of [PrivateMatchLobbyScreen, LiveMatchScreen, MatchFoundOverlay]) screen.preload().catch(() => undefined);
  }), []);
}
