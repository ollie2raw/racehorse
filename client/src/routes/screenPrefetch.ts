import { useEffect } from 'react';
import type { AppMode } from '../appRouteTypes';
import { lazyScreen } from './lazyScreen';

export const SinglePlayerHubScreen = lazyScreen(() => import('../screens/SinglePlayerHubScreen'));
export const PlayVsFritz = lazyScreen(() => import('../bot/PlayVsFritz'));
export const BotMatchScreen = lazyScreen(() => import('../bot/BotMatchScreen'));

const SCREENS = {
  hub: SinglePlayerHubScreen,
  playVsFritz: PlayVsFritz,
  botMatch: BotMatchScreen,
} as const;

export type PrefetchScreen = keyof typeof SCREENS;

/** The lazy screen each app mode renders, for the modes whose entry is gated on its chunk. */
const SCREEN_FOR_MODE: Partial<Record<AppMode, { preload: () => Promise<unknown>; isLoaded: () => boolean }>> = {
  singlePlayerHub: SinglePlayerHubScreen,
  botSetup: PlayVsFritz,
  bot: BotMatchScreen,
};

/** The not-yet-loaded chunk a navigation to `mode` has to wait for, if any. */
export function pendingScreenLoad(mode: AppMode): Promise<unknown> | null {
  const screen = SCREEN_FOR_MODE[mode];
  return screen && !screen.isLoaded() ? screen.preload() : null;
}

function connectionAllowsPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !connection?.saveData;
}

/** Fire-and-forget; a failed prefetch is retried by the real navigation. */
export function prefetchScreen(screen: PrefetchScreen): void {
  if (!connectionAllowsPrefetch()) return;
  SCREENS[screen].preload().catch(() => undefined);
}

function whenIdle(run: () => void): () => void {
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
      });
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
