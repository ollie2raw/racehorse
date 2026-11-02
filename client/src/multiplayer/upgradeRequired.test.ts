import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@racehorse/match-protocol';
import { isUpgradeRequiredError, UPGRADE_REQUIRED_TEXT } from './upgradeRequired';

describe('isUpgradeRequiredError', () => {
  it('recognises the refusal the server sends', () => {
    expect(isUpgradeRequiredError(Object.assign(new Error('upgrade_required'), { data: { code: 'upgrade_required', minSupported: 2, current: 3 } }))).toBe(true);
    expect(isUpgradeRequiredError({ message: 'upgrade_required' })).toBe(true);
  });

  it('does not mistake an ordinary connection failure for one, so a server that is just waking up still says so', () => {
    for (const other of [new Error('xhr poll error'), new Error('server_shutting_down'), new Error('timeout'), { message: 'Upgrade_Required' }, 'upgrade_required', null, undefined, 3]) {
      expect(isUpgradeRequiredError(other)).toBe(false);
    }
  });

  it('has a plain sentence for the player, with no code in it', () => {
    expect(UPGRADE_REQUIRED_TEXT).toMatch(/out of date/i);
    expect(UPGRADE_REQUIRED_TEXT).not.toMatch(/upgrade_required|protocol|\d{3}/i);
  });
});

describe('the app announces its protocol version', () => {
  // The source of the two files, read as text (the app's TypeScript config has no Node types).
  const sources = import.meta.glob('/src/multiplayer/{useMultiplayerConnection,registerMultiplayerConnectionSocketHandlers}.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const connection = sources['/src/multiplayer/useMultiplayerConnection.ts'] ?? '';
  const handlers = sources['/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts'] ?? '';

  it('is looking at the real files', () => {
    expect(connection.length).toBeGreaterThan(1000);
    expect(handlers.length).toBeGreaterThan(1000);
  });

  it('sends it in the socket handshake, where the server reads it (auth.protocolVersion)', () => {
    expect(connection).toMatch(/auth:\s*\{\s*protocolVersion:\s*PROTOCOL_VERSION\s*\}/);
    expect(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 1).toBe(true);
  });

  it('shows the update message for a refusal instead of the "server waking" state', () => {
    expect(handlers).toContain('isUpgradeRequiredError(error)');
    expect(handlers).toContain('UPGRADE_REQUIRED_TEXT');
  });
});
