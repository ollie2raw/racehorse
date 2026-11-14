import { useEffect } from 'react';
import type { AppMode } from '../appRouteTypes';
import { lazyScreen } from './lazyScreen';

export const SinglePlayerHubScreen = lazyScreen(() => import('../screens/SinglePlayerHubScreen'));
export const PlayVsFritz = lazyScreen(() => import('../bot/PlayVsFritz'));
export const BotMatchScreen = lazyScreen(() => import('../bot/BotMatchScreen'));
export const DailyFritzScreen = lazyScreen(() => import('../dailyFritz/DailyFritzScreen'));
export const MultiplayerModeController = lazyScreen(() => import('../multiplayer/MultiplayerModeController'));
export const MatchmakingScreen = lazyScreen(() => import('../matchmaking/MatchmakingScreen'));

const SCREENS = {
  hub: SinglePlayerHubScreen,
  playVsFritz: PlayVsFritz,
  botMatch: BotMatchScreen,
  dailyFritz: DailyFritzScreen,
  multiplayer: MultiplayerModeController,
  matchmaking: MatchmakingScreen,
} as const;

export type PrefetchScreen = keyof typeof SCREENS;

/** The lazy screen each app mode renders, for the modes whose entry is gated on its chunk. */
type Loadable = { preload: () => Promise<unknown>; isLoaded: () => boolean };
const SCREENS_FOR_MODE: Partial<Record<AppMode, readonly Loadable[]>> = {
  singlePlayerHub: [SinglePlayerHubScreen],
  botSetup: [PlayVsFritz],
  bot: [BotMatchScreen],
  dailyFritz: [DailyFritzScreen],
  // The controller, and the Quick Match screen it opens on.
  multiplayer: [MultiplayerModeController, MatchmakingScreen],
};

/** The not-yet-loaded chunk a navigation to `mode` has to wait for, if any. */
export function pendingScreenLoad(mode: AppMode): Promise<unknown> | null {
  const pending = (SCREENS_FOR_MODE[mode] ?? []).filter((screen) => !screen.isLoaded());
  return pending.length > 0 ? Promise.all(pending.map((screen) => screen.preload())) : null;
}

/** Prefetch is a bet on the player's data: not on Save-Data, not on a 2g-class connection. */
export function connectionAllowsPrefetch(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData) return false;
  return connection?.effectiveType !== '2g' && connection?.effectiveType !== 'slow-2g';
}

/** Fire-and-forget; a failed prefetch is retried by the real navigation. */
export function prefetchScreen(screen: PrefetchScreen): void {
  if (!connectionAllowsPrefetch()) return;
  SCREENS[screen].preload().catch(() => undefined);
}

export function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}

/**
 * Warms the chunks of the screens a player is likely to open next, after first paint and
 * off the critical path (idle callback, never a modulepreload in index.html).
 */
export function useScreenPrefetch(appMode: AppMode): void {
  useEffect(() => {
    if (appMode === 'home') {
      return whenIdle(() => {
        prefetchScreen('hub');
        prefetchScreen('playVsFritz');
        prefetchScreen('dailyFritz');
        prefetchScreen('multiplayer');
        prefetchScreen('matchmaking');
      });
    }
    if (appMode === 'dailyFritz') {
      return whenIdle(() => prefetchScreen('botMatch'));
    }
    if (appMode === 'singlePlayerHub') {
      return whenIdle(() => {
        prefetchScreen('playVsFritz');
        prefetchScreen('botMatch');
      });
    }
    if (appMode === 'botSetup') {
      return whenIdle(() => prefetchScreen('botMatch'));
    }
    return undefined;
  }, [appMode]);
}
