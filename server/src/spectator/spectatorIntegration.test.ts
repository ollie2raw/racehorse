import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishMultiplayerSpectatorSnapshotIfEnabled, registerSpectatorHandlersIfEnabled } from './spectatorIntegration';
import { listSpectatorSessions, resetSpectatorRegistryForTests } from './spectatorRegistry';

describe('multiplayer spectator integration gate', () => {
  beforeEach(() => resetSpectatorRegistryForTests());
  afterEach(() => vi.unstubAllEnvs());

  it('does not evaluate projection inputs while disabled', () => {
    vi.stubEnv('ENABLE_SPECTATOR_MODE', '');
    const getRoster = vi.fn(() => []);
    publishMultiplayerSpectatorSnapshotIfEnabled({} as never, {} as never, getRoster);
    expect(getRoster).not.toHaveBeenCalled();
    expect(listSpectatorSessions()).toEqual([]);
  });

  it('enters the dormant publisher only when explicitly enabled', () => {
    vi.stubEnv('ENABLE_SPECTATOR_MODE', 'true');
    const getRoster = vi.fn(() => []);
    publishMultiplayerSpectatorSnapshotIfEnabled({} as never, {} as never, getRoster);
    expect(getRoster).toHaveBeenCalledOnce();
  });

  it('registers no socket protocol while disabled', () => {
    vi.stubEnv('ENABLE_SPECTATOR_MODE', '');
    const socket = { on: vi.fn() };
    registerSpectatorHandlersIfEnabled({} as never, socket as never);
    expect(socket.on).not.toHaveBeenCalled();
  });

  it('registers spectator and Daily Fritz handlers when explicitly enabled', () => {
    vi.stubEnv('ENABLE_SPECTATOR_MODE', 'true');
    const socket = { on: vi.fn() };
    registerSpectatorHandlersIfEnabled({} as never, socket as never);
    const events = socket.on.mock.calls.map(([event]) => event);
    expect(events).toContain('spectator:list');
    expect(events).toContain('daily_fritz:broadcast_start');
  });
});
