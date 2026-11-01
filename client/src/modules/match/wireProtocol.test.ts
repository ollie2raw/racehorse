import { describe, expect, it } from 'vitest';
import { checkProtocolVersion, MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION } from '@racehorse/match-protocol';

describe('the protocol version constants', () => {
  it('start consistent: the server serves at least what it speaks down to', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(MIN_SUPPORTED_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
    expect(MIN_SUPPORTED_PROTOCOL_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);
  });
});

describe('checkProtocolVersion', () => {
  const server = { current: 3, minSupported: 2 };

  it('accepts a client at the current version and one inside the supported window', () => {
    expect(checkProtocolVersion(3, server)).toEqual({ ok: true });
    expect(checkProtocolVersion(2, server)).toEqual({ ok: true });
  });

  it('asks a client below the window to upgrade, telling it what the server serves', () => {
    expect(checkProtocolVersion(1, server)).toEqual({
      ok: false,
      reason: 'upgrade_required',
      payload: { code: 'upgrade_required', minSupported: 2, current: 3 },
    });
  });

  it('does not reject a client NEWER than the server (rollback or deploy in progress)', () => {
    expect(checkProtocolVersion(4, server)).toEqual({ ok: true, note: 'client_newer' });
  });

  it('treats a client that announces nothing as version 1, so today\'s apps keep working until the server moves past them', () => {
    expect(checkProtocolVersion(undefined, { current: 1, minSupported: 1 })).toEqual({ ok: true });
    expect(checkProtocolVersion(undefined, server).ok).toBe(false);
  });

  it('never locks a player out over a malformed announcement: anything but a positive integer counts as version 1', () => {
    for (const bad of ['3', null, NaN, -2, 0, 2.5, {}, [], Infinity]) {
      expect(checkProtocolVersion(bad, { current: 1, minSupported: 1 })).toEqual({ ok: true });
    }
  });

  it('uses the shipped constants by default', () => {
    expect(checkProtocolVersion(PROTOCOL_VERSION)).toEqual({ ok: true });
  });
});
