// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isSpectatorModeEnabled, parseSpectatorModeFlag, resolveSpectatorGatedMode } from './spectatorModeFeature.ts';

describe('client Spectator Mode flag', () => {
  it('defaults to disabled', () => expect(isSpectatorModeEnabled()).toBe(false));
  it('enables only for the exact string true', () => {
    expect(parseSpectatorModeFlag('true')).toBe(true);
    for (const value of [undefined, '', '1', 'yes', 'TRUE', true]) expect(parseSpectatorModeFlag(value)).toBe(false);
  });
  it('returns stale live navigation to Home while disabled', () => {
    expect(resolveSpectatorGatedMode('live', false)).toBe('home');
    expect(resolveSpectatorGatedMode('live', true)).toBe('live');
    expect(resolveSpectatorGatedMode('dailyFritz', false)).toBe('dailyFritz');
  });
});
