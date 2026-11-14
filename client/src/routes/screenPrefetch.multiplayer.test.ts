// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// The real screens are heavy and not what is under test: the gate's bookkeeping is.
vi.mock('../multiplayer/MultiplayerModeController', () => ({ default: () => null }));
vi.mock('../matchmaking/MatchmakingScreen', () => ({ default: () => null }));

const { pendingScreenLoad, MultiplayerModeController, MatchmakingScreen } = await import('./screenPrefetch');

describe('entering Multiplayer', () => {
  it('waits for the controller and the Quick Match screen it opens on, then waits for nothing', async () => {
    expect(MultiplayerModeController.isLoaded()).toBe(false);
    expect(MatchmakingScreen.isLoaded()).toBe(false);
    const pending = pendingScreenLoad('multiplayer');
    expect(pending).not.toBeNull();
    await pending;
    expect(MultiplayerModeController.isLoaded()).toBe(true);
    expect(MatchmakingScreen.isLoaded()).toBe(true);
    expect(pendingScreenLoad('multiplayer')).toBeNull();
  });

  it('does not gate a mode that has no registered screens', () => {
    expect(pendingScreenLoad('home')).toBeNull();
  });
});
