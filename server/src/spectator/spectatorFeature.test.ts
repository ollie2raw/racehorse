import { describe, expect, it } from 'vitest';
import { isSpectatorModeEnabled, parseSpectatorModeFlag } from './spectatorFeature';

describe('server Spectator Mode flag', () => {
  it('defaults to disabled', () => expect(isSpectatorModeEnabled()).toBe(false));
  it('enables only for the exact string true', () => {
    expect(parseSpectatorModeFlag('true')).toBe(true);
    for (const value of [undefined, '', '1', 'yes', 'TRUE', true]) expect(parseSpectatorModeFlag(value)).toBe(false);
  });
});
